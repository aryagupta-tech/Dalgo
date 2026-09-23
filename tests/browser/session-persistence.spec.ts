import { expect, test } from "@playwright/test";

const playerId = "11111111-1111-4111-8111-111111111111";
const storageKey = "sb-testproject-auth-token";
const rotatedRefreshToken = "rotated-browser-session";

function accessToken(id: string, expiresAt: number) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({ sub: id, aud: "authenticated", exp: expiresAt }),
    ).toString("base64url"),
    "signature",
  ].join(".");
}

test("a stored session refreshes once and survives a browser reload", async ({
  page,
}) => {
  await page.addInitScript(
    ({ id, key }) => {
      if (localStorage.getItem(key)) return;
      const expires = Math.floor(Date.now() / 1000) + 30;
      const token =
        btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
        "." +
        btoa(JSON.stringify({ sub: id, aud: "authenticated", exp: expires })) +
        ".signature";
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: token,
          refresh_token: "persistent-browser-session",
          expires_at: expires,
          expires_in: 30,
          token_type: "bearer",
          user: {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: "persistent@example.invalid",
            app_metadata: { provider: "google" },
            user_metadata: { full_name: "Persistent Player" },
            created_at: "2026-09-20T00:00:00Z",
          },
        }),
      );
    },
    { id: playerId, key: storageKey },
  );

  let configAttempts = 0;
  let refreshAttempts = 0;
  const authorized: string[] = [];
  await page.route("https://testproject.supabase.invalid/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route(
    "https://testproject.supabase.invalid/auth/v1/token**",
    async (route) => {
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers":
              "authorization, apikey, content-type, x-client-info",
          },
        });
      refreshAttempts += 1;
      expect(
        new URL(route.request().url()).searchParams.get("grant_type"),
      ).toBe("refresh_token");
      expect(route.request().postDataJSON()).toMatchObject({
        refresh_token: "persistent-browser-session",
      });
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          access_token: accessToken(playerId, expiresAt),
          refresh_token: rotatedRefreshToken,
          expires_at: expiresAt,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: playerId,
            aud: "authenticated",
            role: "authenticated",
            email: "persistent@example.invalid",
            app_metadata: { provider: "google" },
            user_metadata: { full_name: "Persistent Player" },
            created_at: "2026-09-20T00:00:00Z",
          },
        }),
      });
    },
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") {
      configAttempts += 1;
      if (configAttempts < 3)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporarily unavailable" }),
        });
      return route.fulfill({
        json: {
          supabaseUrl: "https://testproject.supabase.invalid",
          supabaseKey: "browser-test-only",
          playEnabled: true,
          admissionMode: "public",
          reason: "",
          dailyCapacity: null,
        },
      });
    }
    authorized.push(route.request().headers().authorization ?? "");
    const data =
      path === "/api/profile"
        ? {
            id: playerId,
            username: "persistent_player",
            usernameConfigured: true,
            name: "Persistent Player",
          }
        : path === "/api/admission"
          ? { mode: "public", canJoin: true, reason: "" }
          : path === "/api/ratings" || path === "/api/history"
            ? []
            : { status: "idle" };
    return route.fulfill({ json: data });
  });

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Your account", exact: true }),
  ).toBeVisible();
  expect(configAttempts).toBeGreaterThanOrEqual(3);
  expect(refreshAttempts).toBe(1);
  await expect.poll(() => authorized.filter(Boolean).length).toBeGreaterThan(0);
  expect(
    authorized.filter(Boolean).every((value) => value.startsWith("Bearer ")),
  ).toBe(true);

  const storedBeforeReload = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  expect(JSON.parse(storedBeforeReload ?? "null")?.refresh_token).toBe(
    rotatedRefreshToken,
  );

  await page.reload();
  await expect(
    page.getByRole("link", { name: "Your account", exact: true }),
  ).toBeVisible();
  expect(refreshAttempts).toBe(1);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
    .toBe(storedBeforeReload);
});
