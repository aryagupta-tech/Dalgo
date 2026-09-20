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
  { name: "desktop", width: 1440, height: 960 },
]) {
  test(`launch lobby is focused and free of internal copy on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockApp(page, true);
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Choose an arena" }),
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

  await expect(page.getByRole("button", { name: "Try demo" })).toBeVisible();
  await expect(
    page.getByText(
      "Live matches are currently unavailable. Demo code is not executed and ratings are not saved.",
    ),
  ).toBeVisible();
  await expect(page.getByText("PRIVATE STAGING INTERNAL STATUS")).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Dalgo" }),
  ).toBeVisible();
  await expect(page.getByText("Sign-in is unavailable.")).toBeVisible();
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
    expect(text).not.toMatch(
      /beta opens|ranked play opens|demo results|your seat/i,
    );
  }
});
