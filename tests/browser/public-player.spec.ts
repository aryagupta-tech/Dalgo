import { expect, test } from "@playwright/test";

const playerId = "11111111-1111-4111-8111-111111111111";
const matchId = "33333333-3333-4333-8333-333333333333";
const boards = ["easy", "medium", "hard"].flatMap((arena) =>
  ["human", "bot"].map((mode) => ({
    arena,
    mode,
    rating: 800,
    rank: arena === "easy" && mode === "human" ? 3 : null,
    matches: arena === "easy" && mode === "human" ? 1 : 0,
    wins: arena === "easy" && mode === "human" ? 1 : 0,
    losses: 0,
    draws: 0,
  })),
);

for (const width of [375, 768, 1440]) {
  test(`public player profile works at ${width}px without signing in`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({
          json: {
            supabaseUrl: "",
            supabaseKey: "",
            playEnabled: true,
            admissionMode: "public",
            reason: "",
            dailyCapacity: null,
          },
        });
      if (path === `/api/players/${playerId}`)
        return route.fulfill({
          json: {
            player: {
              id: playerId,
              username: "test_player",
              name: "Test Player",
            },
            ratings: boards,
            record: { matches: 1, wins: 1, losses: 0, draws: 0 },
          },
        });
      if (path === `/api/players/${playerId}/matches`)
        return route.fulfill({
          json: {
            matches: [
              {
                id: matchId,
                arena: "easy",
                mode: "human",
                endedAt: "2026-09-24T00:00:00Z",
                outcome: "win",
                ratingDelta: 20,
                opponent: null,
              },
            ],
            nextCursor: null,
          },
        });
      return route.fulfill({ status: 404, json: { error: "Not mocked" } });
    });
    await page.goto(`/players/${playerId}`);
    await expect(
      page.getByRole("heading", { name: "Test Player", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("@test_player")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ratings and ranks" }),
    ).toBeVisible();
    await expect(page.getByText("#3")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Review win match/ }),
    ).toHaveAttribute("href", `/matches/${matchId}/review`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
