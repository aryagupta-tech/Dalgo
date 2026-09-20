import { expect, test, type Page } from "@playwright/test";

const me = "11111111-1111-4111-8111-111111111111";
const friend = "22222222-2222-4222-8222-222222222222";
const challengeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const matchId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const myIdentity = {
  id: me,
  publicId: "DLG-AAAA-AAAA-AAAA-AAAA",
  name: "Test account",
};
const friendIdentity = {
  id: friend,
  publicId: "DLG-BBBB-BBBB-BBBB-BBBB",
  name: "Friend account",
};

async function authenticate(page: Page) {
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
            created_at: "2026-09-20T00:00:00Z",
          },
        }),
      );
    },
    { id: me },
  );
  await page.route("https://testproject.supabase.invalid/**", (route) =>
    route.fulfill({ status: 204 }),
  );
}

function config(path: string) {
  if (path === "/api/config")
    return {
      supabaseUrl: "https://testproject.supabase.invalid",
      supabaseKey: "browser-test-only",
      playEnabled: true,
      admissionMode: "public",
      reason: "",
      dailyCapacity: null,
    };
  if (path === "/api/admission")
    return { mode: "public", canJoin: true, reason: "" };
  if (path === "/api/profile") return myIdentity;
  return null;
}

test("a signed-in player shares an ID and sends then cancels a friend challenge", async ({
  page,
}) => {
  await authenticate(page);
  let open: any[] = [];
  const authorized: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const fixed = config(url.pathname);
    if (route.request().headers().authorization) authorized.push(url.pathname);
    if (fixed) return route.fulfill({ json: fixed });
    if (url.pathname === "/api/socket-ticket")
      return route.fulfill({ status: 503, json: { error: "Use HTTP state." } });
    if (
      url.pathname === "/api/challenges" &&
      route.request().method() === "GET"
    )
      return route.fulfill({
        json: {
          serverNow: Date.now(),
          incoming: [],
          outgoing: open,
          recent: [],
        },
      });
    if (
      url.pathname === "/api/challenges" &&
      route.request().method() === "POST"
    ) {
      const request = route.request().postDataJSON();
      open = [
        {
          id: request.requestId,
          arena: request.arena,
          status: "open",
          challenger: myIdentity,
          challenged: friendIdentity,
          createdAt: Date.now(),
          expiresAt: Date.now() + 600_000,
        },
      ];
      return route.fulfill({ status: 201, json: open[0] });
    }
    if (
      url.pathname.startsWith("/api/challenges/") &&
      route.request().method() === "DELETE"
    ) {
      const cancelled = {
        ...open[0],
        status: "cancelled",
        respondedAt: Date.now(),
      };
      open = [];
      return route.fulfill({ json: cancelled });
    }
    return route.fulfill({
      status: 404,
      json: { error: "Unhandled test route." },
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/friends");
  await expect(
    page.getByRole("heading", { name: "Play a friend." }),
  ).toBeVisible();
  await expect(
    page.getByText(myIdentity.publicId, { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Friend's Dalgo ID")
    .fill(friendIdentity.publicId.toLowerCase());
  await page.getByRole("radio", { name: "Medium" }).check();
  await page.getByRole("button", { name: "Send challenge" }).click();
  await expect(page.getByText("Friend account", { exact: true })).toBeVisible();
  await expect(page.getByText(/MEDIUM · INVITE SENT/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByText("No open challenges.", { exact: false }),
  ).toBeVisible();
  expect(authorized).toEqual(
    expect.arrayContaining(["/api/profile", "/api/challenges"]),
  );
});

test("the intended friend can accept and enters the authoritative match route", async ({
  page,
}) => {
  await authenticate(page);
  const incoming = {
    id: challengeId,
    arena: "hard",
    status: "open",
    challenger: friendIdentity,
    challenged: myIdentity,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const fixed = config(url.pathname);
    if (fixed) return route.fulfill({ json: fixed });
    if (url.pathname === "/api/socket-ticket")
      return route.fulfill({ status: 503, json: { error: "Use HTTP state." } });
    if (
      url.pathname === "/api/challenges" &&
      route.request().method() === "GET"
    )
      return route.fulfill({
        json: {
          serverNow: Date.now(),
          incoming: [incoming],
          outgoing: [],
          recent: [],
        },
      });
    if (url.pathname === `/api/challenges/${challengeId}/accept`)
      return route.fulfill({
        json: {
          ...incoming,
          status: "accepted",
          respondedAt: Date.now(),
          matchId,
        },
      });
    if (url.pathname === `/api/matches/${matchId}`)
      return route.fulfill({
        status: 503,
        json: { error: "Match handoff reached." },
      });
    return route.fulfill({
      status: 404,
      json: { error: "Unhandled test route." },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/friends");
  await expect(page.getByText("Friend account", { exact: true })).toBeVisible();
  await expect(page.getByText(/HARD · CHALLENGED YOU/)).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page).toHaveURL(new RegExp(`/match/${matchId}$`));
});
