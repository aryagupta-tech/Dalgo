import { test, expect } from "@playwright/test";
const tester = "11111111-1111-4111-8111-111111111111";
const outsider = "22222222-2222-4222-8222-222222222222";

for (const [id, allowed] of [
  [tester, true],
  [outsider, false],
] as const) {
  test(`staging eligibility is refreshed for ${allowed ? "an invited" : "an uninvited"} account and after sign-out`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ id }) => {
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const token =
          btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
          "." +
          btoa(
            JSON.stringify({ sub: id, aud: "authenticated", exp: expires }),
          ) +
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
      { id },
    );
    const headers: string[] = [];
    await page.route("https://testproject.supabase.invalid/**", (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/admission")
        headers.push(route.request().headers().authorization ?? "");
      const data =
        path === "/api/config"
          ? {
              supabaseUrl: "https://testproject.supabase.invalid",
              supabaseKey: "browser-test-only",
              playEnabled: true,
              admissionMode: "staging",
              reason: "",
              dailyCapacity: 160,
            }
          : path === "/api/admission"
            ? {
                mode: "staging",
                canJoin: allowed,
                reason: allowed
                  ? ""
                  : "Live matches are limited to invited testers.",
              }
            : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name: allowed ? "Find a match" : "Matches unavailable",
      }),
    ).toBeVisible();
    await expect.poll(() => headers.length).toBe(1);
    expect(headers[0]).toMatch(/^Bearer /);
    if (allowed) {
      let status: "waiting" | "idle" = "waiting";
      let message = "";
      let polls = 0;
      let cancellations = 0;
      let joinedAt = Date.now();
      let requestId = "";
      await page.route("**/api/socket-ticket", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Use polling in this test." }),
        }),
      );
      await page.route("**/api/queue", async (route) => {
        const method = route.request().method();
        if (method === "POST") {
          requestId = route.request().postDataJSON().requestId;
          status = "waiting";
          joinedAt = Date.now();
        } else if (method === "DELETE") cancellations++;
        else polls++;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status,
            serverNow: Date.now(),
            requestId,
            ...(status === "waiting" ? { joinedAt, arena: "medium" } : {}),
            ...(message ? { message } : {}),
          }),
        });
      });
      for (const reason of ["Staging admissions are paused.", ""]) {
        message = "";
        await page.getByRole("button", { name: "Find a match" }).click();
        await expect(
          page.getByRole("heading", { name: "Finding an opponent." }),
        ).toBeVisible();
        status = "idle";
        message = reason;
        await expect(
          page.getByRole("heading", { name: "Search paused." }),
        ).toBeVisible();
        message = "";
        const pollsBeforeReopen = polls;
        await expect.poll(() => polls).toBeGreaterThan(pollsBeforeReopen);
        await expect(
          page.getByRole("heading", { name: "Search paused." }),
        ).toBeVisible();
        await expect(
          page.getByText("No new opponent will be assigned", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Back to lobby", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      expect(cancellations).toBe(0);
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Matches unavailable" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Find a match" }),
    ).toHaveCount(0);
    await expect(page.getByText("Test account", { exact: true })).toHaveCount(
      0,
    );
  });
}
