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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Run from the repository root, or set DALGO_PROJECT_ROOT to that directory.
// PostgreSQL is embedded and ephemeral; this never connects to Supabase.
const migration = readFileSync(
  resolve(
    process.env.DALGO_PROJECT_ROOT ?? process.cwd(),
    "supabase/migrations/202609110001_dalgo.sql",
  ),
  "utf8",
);
const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const EXISTING = "44444444-4444-4444-8444-444444444444";
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
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      insert into auth.users(id, raw_user_meta_data)
      values('${EXISTING}', '{"full_name":"Existing Coder"}');
    `);
    await pg.exec(migration);
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
        { user_id: A, pre_rating: 1200 },
        { user_id: B, pre_rating: 1200 },
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

  it("creates safe unique OAuth profiles and exactly six independent 1200 ratings", async () => {
    const profiles = await pg.query<{
      id: string;
      username: string;
      avatar_url: string | null;
    }>(
      "select id, username, avatar_url from public.profiles where id=any($1::uuid[])",
      [[A, B]],
    );
    expect(profiles.rows).toHaveLength(2);
    expect(new Set(profiles.rows.map((p) => p.username)).size).toBe(2);
    for (const p of profiles.rows) {
      expect(p.username).toMatch(/^[a-z0-9_]{3,32}$/);
      expect(p.avatar_url).toBeNull();
    }
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
      ratings.rows.every((r) => r.rating === 1200 && r.matches === 0),
    ).toBe(true);
  });

  it("backfills profiles and all six ratings for existing auth accounts", async () => {
    expect(
      (await pg.query("select id from public.profiles where id=$1", [EXISTING]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await pg.query(
          "select rating from public.arena_ratings where user_id=$1 and rating=1200",
          [EXISTING],
        )
      ).rows,
    ).toHaveLength(6);
  });

  it("settles equal-rated humans atomically with zero-sum +16/-16", async () => {
    const input = match();
    const result = await settle(input);
    expect(result).toMatchObject({
      id: input.id,
      status: "settled",
      already_settled: false,
    });
    expect(result.rating_changes).toEqual(
      expect.arrayContaining([
        { user_id: A, before: 1200, after: 1216, delta: 16, outcome: "win" },
        { user_id: B, before: 1200, after: 1184, delta: -16, outcome: "loss" },
      ]),
    );
    expect(result.rating_changes.reduce((sum, c) => sum + c.delta, 0)).toBe(0);
    expect(await rating(A)).toEqual({
      rating: 1216,
      matches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    expect(await rating(B)).toEqual({
      rating: 1184,
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

  it("draws change no rating and count one draw per participant", async () => {
    const result = await settle(
      match({ result: { outcome: "draw", winner_id: null, reason: "draw" } }),
    );
    expect(
      result.rating_changes.every((c) => c.delta === 0 && c.outcome === "draw"),
    ).toBe(true);
    for (const id of [A, B])
      expect(await rating(id)).toEqual({
        rating: 1200,
        matches: 1,
        wins: 0,
        losses: 0,
        draws: 1,
      });
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
        rating: 1200,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      });
  });

  it.each([
    { winner: A, delta: 16 },
    { winner: "bot", delta: -16 },
  ])(
    "bot match winner $winner changes only the human bot rating by $delta",
    async ({ winner, delta }) => {
      const result = await settle(
        match({
          mode: "bot",
          result: { outcome: "win", winner_id: winner, reason: "solved" },
          participants: [
            { user_id: A, pre_rating: 1200 },
            { user_id: null, bot_rating: 1200, pre_rating: 1200 },
          ],
        }),
      );
      expect(result.rating_changes).toHaveLength(1);
      expect(result.rating_changes[0]).toMatchObject({
        user_id: A,
        delta,
        after: 1200 + delta,
      });
      expect((await rating(A, "easy", "bot")).rating).toBe(1200 + delta);
      expect((await rating(A, "easy", "human")).rating).toBe(1200);
      expect(
        (
          await pg.query(
            "select * from public.arena_ratings where user_id=$1 and rating<>1200",
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
    expect((await rating(A)).rating).toBe(1216);
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
    expect((await rating(A)).rating).toBe(1216);
    expect((await rating(B)).rating).toBe(1184);
    const stored = await pg.query<{ result: { winner_id: string } }>(
      "select result from public.matches where id=$1",
      [input.id],
    );
    expect(stored.rows[0].result.winner_id).toBe(A);
  });

  it("rolls back the whole settlement when a pre-match rating no longer agrees", async () => {
    const input = match({
      participants: [
        { user_id: A, pre_rating: 1200 },
        { user_id: B, pre_rating: 1199 },
      ],
    });
    await expectSqlError(
      "select public.settle_match($1::jsonb)",
      [JSON.stringify(input)],
      "40001",
    );
    for (const table of ["matches", "participants", "rating_ledger"]) {
      expect(
        (await pg.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    }
    for (const id of [A, B])
      expect(await rating(id)).toEqual({
        rating: 1200,
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
        { user_id: B, pre_rating: 1200 },
        { user_id: C, pre_rating: 1200 },
      ],
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
      2,
    );
    expect(
      (await pg.query("select match_id from public.rating_ledger")).rows,
    ).toHaveLength(4);
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
