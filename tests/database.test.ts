import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Run from the repository root, or set DALGO_PROJECT_ROOT to that directory.
// PostgreSQL is embedded and ephemeral; this never connects to Supabase.
const migrationRoot = resolve(
  process.env.DALGO_PROJECT_ROOT ?? process.cwd(),
  "supabase/migrations",
);
const migrationFiles = readdirSync(migrationRoot)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const glickoMigrationName = "20260924074700_glicko_ratings.sql";
const migrationBeforeGlicko = migrationFiles
  .filter((name) => name < glickoMigrationName)
  .map((name) => readFileSync(resolve(migrationRoot, name), "utf8"))
  .join("\n");
const glickoMigration = readFileSync(resolve(migrationRoot, glickoMigrationName), "utf8");
const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const EXISTING = "44444444-4444-4444-8444-444444444444";
const LEGACY_A = "55555555-5555-4555-8555-555555555555";
const LEGACY_B = "66666666-6666-4666-8666-666666666666";
const LEGACY_MATCH = "77777777-7777-4777-8777-777777777777";
type Arena = "easy" | "medium" | "hard";
type Mode = "human" | "bot";
type Outcome = "win" | "draw" | "void";
interface MatchInput {
  id: string;
  settlement_key: string;
  arena: Arena;
  mode: Mode;
  problem_id: string;
  problem_version: number;
  started_at: string;
  ended_at: string;
  result: { outcome: Outcome; winner_id: string | null; reason: string };
  participants: {
    user_id: string | null;
    pre_rating: number;
    pre_rd: number;
    bot_rating?: number;
  }[];
}
interface Settlement {
  id: string;
  status: string;
  already_settled: boolean;
  rating_changes: {
    user_id: string;
    before: number;
    after: number;
    delta: number;
    outcome: string;
    before_rd: number | null;
    after_rd: number | null;
  }[];
}

