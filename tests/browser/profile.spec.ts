import { expect, test, type Page } from "@playwright/test";

const playerId = "11111111-1111-4111-8111-111111111111";
const avatarFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8AARAwMjDAGAA8AAQUBAScAAAAASUVORK5CYII=",
  "base64",
);
const profile = {
  id: playerId,
  username: "test_account",
  usernameConfigured: true,
  name: "Test Account",
};
const ratings = [
  {
    arena: "easy",
    mode: "human",
    rating: 1248,
    matches: 4,
    wins: 3,
    losses: 1,
    draws: 0,
  },
  {
    arena: "easy",
    mode: "bot",
    rating: 1210,
    matches: 3,
    wins: 1,
    losses: 1,
    draws: 1,
  },
  {
    arena: "medium",
    mode: "human",
    rating: 1205,
    matches: 5,
    wins: 2,
    losses: 2,
    draws: 1,
  },
  {
    arena: "medium",
    mode: "bot",
    rating: 1264,
    matches: 2,
    wins: 2,
    losses: 0,
    draws: 0,
  },
  {
    arena: "hard",
    mode: "human",
    rating: 1184,
    matches: 3,
    wins: 1,
    losses: 1,
    draws: 1,
  },
  {
    arena: "hard",
    mode: "bot",
    rating: 1192,
    matches: 2,
    wins: 1,
    losses: 1,
    draws: 0,
  },
];

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
            email: "private@example.invalid",
            app_metadata: { provider: "github" },
            user_metadata: { full_name: "Test Account" },
            created_at: "2026-09-20T00:00:00Z",
          },
        }),
      );
    },
    { id: playerId },
  );
  await page.route("https://testproject.supabase.invalid/**", (route) =>
    route.fulfill({ status: 204 }),
  );
}

function appConfig() {
  return {
    supabaseUrl: "https://testproject.supabase.invalid",
    supabaseKey: "browser-test-only",
    playEnabled: true,
    admissionMode: "public",
    reason: "",
    dailyCapacity: null,
  };
}

async function mockSignedInApi(page: Page, failAccountData = false) {
  let currentProfile: typeof profile & { avatar?: string } = { ...profile };
  await page.route("https://cdn.example.invalid/profile-avatar.webp", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: avatarFixture,
    }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: appConfig() });
    if (path === "/api/admission")
      return route.fulfill({
        json: { mode: "public", canJoin: true, reason: "" },
      });
    if (path === "/api/profile/avatar" && route.request().method() === "PUT") {
      currentProfile = {
        ...currentProfile,
        avatar: "https://cdn.example.invalid/profile-avatar.webp",
      };
      return route.fulfill({ json: currentProfile });
    }
    if (path === "/api/profile")
      return failAccountData
        ? route.fulfill({
            status: 503,
            json: { error: "Profile service unavailable." },
          })
        : route.fulfill({ json: currentProfile });
    if (path === "/api/ratings")
      return failAccountData
        ? route.fulfill({
            status: 503,
            json: { error: "Ratings service unavailable." },
          })
        : route.fulfill({ json: ratings });
    return route.fulfill({ status: 404, json: { error: "Not mocked" } });
  });
}

for (const viewport of [
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 960 },
]) {
  test(`account icon opens the complete profile on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await authenticate(page);
    await mockSignedInApi(page);
    await page.goto("/");

    await page.getByRole("link", { name: "Your account" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole("heading", { name: "Your profile", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Test Account", { exact: true })).toBeVisible();
    const identity = page.locator(
      'section[aria-labelledby="profile-identity-heading"]',
    );
    await expect(
      identity.getByText("@test_account", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Joined September 2026")).toBeVisible();
    await expect(page.getByText("Signed in with GitHub")).toBeVisible();

    const record = page.locator(
      'section[aria-labelledby="profile-record-heading"]',
    );
    await expect(record.getByText("19", { exact: true })).toBeVisible();
    await expect(record.getByText("10", { exact: true })).toBeVisible();
    await expect(record.getByText("6", { exact: true })).toBeVisible();
    await expect(record.getByText("3", { exact: true })).toBeVisible();
    await expect(record.getByText("53%", { exact: true })).toBeVisible();

    const table = page.getByRole("table", { name: "Your arena ratings" });
    await expect(table.getByRole("row", { name: /Easy 1248/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /Medium 1205/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /Hard 1184/ })).toBeVisible();
    const account = page.locator(
      'section[aria-labelledby="profile-actions-heading"]',
    );
    await expect(
      account.getByRole("link", { name: /Match history/ }),
    ).toHaveAttribute("href", "/history");
    await expect(
      account.getByRole("link", { name: /Friends/ }),
    ).toHaveAttribute("href", "/friends");
    await expect(
      account.getByRole("link", { name: /Privacy & support/ }),
    ).toHaveAttribute("href", "/privacy");
    await expect(
      account.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
    await expect(page.getByText("private@example.invalid")).toHaveCount(0);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
}

test("profile reports account and rating API failures without inventing data", async ({
  page,
}) => {
  await authenticate(page);
  await mockSignedInApi(page, true);
  await page.goto("/profile");

  await expect(page.getByText("Profile service unavailable.")).toBeVisible();
  await expect(page.getByText("Ratings service unavailable.")).toBeVisible();
  await expect(page.getByText("Username setup pending")).toBeVisible();
  await expect(page.getByText("—", { exact: true })).toHaveCount(11);
});

test("signed-out profile gives a direct sign-in path", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({
        json: {
          ...appConfig(),
          supabaseUrl: "",
          supabaseKey: "",
        },
      });
    return route.fulfill({ status: 401, json: { error: "Sign in required." } });
  });
  await page.goto("/profile");

  await expect(page.getByText("Sign in to view your profile.")).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to dalgo" }),
  ).toBeVisible();
});

test("player can crop and save a profile picture", async ({ page }) => {
  await authenticate(page);
  await mockSignedInApi(page);
  await page.goto("/profile");

  await page.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: avatarFixture,
  });

  await expect(
    page.getByRole("dialog", { name: "Crop profile picture" }),
  ).toBeVisible();
  const save = page.getByRole("button", { name: "Save picture" });
  await expect(save).toBeEnabled();
  const upload = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/profile/avatar") &&
      request.method() === "PUT",
  );
  await save.click();
  const request = await upload;
  expect(request.headers()["content-type"]).toContain("image/webp");
  expect(request.postDataBuffer()?.byteLength).toBeGreaterThan(0);

  await expect(
    page.getByRole("dialog", { name: "Crop profile picture" }),
  ).toBeHidden();
  await expect(
    page
      .locator('section[aria-labelledby="profile-identity-heading"]')
      .locator("img"),
  ).toHaveAttribute("src", "https://cdn.example.invalid/profile-avatar.webp");
  await expect(
    page.getByRole("link", { name: "Your account" }).locator("img"),
  ).toHaveAttribute("src", "https://cdn.example.invalid/profile-avatar.webp");
});
