import { expect, test, type Page } from "@playwright/test";

async function mockApp(page: Page, playEnabled: boolean) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/config"
        ? {
            supabaseUrl: "",
            supabaseKey: "",
            playEnabled,
            admissionMode: playEnabled ? "public" : "staging",
            reason: "PRIVATE STAGING INTERNAL STATUS",
            dailyCapacity: null,
            capacity: { matches: 1, executions: 1 },
          }
        : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

for (const viewport of [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 960 },
]) {
  test(`launch lobby is focused and free of internal copy on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockApp(page, true);
    await page.goto("/");

    await expect(page).toHaveTitle("dalgo — The coding club");

    await expect(
      page.getByRole("heading", { name: "Choose your arena", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Arena difficulty" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Find a match" }),
    ).toBeVisible();
    await expect(page.getByText("MATCH RULES", { exact: true })).toBeVisible();
    await expect(
      page.locator("footer").getByText("Python · C++ · Java · JavaScript"),
    ).toBeVisible();

    const text = await page.locator("body").innerText();
    for (const unwanted of [
      "THE CODING CLUB",
      "CLUBHOUSE",
      "FREE BETA",
      "Private staging",
      "Tester matches",
      "v0.2",
      "service verification",
      "capped online beta",
      "Live staging",
      "RATED HUMAN MATCH",
    ]) {
      expect(text).not.toContain(unwanted);
    }
  });
}

test("unavailable live play shows a public status without leaking staging details", async ({
  page,
}) => {
  await mockApp(page, false);
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "Matches unavailable" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Live matches are temporarily unavailable. Please try again later.",
    ),
  ).toBeVisible();
  await expect(page.getByText("PRIVATE STAGING INTERNAL STATUS")).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to dalgo" }),
  ).toBeVisible();
  await expect(
    page.getByText("Sign-in is temporarily unavailable."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Continue with Google or GitHub. New players choose a username next.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(page.getByText(/service verification/i)).toHaveCount(0);
});

test("public account pages use direct launch copy", async ({ page }) => {
  await mockApp(page, true);

  for (const [path, heading] of [
    ["/leaderboard", "Leaderboard"],
    ["/history", "Match history"],
    ["/profile", "Your profile"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/beta opens|ranked play opens|your seat/i);
  }
});

test("privacy and contact details are public and usable", async ({ page }) => {
  await mockApp(page, true);
  await page.goto("/privacy");

  await expect(
    page.getByRole("heading", { name: "Privacy and data requests", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Arya Gupta", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Email dalgo support" }),
  ).toHaveAttribute("href", /mailto:aryaguptaa\.vns@gmail\.com/);
  await expect(
    page.getByRole("heading", { name: "Access and deletion requests" }),
  ).toBeVisible();
  await expect(page.getByText(/operator review required/i)).toHaveCount(0);
  await expect(page.getByText(/capped online beta/i)).toHaveCount(0);

  await page.goto("/");
  await page
    .locator("footer")
    .getByRole("link", { name: "Privacy & contact" })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("removed preview routes do not expose a local match simulation", async ({
  page,
}) => {
  await mockApp(page, true);
  for (const path of ["/demo/easy", "/preview/easy"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Page not found." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try demo" })).toHaveCount(0);
  }
});