describe("Supabase migration and trusted settlement contract", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      insert into auth.users(id, raw_user_meta_data)
      values('${EXISTING}', '{"full_name":"Existing Coder"}');
    `);
    await pg.exec(migrationBeforeGlicko);
    // A real Elo result exists before cutover. The migration must shift only
    // current ratings, never rewrite past match and ledger records.
    await pg.query("insert into auth.users(id) values($1),($2)", [LEGACY_A, LEGACY_B]);
    await pg.query(
      "insert into public.problems(id,version,arena,public,private) values('legacy-easy',1,'easy','{}','{}')",
    );
    await pg.query("select public.settle_match($1::jsonb)", [JSON.stringify({
      id: LEGACY_MATCH,
      arena: "easy",
      mode: "human",
      problem_id: "legacy-easy",
      problem_version: 1,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      ended_at: new Date(Date.now() - 30_000).toISOString(),
      result: { outcome: "win", winner_id: LEGACY_A, reason: "solved" },
      participants: [
        { user_id: LEGACY_A, pre_rating: 1200 },
        { user_id: LEGACY_B, pre_rating: 1200 },
      ],
    })]);
    await pg.exec(glickoMigration);
  }, 30_000);

  beforeEach(async () => {
    await pg.exec("begin");
    // A and B deliberately share the username suffix prefix, exercising collision recovery.
    for (const id of [A, B, C]) {
      await pg.query(
        "insert into auth.users(id, raw_user_meta_data) values($1, $2::jsonb)",
        [
          id,
          JSON.stringify({
            user_name: "Same Unsafe <Handle>!",
            full_name: "Ada Coder",
            avatar_url: "javascript:bad",
          }),
        ],
      );
    }
    for (const arena of ["easy", "medium", "hard"]) {
      await pg.query(
        `insert into public.problems(id, version, arena, public, private)
        values($1, 1, $2, $3::jsonb, $4::jsonb)`,
        [
          `test-${arena}`,
          arena,
          JSON.stringify({ title: "Test problem" }),
          JSON.stringify({ tests: [{ expected: 42 }] }),
        ],
      );
    }
  });

  afterEach(async () => {
    await pg.exec("rollback; reset role;");
  });
  afterAll(async () => {
    await pg?.close();
  });

  function match(options: Partial<MatchInput> = {}): MatchInput {
    const id = crypto.randomUUID();
    return {
      id,
      settlement_key: id,
      arena: "easy",
      mode: "human",
      problem_id: "test-easy",
      problem_version: 1,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      ended_at: new Date(Date.now() - 1000).toISOString(),
      result: { outcome: "win", winner_id: A, reason: "solved" },
      participants: [
        { user_id: A, pre_rating: 800, pre_rd: 350 },
        { user_id: B, pre_rating: 800, pre_rd: 350 },
      ],
      ...options,
    };
  }

  async function settle(input: MatchInput): Promise<Settlement> {
    await pg.exec("set local role service_role");
    try {
      const r = await pg.query<{ value: Settlement }>(
        "select public.settle_match($1::jsonb) as value",
        [JSON.stringify(input)],
      );
      return r.rows[0].value;
    } finally {
      // An expected failure must run inside expectSqlError, which restores its savepoint first.
      await pg.exec("reset role");
    }
  }

  async function rating(
    userId: string,
    arena: Arena = "easy",
    mode: Mode = "human",
  ) {
    const r = await pg.query<{
      rating: number;
      matches: number;
      wins: number;
      losses: number;
      draws: number;
    }>(
      `select rating, matches, wins, losses, draws from public.arena_ratings
       where user_id=$1 and arena=$2 and mode=$3`,
      [userId, arena, mode],
    );
    return r.rows[0];
  }

  async function expectSqlError(sql: string, args: unknown[], code: string) {
    await pg.exec("savepoint expected_error");
    try {
      await expect(pg.query(sql, args)).rejects.toMatchObject({ code });
    } finally {
      await pg.exec(
        "rollback to savepoint expected_error; release savepoint expected_error;",
      );
    }
  }

  async function asBrowser(
    role: "anon" | "authenticated",
    userId: string | null,
    work: () => Promise<void>,
  ) {
    await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId ?? "",
    ]);
    await pg.exec(`set local role ${role}`);
    try {
      await work();
    } finally {
      await pg.exec("reset role");
    }
  }

  async function sourceRow(
    matchId: string,
    userId: string,
    sequence: number,
    receivedAt: string,
    source = "return 42;",
  ) {
    const id = crypto.randomUUID();
    await pg.query(
      `insert into public.submissions
      (id,match_id,user_id,kind,source,language,verdict,received_at,sequence,idempotency_key,payload)
      values($1,$2,$3,'submit',$4,'javascript','accepted',$5,$6,$7,$8::jsonb)`,
      [
        id,
        matchId,
        userId,
        source,
        receivedAt,
        sequence,
        id,
        JSON.stringify({ internal: "private judge metadata" }),
      ],
    );
    return id;
  }

  it("creates a constrained public avatar bucket without browser write grants", async () => {
    const bucket = await pg.query<{
      public: boolean;
      file_size_limit: number;
      allowed_mime_types: string[];
    }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id='profile-avatars'",
    );
    expect(bucket.rows).toEqual([
      {
        public: true,
        file_size_limit: 512000,
        allowed_mime_types: ["image/webp"],
      },
    ]);
    const grants = await pg.query<{ grantee: string }>(
      "select grantee from information_schema.role_routine_grants where routine_schema='public' and routine_name='swap_profile_avatar' order by grantee",
    );
    expect(grants.rows.map((row) => row.grantee)).toContain("service_role");
    expect(grants.rows.map((row) => row.grantee)).not.toEqual(
      expect.arrayContaining(["PUBLIC", "anon", "authenticated"]),
    );
  });

  it("atomically swaps owned avatar paths and returns the previous object", async () => {
    const firstPath = A + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
    const secondPath = A + "/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp";
    await pg.exec("set local role service_role");
    const first = await pg.query<{
      previous_storage_path: string | null;
      avatar_url: string;
    }>(
      "select previous_storage_path, avatar_url from public.swap_profile_avatar($1,$2,$3)",
      [A, "https://project.invalid/storage/first.webp", firstPath],
    );
    expect(first.rows[0]).toEqual({
      previous_storage_path: null,
      avatar_url: "https://project.invalid/storage/first.webp",
    });
    const second = await pg.query<{
      previous_storage_path: string | null;
      avatar_url: string;
    }>(
      "select previous_storage_path, avatar_url from public.swap_profile_avatar($1,$2,$3)",
      [A, "https://project.invalid/storage/second.webp", secondPath],
    );
    expect(second.rows[0]).toEqual({
      previous_storage_path: firstPath,
      avatar_url: "https://project.invalid/storage/second.webp",
    });
    await pg.exec("reset role");
  });

  it("rejects invalid or browser-written avatar storage paths", async () => {
    await pg.exec("set local role service_role");
    await expectSqlError(
      "select * from public.swap_profile_avatar($1,$2,$3)",
      [
        A,
        "https://project.invalid/avatar.webp",
        B + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
      ],
      "22023",
    );
    await asBrowser("authenticated", A, async () => {
      await expectSqlError(
        "update public.profiles set avatar_url=$1 where id=$2",
        ["https://attacker.invalid/avatar.webp", A],
        "42501",
      );
    });
  });

  it("shifts existing ratings by exactly 400 without rewriting history or statistics", async () => {
    const current = await pg.query<{ user_id: string; rating: number; matches: number; wins: number; losses: number; rd: string }>(
      "select user_id,rating,matches,wins,losses,rd from public.arena_ratings where user_id=any($1::uuid[]) and arena='easy' and mode='human' order by user_id",
      [[LEGACY_A, LEGACY_B]],
    );
    expect(current.rows).toEqual([
      { user_id: LEGACY_A, rating: 816, matches: 1, wins: 1, losses: 0, rd: "350.000" },
      { user_id: LEGACY_B, rating: 784, matches: 1, wins: 0, losses: 1, rd: "350.000" },
    ]);
    const history = await pg.query<{ before_rating: number; after_rating: number; delta: number; before_rd: string | null }>(
      "select before_rating,after_rating,delta,before_rd from public.rating_ledger where match_id=$1 order by user_id",
      [LEGACY_MATCH],
    );
    expect(history.rows).toEqual([
      { before_rating: 1200, after_rating: 1216, delta: 16, before_rd: null },
      { before_rating: 1200, after_rating: 1184, delta: -16, before_rd: null },
    ]);
  });

  it("keeps legacy settlement retries idempotent after the migration", async () => {
    const stored = await pg.query<{ settlement_payload: unknown }>(
      "select settlement_payload from public.matches where id=$1", [LEGACY_MATCH],
    );
    const result = await pg.query<{ value: Settlement }>(
      "select public.settle_match($1::jsonb) as value",
      [JSON.stringify(stored.rows[0].settlement_payload)],
    );
    expect(result.rows[0].value.already_settled).toBe(true);
    expect((await rating(LEGACY_A)).rating).toBe(816);
    expect((await rating(LEGACY_B)).rating).toBe(784);
  });

  it("creates safe unique OAuth profiles and exactly six independent 800 ratings", async () => {
    const profiles = await pg.query<{
      id: string;
      username: string;
      avatar_url: string | null;
      public_id: string;
      username_configured_at: string | null;
    }>(
      "select id, username, avatar_url, public_id, username_configured_at from public.profiles where id=any($1::uuid[])",
      [[A, B]],
    );
    expect(profiles.rows).toHaveLength(2);
    expect(new Set(profiles.rows.map((p) => p.username)).size).toBe(2);
    for (const p of profiles.rows) {
      expect(p.username).toMatch(/^[a-z0-9_]{3,32}$/);
      expect(p.avatar_url).toBeNull();
      expect(p.public_id).toMatch(/^DLG-[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
      expect(p.username_configured_at).toBeNull();
    }
    expect(new Set(profiles.rows.map((p) => p.public_id)).size).toBe(2);
    const ratings = await pg.query<{
      arena: string;
      mode: string;
      rating: number;
      matches: number;
    }>(
      "select arena, mode, rating, matches from public.arena_ratings where user_id=$1",
      [A],
    );
    expect(ratings.rows).toHaveLength(6);
    expect(new Set(ratings.rows.map((r) => `${r.arena}/${r.mode}`)).size).toBe(
      6,
    );
    expect(
      ratings.rows.every((r) => r.rating === 800 && r.matches === 0),
    ).toBe(true);
  });

  it("lets the backend claim one normalized username and rejects duplicates or reserved names", async () => {
    await pg.exec("set local role service_role");
    const claimed = await pg.query<{
      id: string;
      username: string;
      username_configured_at: string;
    }>(
      "select id, username, username_configured_at from public.claim_username($1,$2)",
      [A, "  Alice_One  "],
    );
    await pg.exec("reset role");
    expect(claimed.rows).toHaveLength(1);
    expect(claimed.rows[0]).toMatchObject({ id: A, username: "alice_one" });
    expect(claimed.rows[0].username_configured_at).toBeTruthy();

    await pg.exec("set local role service_role");
    await expectSqlError(
      "select * from public.claim_username($1,$2)",
      [B, "ALICE_ONE"],
      "23505",
    );
    await pg.exec("set local role service_role");
    await expectSqlError(
      "select * from public.claim_username($1,$2)",
      [A, "another_name"],
      "22023",
    );
    await pg.exec("set local role service_role");
    await expectSqlError(
      "select * from public.claim_username($1,$2)",
      [B, "admin"],
      "22023",
    );
    await asBrowser("authenticated", B, async () => {
      await expectSqlError(
        "select * from public.claim_username($1,$2)",
        [B, "browser_claim"],
        "42501",
      );
    });
  });

  it("backfills profiles and all six ratings for existing auth accounts", async () => {
    expect(
      (await pg.query("select id from public.profiles where id=$1", [EXISTING]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await pg.query(
          "select rating from public.arena_ratings where user_id=$1 and rating=800",
          [EXISTING],
        )
      ).rows,
    ).toHaveLength(6);
  });

  it("restricts friend challenges and compatibility IDs to authorized readers", async () => {
    const existing = await pg.query<{ public_id: string }>(
      "select public_id from public.profiles where id=$1",
      [EXISTING],
    );
    expect(existing.rows[0].public_id).toMatch(
      /^DLG-[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/,
    );
    const challengeId = crypto.randomUUID();
    await pg.exec("set local role service_role");
    await pg.query(
      `insert into public.friend_challenges
       (id, challenger_id, challenged_id, arena, status, created_at, expires_at)
       values($1,$2,$3,'easy','open',now(),now()+interval '10 minutes')`,
      [challengeId, A, B],
    );
    await pg.exec("reset role");

    await asBrowser("authenticated", A, async () => {
      expect(
        (await pg.query("select id from public.friend_challenges")).rows,
      ).toEqual([{ id: challengeId }]);
      await expectSqlError(
        "update public.friend_challenges set status='accepted' where id=$1",
        [challengeId],
        "42501",
      );
      await expectSqlError(
        "select public_id from public.profiles where id=$1",
        [B],
        "42501",
      );
    });
    await asBrowser("authenticated", C, async () => {
      expect(
        (await pg.query("select id from public.friend_challenges")).rows,
      ).toEqual([]);
    });
  });

  it("creates permanent friendships atomically and keeps the graph backend-only", async () => {
    const requestId = crypto.randomUUID();
    await pg.exec("set local role service_role");
    const created = await pg.query<{
      id: string;
      sender_id: string;
      receiver_id: string;
      status: string;
    }>("select * from public.create_friend_request($1,$2,$3)", [
      A,
      B,
      requestId,
    ]);
    expect(created.rows).toEqual([
      expect.objectContaining({
        id: requestId,
        sender_id: A,
        receiver_id: B,
        status: "pending",
      }),
    ]);

    const retried = await pg.query<{ id: string }>(
      "select id from public.create_friend_request($1,$2,$3)",
      [A, B, requestId],
    );
    expect(retried.rows).toEqual([{ id: requestId }]);

    await expectSqlError(
      "select * from public.create_friend_request($1,$2,$3)",
      [B, A, crypto.randomUUID()],
      "23505",
    );
    await pg.exec("set local role service_role");
    await expectSqlError(
      "select * from public.create_friend_request($1,$2,$3)",
      [A, A, crypto.randomUUID()],
      "22023",
    );
    await pg.exec("set local role service_role");
    await expectSqlError(
      "select * from public.respond_friend_request($1,$2,'accept')",
      [A, requestId],
      "42501",
    );

    await pg.exec("set local role service_role");
    const accepted = await pg.query<{ status: string }>(
      "select status from public.respond_friend_request($1,$2,'accept')",
      [B, requestId],
    );
    await pg.exec("reset role");
    expect(accepted.rows).toEqual([{ status: "accepted" }]);
    expect(
      (
        await pg.query(
          "select user_low,user_high,requested_by from public.friendships",
        )
      ).rows,
    ).toEqual([
      {
        user_low: A,
        user_high: B,
        requested_by: A,
      },
    ]);

    await asBrowser("authenticated", A, async () => {
      await expectSqlError("select * from public.friend_requests", [], "42501");
      await expectSqlError("select * from public.friendships", [], "42501");
      await expectSqlError(
        "select * from public.respond_friend_request($1,$2,'decline')",
        [A, requestId],
        "42501",
      );
    });
  });

  it("keeps friend messages private, idempotent, and deletes them with the friendship", async () => {
    const friendshipId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await pg.exec("set local role service_role");
    await pg.query(
      "insert into public.friendships(id,user_low,user_high,requested_by) values($1,$2,$3,$2)",
      [friendshipId, A, B],
    );
    const first = await pg.query<{ id: string; body: string }>(
      "select id,body from public.send_friend_message($1,$2,$3,$4)",
      [friendshipId, A, messageId, "Good game"],
    );
    expect(first.rows).toEqual([{ id: messageId, body: "Good game" }]);
    const retry = await pg.query<{ id: string }>(
      "select id from public.send_friend_message($1,$2,$3,$4)",
      [friendshipId, A, messageId, "Good game"],
    );
    expect(retry.rows).toEqual([{ id: messageId }]);
    await expectSqlError(
      "select * from public.send_friend_message($1,$2,$3,$4)",
      [friendshipId, C, crypto.randomUUID(), "Intrusion"],
      "42501",
    );
    await expectSqlError(
      "select * from public.send_friend_message($1,$2,$3,$4)",
      [friendshipId, A, messageId, "Changed"],
      "23505",
    );
    await expectSqlError(
      "select * from public.send_friend_message($1,$2,$3,$4)",
      [friendshipId, A, crypto.randomUUID(), "bad\nline"],
      "22023",
    );
    await pg.exec("reset role");
    await asBrowser("authenticated", A, async () => {
      await expectSqlError("select * from public.friend_messages", [], "42501");
      await expectSqlError(
        "select * from public.send_friend_message($1,$2,$3,$4)",
        [friendshipId, A, crypto.randomUUID(), "Attempt"],
        "42501",
      );
    });
    await pg.exec("set local role service_role");
    await pg.query("delete from public.friendships where id=$1", [
      friendshipId,
    ]);
    expect(
      (await pg.query("select id from public.friend_messages")).rows,
    ).toEqual([]);
    await expectSqlError(
      "select * from public.send_friend_message($1,$2,$3,$4)",
      [friendshipId, A, crypto.randomUUID(), "After removal"],
      "42501",
    );
    await pg.exec("reset role");
  });

  it("settles equal-rated humans atomically with Glicko-1 RD updates", async () => {
    const input = match();
    const result = await settle(input);
    expect(result).toMatchObject({
      id: input.id,
      status: "settled",
      already_settled: false,
    });
    expect(result.rating_changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: A, before: 800, after: 962, delta: 162, before_rd: 350, after_rd: 290.231, outcome: "win" }),
        expect.objectContaining({ user_id: B, before: 800, after: 638, delta: -162, before_rd: 350, after_rd: 290.231, outcome: "loss" }),
      ]),
    );
    expect(result.rating_changes.reduce((sum, c) => sum + c.delta, 0)).toBe(0);
    expect(await rating(A)).toEqual({
      rating: 962,
      matches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    expect(await rating(B)).toEqual({
      rating: 638,
      matches: 1,
      wins: 0,
      losses: 1,
      draws: 0,
    });
    expect(
      (
        await pg.query("select * from public.participants where match_id=$1", [
          input.id,
        ])
      ).rows,
    ).toHaveLength(2);
    expect(
      (
        await pg.query("select * from public.rating_ledger where match_id=$1", [
          input.id,
        ])
      ).rows,
    ).toHaveLength(2);
  });

  it("keeps equal-rated draw scores equal while reducing both RDs", async () => {
    const result = await settle(
      match({ result: { outcome: "draw", winner_id: null, reason: "draw" } }),
    );
    expect(
      result.rating_changes.every((c) => c.delta === 0 && c.outcome === "draw"),
    ).toBe(true);
    for (const id of [A, B]) {
      expect(await rating(id)).toEqual({
        rating: 800,
        matches: 1,
        wins: 0,
        losses: 0,
        draws: 1,
      });
      const rd = await pg.query<{ rd: string }>(
        "select rd from public.arena_ratings where user_id=$1 and arena='easy' and mode='human'",
        [id],
      );
      expect(Number(rd.rows[0].rd)).toBe(290.231);
    }
  });

  it("awards a large upset change to 800 versus 1200 using both pre-match RDs", async () => {
    await pg.query(
      "update public.arena_ratings set rating=1200 where user_id=$1 and arena='easy' and mode='human'",
      [B],
    );
    const result = await settle(match({
      participants: [
        { user_id: A, pre_rating: 800, pre_rd: 350 },
        { user_id: B, pre_rating: 1200, pre_rd: 350 },
      ],
    }));
    expect(result.rating_changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: A, before: 800, delta: 307, after: 1107, after_rd: 311.304 }),
      expect.objectContaining({ user_id: B, before: 1200, delta: -307, after: 893, after_rd: 311.304 }),
    ]));
  });

  it("updates each human independently when their rating deviations differ", async () => {
    await pg.query(
      "update public.arena_ratings set rd=50 where user_id=$1 and arena='easy' and mode='human'",
      [B],
    );
    const result = await settle(match({ participants: [
      { user_id: A, pre_rating: 800, pre_rd: 350 },
      { user_id: B, pre_rating: 800, pre_rd: 50 },
    ] }));
    const winner = result.rating_changes.find((change) => change.user_id === A)!;
    const loser = result.rating_changes.find((change) => change.user_id === B)!;
    expect(winner.delta).toBeGreaterThan(0);
    expect(loser.delta).toBeLessThan(0);
    expect(winner.delta).toBeGreaterThan(-loser.delta);
    expect(winner.after_rd).toBeLessThan(350);
    expect(loser.after_rd).toBeGreaterThanOrEqual(30);
  });

  it("keeps unequal draws at zero points while lowering both rating deviations", async () => {
    await pg.query(
      "update public.arena_ratings set rating=1200 where user_id=$1 and arena='easy' and mode='human'",
      [A],
    );
    const result = await settle(match({
      result: { outcome: "draw", winner_id: null, reason: "draw" },
      participants: [
        { user_id: A, pre_rating: 1200, pre_rd: 350 },
        { user_id: B, pre_rating: 800, pre_rd: 350 },
      ],
    }));
    expect(result.rating_changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: A, delta: 0, after: 1200, after_rd: 311.304, outcome: "draw" }),
      expect.objectContaining({ user_id: B, delta: 0, after: 800, after_rd: 311.304, outcome: "draw" }),
    ]));
  });

  it("increases uncertainty after inactivity but never beyond the new-player RD", async () => {
    const now = new Date();
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
    const values = await pg.query<{ after_year: string; after_day: string }>(
      "select public.glicko_rd_at(50,$1,$2) as after_year, public.glicko_rd_at(50,$3,$2) as after_day",
      [yearAgo.toISOString(), now.toISOString(), new Date(now.getTime() - 86_400_000).toISOString()],
    );
    expect(Number(values.rows[0].after_year)).toBe(350);
    expect(Number(values.rows[0].after_day)).toBeGreaterThan(50);
    expect(Number(values.rows[0].after_day)).toBeLessThan(350);
  });

  it("rejects a stale RD snapshot without partial settlement", async () => {
    const input = match({ participants: [
      { user_id: A, pre_rating: 800, pre_rd: 300 },
      { user_id: B, pre_rating: 800, pre_rd: 350 },
    ] });
    await expectSqlError(
      "select public.settle_match($1::jsonb)", [JSON.stringify(input)], "40001",
    );
    expect((await pg.query("select id from public.matches where id=$1", [input.id])).rows).toHaveLength(0);
    expect((await pg.query("select match_id from public.rating_ledger where match_id=$1", [input.id])).rows).toHaveLength(0);
    expect((await rating(A)).rating).toBe(800);
  });

  it("voids change neither ratings nor match counters", async () => {
    const result = await settle(
      match({ result: { outcome: "void", winner_id: null, reason: "void" } }),
    );
    expect(result.status).toBe("void");
    expect(
      result.rating_changes.every((c) => c.delta === 0 && c.outcome === "void"),
    ).toBe(true);
    for (const id of [A, B])
      expect(await rating(id)).toEqual({
        rating: 800,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      });
  });

  it.each([
    { winner: A, delta: 175 },
    { winner: "bot", delta: -175 },
  ])(
    "bot match winner $winner changes only the human bot rating by $delta",
    async ({ winner, delta }) => {
      const result = await settle(
        match({
          mode: "bot",
          result: { outcome: "win", winner_id: winner, reason: "solved" },
          participants: [
            { user_id: A, pre_rating: 800, pre_rd: 350 },
            { user_id: null, bot_rating: 800, pre_rating: 800, pre_rd: 100 },
          ],
        }),
      );
      expect(result.rating_changes).toHaveLength(1);
      expect(result.rating_changes[0]).toMatchObject({
        user_id: A,
        delta,
        after: 800 + delta,
      });
      expect((await rating(A, "easy", "bot")).rating).toBe(800 + delta);
      expect((await rating(A, "easy", "human")).rating).toBe(800);
      expect(
        (
          await pg.query(
            "select * from public.arena_ratings where user_id=$1 and rating<>800",
            [A],
          )
        ).rows,
      ).toHaveLength(1);
    },
  );

  it("repeated identical settlement returns the original ledger without another award", async () => {
    const input = match();
    const first = await settle(input);
    const again = await settle(input);
    expect(again.already_settled).toBe(true);
    expect(again.rating_changes).toEqual(first.rating_changes);
    expect((await rating(A)).matches).toBe(1);
    expect((await rating(A)).rating).toBe(962);
    expect(
      (await pg.query("select * from public.matches where id=$1", [input.id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await pg.query("select * from public.rating_ledger where match_id=$1", [
          input.id,
        ])
      ).rows,
    ).toHaveLength(2);
  });

  it("rejects a conflicting retry while preserving the original result and ratings", async () => {
    const input = match();
    await settle(input);
    const conflicting = { ...input, result: { ...input.result, winner_id: B } };
    await expectSqlError(
      "select public.settle_match($1::jsonb)",
      [JSON.stringify(conflicting)],
      "22023",
    );
    expect((await rating(A)).rating).toBe(962);
    expect((await rating(B)).rating).toBe(638);
    const stored = await pg.query<{ result: { winner_id: string } }>(
      "select result from public.matches where id=$1",
      [input.id],
    );
    expect(stored.rows[0].result.winner_id).toBe(A);
  });

  it("rolls back the whole settlement when a pre-match rating no longer agrees", async () => {
    const input = match({
      participants: [
        { user_id: A, pre_rating: 800, pre_rd: 350 },
        { user_id: B, pre_rating: 799, pre_rd: 350 },
      ],
    });
    await expectSqlError(
      "select public.settle_match($1::jsonb)",
      [JSON.stringify(input)],
      "40001",
    );
    for (const table of ["matches", "participants", "rating_ledger"]) {
      const column = table === "matches" ? "id" : "match_id";
      expect(
        (await pg.query(`select * from public.${table} where ${column}=$1`, [input.id])).rows,
      ).toHaveLength(0);
    }
    for (const id of [A, B])
      expect(await rating(id)).toEqual({
        rating: 800,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      });
  });

  it("denies browser mutation, private problem reads, and privileged RPC execution", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await asBrowser(role, role === "authenticated" ? A : null, async () => {
        expect(
          (
            await pg.query(
              "select id, username, display_name, avatar_url from public.profiles",
            )
          ).rows.length,
        ).toBeGreaterThan(0);
        expect(
          (await pg.query("select rating from public.arena_ratings")).rows
            .length,
        ).toBeGreaterThan(0);
        await expectSqlError(
          "update public.arena_ratings set rating=9999 where user_id=$1",
          [A],
          "42501",
        );
        await expectSqlError(
          "update public.profiles set display_name=$1 where id=$2",
          ["Forged", A],
          "42501",
        );
        await expectSqlError(
          "select private from public.problems",
          [],
          "42501",
        );
        await expectSqlError("select public from public.problems", [], "42501");
        await expectSqlError(
          "select public.settle_match($1::jsonb)",
          [JSON.stringify(match())],
          "42501",
        );
        await expectSqlError(
          "select public.purge_submission_sources()",
          [],
          "42501",
        );
        await expectSqlError(
          "select * from public.glicko_after(800,350,1200,100,1)",
          [],
          "42501",
        );
        await expectSqlError(
          "select public.glicko_rd_at(50,now(),now())",
          [],
          "42501",
        );
      });
    }
  });

  it("limits authenticated match history, submissions, and ledger to their owner", async () => {
    const own = match({
      result: { outcome: "draw", winner_id: null, reason: "draw" },
    });
    const other = match({
      result: { outcome: "draw", winner_id: null, reason: "draw" },
      participants: [
        { user_id: B, pre_rating: 800, pre_rd: 350 },
        { user_id: C, pre_rating: 800, pre_rd: 350 },
      ],
      arena: "medium",
      problem_id: "test-medium",
    });
    await settle(own);
    await settle(other);
    await sourceRow(own.id, A, 0, own.ended_at, "my source");
    await sourceRow(own.id, B, 1, own.ended_at, "opponent source");
    await sourceRow(other.id, B, 0, other.ended_at, "other match source");
    await asBrowser("authenticated", A, async () => {
      expect((await pg.query("select id from public.matches")).rows).toEqual([
        { id: own.id },
      ]);
      expect(
        (await pg.query("select source from public.submissions")).rows,
      ).toEqual([{ source: "my source" }]);
      expect(
        (await pg.query("select user_id from public.rating_ledger")).rows,
      ).toEqual([{ user_id: A }]);
      await expectSqlError(
        "select payload from public.submissions",
        [],
        "42501",
      );
      await expectSqlError(
        "select settlement_payload from public.matches",
        [],
        "42501",
      );
    });
  });

  it("purges only sources older than 30 days while retaining compact results", async () => {
    const oldEnd = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const old = match({
      started_at: new Date(Date.parse(oldEnd) - 60_000).toISOString(),
      ended_at: oldEnd,
      result: { outcome: "draw", winner_id: null, reason: "draw" },
    });
    const fresh = match({
      arena: "medium",
      problem_id: "test-medium",
      result: { outcome: "draw", winner_id: null, reason: "draw" },
    });
    await settle(old);
    await settle(fresh);
    const oldSource = await sourceRow(old.id, A, 0, old.ended_at);
    const freshSource = await sourceRow(fresh.id, A, 0, fresh.ended_at);
    await pg.exec("set local role service_role");
    const purge = await pg.query<{ removed: number | string }>(
      "select public.purge_submission_sources() as removed",
    );
    await pg.exec("reset role");
    expect(Number(purge.rows[0].removed)).toBe(1);
    const sources = await pg.query<{
      id: string;
      source: string | null;
      verdict: string;
    }>("select id, source, verdict from public.submissions");
    expect(sources.rows.find((s) => s.id === oldSource)).toMatchObject({
      source: null,
      verdict: "accepted",
    });
    expect(sources.rows.find((s) => s.id === freshSource)?.source).toBe(
      "return 42;",
    );
    expect((await pg.query("select id from public.matches")).rows).toHaveLength(
      3,
    );
    expect(
      (await pg.query("select match_id from public.rating_ledger")).rows,
    ).toHaveLength(6);
    expect(
      Number(
        (
          await pg.query<{ removed: number | string }>(
            "select public.purge_submission_sources() as removed",
          )
        ).rows[0].removed,
      ),
    ).toBe(0);
  });
});
