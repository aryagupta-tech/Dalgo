import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const player = "11111111-1111-4111-8111-111111111111";
const opponent = "22222222-2222-4222-8222-222222222222";
const matchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const problem = JSON.parse(
  readFileSync(new URL("../../public/problems.json", import.meta.url), "utf8"),
).find((value: { arena: string }) => value.arena === "easy");

async function signInLocally(page: Page) {
  await page.addInitScript(
    ({ id }) => {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const token =
        btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
        "." +
        btoa(JSON.stringify({ sub: id, aud: "authenticated", exp: expires })) +
        ".signature";
      localStorage.setItem(
        "sb-testproject-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "browser-test-only",
          expires_at: expires,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: "tester@example.invalid",
            app_metadata: { provider: "github" },
            user_metadata: { full_name: "Test account" },
            created_at: "2026-09-12T00:00:00Z",
          },
        }),
      );
    },
    { id: player },
  );
}

function liveMatch() {
  const now = Date.now();
  return {
    id: matchId,
    arena: "easy",
    mode: "human",
    status: "active",
    problem,
    startsAt: now - 60_000,
    endsAt: now + 540_000,
    serverNow: now,
    players: [
      { id: player, name: "Test account", rating: 1200 },
      { id: opponent, name: "Opponent", rating: 1200 },
    ],
    opponentStatus: "Solving",
    attempts: { runs: 1, submits: 0 },
    result: null,
    submissions: [
      {
        id: "sample-run",
        userId: player,
        kind: "run",
        language: "python",
        receivedAt: now - 1000,
        sequence: 0,
        verdict: "wrong_answer",
        message: "Some sample cases did not pass.",
        sampleResults: [{ passed: false, actual: [999], expected: [3] }],
      },
    ],
  };
}
async function mockServices(
  page: Page,
  queue: () => Record<string, unknown>,
  cancelQueue?: (body: { requestId?: string }) => Record<string, unknown>,
) {
  const mutations: { method: string; body: { requestId?: string } }[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/socket-ticket") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Polling in this browser test." }),
      });
      return;
    }
    if (path === "/api/queue" && method !== "GET")
      mutations.push({ method, body: route.request().postDataJSON() });
    const data =
      path === "/api/config"
        ? {
            supabaseUrl: "https://testproject.supabase.invalid",
            supabaseKey: "browser-test-only",
            admissionMode: "staging",
            playEnabled: false,
            reason: "New admissions are paused.",
            dailyCapacity: null,
          }
        : path === "/api/admission"
          ? {
              mode: "staging",
              canJoin: false,
              reason: "New admissions are paused.",
            }
          : path === "/api/queue"
            ? method === "DELETE"
              ? {
                  ...(cancelQueue
                    ? cancelQueue(route.request().postDataJSON())
                    : { status: "idle" }),
                  serverNow: Date.now(),
                }
              : { ...queue(), serverNow: Date.now() }
            : path === "/api/matches/" + matchId
              ? liveMatch()
              : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return mutations;
}

test("a paused lobby resumes a real match and exposes only sample output inspection", async ({
  page,
}) => {
  await signInLocally(page);
  const mutations = await mockServices(page, () => ({
    status: "matched",
    matchId,
    arena: "easy",
    requestId,
  }));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Matches unavailable", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Resume match" }).click();
  await expect(page).toHaveURL(new RegExp("/match/" + matchId + "$"));
  await expect(page.getByText("RANKED 1v1", { exact: true })).toBeVisible();
  await page.getByText("Case 1 · failed", { exact: true }).click();
  await expect(page.getByText("Actual", { exact: true })).toBeVisible();
  await expect(
    page.locator("pre code").filter({ hasText: /999/ }),
  ).toBeVisible();
  await expect(
    page.locator("pre code").filter({ hasText: /^\[\s*3\s*\]$/ }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test("resuming a paused search reads its canonical request and cancels without a new join", async ({
  page,
}) => {
  await signInLocally(page);
  const mutations = await mockServices(page, () => ({
    status: "waiting",
    arena: "easy",
    requestId,
    joinedAt: Date.now() - 3000,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Resume search" }).click();
  await expect(
    page.getByRole("heading", { name: "Finding an opponent" }),
  ).toBeVisible();
  await expect(
    page.getByText(/bot fallback starts after 15 seconds/i),
  ).toBeVisible();
  await expect(page.getByText(/Human-first search/i)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cancel search", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toEqual([{ method: "DELETE", body: { requestId } }]);
});

test("cancellation retries with the server's canonical queue request", async ({
  page,
}) => {
  await signInLocally(page);
  const canonicalRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let cancellationAttempt = 0;
  const mutations = await mockServices(
    page,
    () => ({
      status: "waiting",
      arena: "easy",
      requestId,
      joinedAt: Date.now() - 3000,
    }),
    () =>
      ++cancellationAttempt === 1
        ? {
            status: "waiting",
            arena: "easy",
            requestId: canonicalRequestId,
            joinedAt: Date.now() - 3000,
          }
        : { status: "idle" },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Resume search" }).click();
  await page
    .getByRole("button", { name: "Cancel search", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toEqual([
    { method: "DELETE", body: { requestId } },
    { method: "DELETE", body: { requestId: canonicalRequestId } },
  ]);
});

test("a resumed search follows an assignment made while the lobby was open", async ({
  page,
}) => {
  await signInLocally(page);
  let reads = 0;
  const mutations = await mockServices(page, () =>
    ++reads === 1
      ? {
          status: "waiting",
          arena: "easy",
          requestId,
          joinedAt: Date.now() - 3000,
        }
      : { status: "matched", arena: "easy", requestId, matchId },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Resume search" }).click();
  await expect(page).toHaveURL(new RegExp("/match/" + matchId + "$"));
  await expect(page.getByText("RANKED 1v1", { exact: true })).toBeVisible();
  expect(mutations).toEqual([]);
});

test("OAuth from a match preserves the validated same-origin return route", async ({
  page,
}) => {
  await mockServices(page, () => ({
    status: "matched",
    matchId,
    arena: "easy",
    requestId,
  }));
  let callback = "";
  await page.route(
    "https://testproject.supabase.invalid/auth/v1/authorize**",
    async (route) => {
      callback =
        new URL(route.request().url()).searchParams.get("redirect_to") ?? "";
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "OAuth provider stub",
      });
    },
  );
  await page.goto("/match/" + matchId);
  const expected = page.url();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect.poll(() => callback).toBe(expected);
  await signInLocally(page);
  await page.goto(callback);
  await expect(page.getByText("RANKED 1v1", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(expected);
});
