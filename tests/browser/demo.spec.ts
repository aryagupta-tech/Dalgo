import { test, expect, type Page } from "@playwright/test";

const notice = "Demo: code is not executed and ratings are not saved.";
const mutations: string[] = [];
test.beforeEach(async ({ page }) => {
  mutations.length = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== "/api/config") mutations.push(path);
    await route.fulfill({
      status: path === "/api/config" ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(
        path === "/api/config"
          ? {
              supabaseUrl: "",
              supabaseKey: "",
              playEnabled: false,
              admissionMode: "disabled",
              reason: "Live play is not open.",
              dailyCapacity: null,
            }
          : { error: "No live services in browser tests." },
      ),
    });
  });
});
test.afterEach(() => expect(mutations).toEqual([]));

async function start(page: Page, arena = "easy") {
  await page.goto("/demo/" + arena);
  await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
    "data-demo-phase",
    "searching",
  );
  await page.getByRole("button", { name: "Skip search" }).click();
  await expect(page.getByText("Vector · Simulated bot")).toBeVisible();
  await page.getByRole("button", { name: "Skip preparation" }).click();
  await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
    "data-demo-phase",
    "active",
  );
}

for (const width of [375, 768, 1440]) {
  test(`lobby and complete workspace remain usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "The arena." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try demo" })).toBeVisible();
    await page.getByRole("radio", { name: /Medium/ }).check();
    await page.screenshot({
      path: `artifacts/browser/lobby-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Try demo" }).click();
    await expect(page).toHaveURL(/\/demo\/medium$/);
    await expect(page.getByText(notice, { exact: true })).toBeVisible();
    await page.screenshot({
      path: `artifacts/browser/queue-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Skip search" }).click();
    await page.getByRole("button", { name: "Skip preparation" }).click();
    if (width <= 768) {
      const code = page.getByRole("tab", { name: "Code", exact: true });
      if (await code.isVisible()) await code.click();
    }
    await expect(
      page.getByRole("button", { name: "Preview submission", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect(
      page.getByRole("textbox", { name: "Solution code editor" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `artifacts/browser/workspace-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Show example result" }).click();
    await expect(
      page.getByRole("dialog", { name: "Example result", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/browser/result-${width}.png`,
      fullPage: true,
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  });
}

test("full 15-second search and 5-second preparation use persistent deadlines", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/demo/easy");
  await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
    "data-demo-phase",
    "searching",
  );
  await page.clock.runFor(15_000);
  await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
    "data-demo-phase",
    "ready",
  );
  await page.clock.runFor(5_000);
  await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
    "data-demo-phase",
    "active",
  );
  const key = "dalgo:demo:session:v1:easy";
  const deadline = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!).endsAt,
    key,
  );
  await page.reload();
  await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
    "data-demo-phase",
    "active",
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).endsAt,
      key,
    ),
  ).toBe(deadline);
});

test("all four starters, drafts, attempts, and reset work across reloads", async ({
  page,
}) => {
  await start(page);
  const code = page.getByRole("textbox", { name: "Solution code editor" });
  const language = page.getByRole("combobox", { name: "Programming language" });
  await expect(code).toBeVisible();
  for (const [id, starter] of [
    ["python", "def solve"],
    ["cpp", "solve("],
    ["java", "solve("],
    ["javascript", "function solve"],
  ]) {
    await language.selectOption(id);
    await expect(page.locator(".view-lines")).toContainText(starter);
  }
  await language.selectOption("python");
  await code.focus();
  await code.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await code.fill("def solve(heights):\n    return 42 # retained draft");
  await page.getByRole("button", { name: "Preview run", exact: true }).click();
  await expect(
    page.getByText("Illustrative · accepted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/2\/3 run previews/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".view-lines")).toContainText("retained draft");
  await expect(page.getByText(/2\/3 run previews/)).toBeVisible();
  await page.getByRole("button", { name: "Reset starter code" }).click();
  await page.getByRole("button", { name: "Reset code", exact: true }).click();
  await expect(page.locator(".view-lines")).not.toContainText("retained draft");
});

for (const [scenario, heading, delta] of [
  ["win", "You win.", "+16"],
  ["loss", "Opponent wins.", "-16"],
  ["draw", "A draw.", "0"],
  ["void", "Match voided.", "0"],
]) {
  test(`illustrative ${scenario} result never executes entered code`, async ({
    page,
  }) => {
    await start(page);
    await page
      .getByRole("combobox", { name: "Example result scenario" })
      .selectOption(scenario);
    await page
      .getByRole("button", { name: "Preview submission", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Example result",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".result-score")).toContainText(delta);
    await expect(dialog).toContainText("not an assessment of your code");
    await dialog.getByRole("button", { name: "New demo" }).click();
    await page
      .getByRole("dialog", { name: "Restart demo", exact: true })
      .getByRole("button", { name: "Restart demo", exact: true })
      .click();
    await expect(page.locator("[data-demo-phase]")).toHaveAttribute(
      "data-demo-phase",
      "searching",
    );
  });
}

test("legacy redirect, cancellation, keyboard resizing, and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/preview/hard");
  await expect(page).toHaveURL(/\/demo\/hard$/);
  await page.getByRole("button", { name: "Cancel search" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo search cancelled." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("dalgo:demo:session:v1:hard"),
    ),
  ).toBeNull();
  await page.getByRole("button", { name: "Start again" }).click();
  await page.getByRole("button", { name: "Skip search" }).click();
  await page.getByRole("button", { name: "Skip preparation" }).click();
  const divider = page.getByRole("separator", {
    name: "Resize problem and editor panels",
  });
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", String(before + 2));
});

test("unavailable problem service offers recovery", async ({ page }) => {
  await page.route("**/problems.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/demo/easy");
  await expect(
    page.getByText("Problem statements are unavailable."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Retry|Try again/i }),
  ).toBeVisible();
});
