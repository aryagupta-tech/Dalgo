import { expect, test, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const config = {
  supabaseUrl: "https://testproject.supabase.invalid",
  supabaseKey: "browser-test-only",
  playEnabled: true,
  admissionMode: "public",
  reason: "",
  dailyCapacity: null,
};
const player = {
  id,
  username: "ready_player",
  usernameConfigured: true,
  name: "Ready Player",
};
const leaders = [
  {
    user_id: id,
    rating: 850,
    matches: 2,
    profiles: { username: "ready_player", display_name: "Ready Player" },
  },
];

async function signedIn(page: Page) {
  await page.addInitScript(
    ({ id, config }) => {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem("dalgo:auth-config:v1", JSON.stringify(config));
      localStorage.setItem(
        "sb-testproject-auth-token",
        JSON.stringify({
          access_token:
            btoa(JSON.stringify({ alg: "HS256" })) +
            "." +
            btoa(
              JSON.stringify({ sub: id, exp: expires, aud: "authenticated" }),
            ) +
            ".signature",
          refresh_token: "fixture-only",
          expires_at: expires,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: "ready@example.invalid",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-09-20T00:00:00Z",
          },
        }),
      );
    },
    { id, config },
  );
  await page.route("https://testproject.supabase.invalid/**", (route) =>
    route.fulfill({ status: 204 }),
  );
}

test("match availability recovers from failed startup without reloading", async ({
  page,
}) => {
  await signedIn(page);
  let available = false;
  let configAttempts = 0;
  let admissionAttempts = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") {
      configAttempts++;
      if (!available)
        return route.fulfill({
          status: 503,
          json: { error: "Temporary failure" },
        });
      return route.fulfill({ json: config });
    }
    if (path === "/api/admission") {
      admissionAttempts++;
      return route.fulfill({
        status: available ? 200 : 503,
        json: available
          ? { mode: "public", canJoin: true, reason: "" }
          : { error: "Temporary failure" },
      });
    }
    return route.fulfill({
      json:
        path === "/api/profile"
          ? player
          : path === "/api/queue"
            ? { status: "idle" }
            : [],
    });
  });
  await page.goto("/");
  await expect.poll(() => configAttempts).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(1000); // Exhaust the startup retries before reconnecting.
  await expect(
    page.getByRole("button", { name: "Matches unavailable" }),
  ).toBeDisabled();
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Find a match" })).toBeEnabled({
    timeout: 4000,
  });
  expect(admissionAttempts).toBeGreaterThan(0);
});

test("a temporary admission error retries automatically and never admits an excluded player", async ({
  page,
}) => {
  await signedIn(page);
  let admissionAttempts = 0;
  let allowed = true;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admission") {
      admissionAttempts++;
      if (admissionAttempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Temporary failure" },
        });
      return route.fulfill({
        json: {
          mode: "public",
          canJoin: allowed,
          reason: allowed ? "" : "Access denied",
        },
      });
    }
    return route.fulfill({
      json:
        path === "/api/config"
          ? config
          : path === "/api/profile"
            ? player
            : path === "/api/queue"
              ? { status: "idle" }
              : [],
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Find a match" })).toBeEnabled({
    timeout: 4000,
  });
  expect(admissionAttempts).toBeGreaterThan(1);
  allowed = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Matches unavailable" }),
  ).toBeDisabled();
});

test("rankings load while matches are disabled and refresh on return to the tab", async ({
  page,
}) => {
  let rating = 850;
  let fail = false;
  let attempts = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/leaderboard") {
      attempts++;
      expect(route.request().headers().authorization).toBeUndefined();
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: "Temporary failure" },
        });
      return route.fulfill({
        json: leaders.map((row) => ({ ...row, rating })),
      });
    }
    return route.fulfill({
      json:
        path === "/api/config"
          ? { ...config, supabaseUrl: "", supabaseKey: "", playEnabled: false }
          : [],
    });
  });
  await page.goto("/leaderboard");
  await expect(
    page.getByRole("cell", { name: "850", exact: true }),
  ).toBeVisible({ timeout: 4000 });
  rating = 920;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("cell", { name: "920", exact: true }),
  ).toBeVisible();
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Retry rankings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "920", exact: true }),
  ).toBeVisible();
  fail = false;
  rating = 950;
  await page.getByRole("button", { name: "Retry rankings" }).click();
  await expect(
    page.getByRole("cell", { name: "950", exact: true }),
  ).toBeVisible();
  expect(attempts).toBeGreaterThan(3);
});

test("switching arenas ignores a late response from the previous leaderboard", async ({
  page,
}) => {
  let releaseMedium!: () => void;
  const medium = new Promise<void>((resolve) => {
    releaseMedium = resolve;
  });
  let mediumRequested = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/leaderboard") {
      const arena = url.searchParams.get("arena");
      if (arena === "medium") {
        mediumRequested = true;
        await medium;
      }
      return route
        .fulfill({
          json: leaders.map((row) => ({
            ...row,
            rating: arena === "hard" ? 980 : arena === "medium" ? 900 : 850,
          })),
        })
        .catch(() => {});
    }
    return route.fulfill({
      json:
        url.pathname === "/api/config"
          ? { ...config, supabaseUrl: "", supabaseKey: "" }
          : [],
    });
  });
  await page.goto("/leaderboard");
  await expect(
    page.getByRole("cell", { name: "850", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Medium", exact: true }).click();
  await expect.poll(() => mediumRequested).toBe(true);
  await page.getByRole("button", { name: "Hard", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "980", exact: true }),
  ).toBeVisible();
  releaseMedium();
  await expect(
    page.getByRole("table", { name: "Hard human ratings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "980", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "900", exact: true }),
  ).toHaveCount(0);
});
