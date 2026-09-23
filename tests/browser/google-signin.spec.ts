import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const playerId = "11111111-1111-4111-8111-111111111111";

function accessToken(expiresAt: number) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: playerId,
        aud: "authenticated",
        exp: expiresAt,
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");
}

test("Google signs in on the Dalgo origin without a Supabase OAuth redirect", async ({
  page,
}) => {
  let authorizeRequests = 0;
  let tokenExchange:
    { provider?: string; id_token?: string; nonce?: string } | undefined;

  await page.addInitScript(() => {
    (
      window as typeof window & {
        google?: unknown;
        __dalgoGoogleConfig?: {
          nonce?: string;
          callback: (response: { credential: string }) => void;
        };
      }
    ).google = {
      accounts: {
        id: {
          initialize(config: {
            nonce?: string;
            callback: (response: { credential: string }) => void;
          }) {
            (
              window as typeof window & {
                __dalgoGoogleConfig?: typeof config;
              }
            ).__dalgoGoogleConfig = config;
          },
          renderButton(parent: HTMLElement) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Continue with Google";
            button.addEventListener("click", () => {
              (
                window as typeof window & {
                  __dalgoGoogleConfig?: {
                    callback: (response: { credential: string }) => void;
                  };
                }
              ).__dalgoGoogleConfig?.callback({
                credential: "google-id-token",
              });
            });
            parent.appendChild(button);
          },
        },
      },
    };
  });

  await page.route("https://testproject.supabase.invalid/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/authorize") {
      authorizeRequests += 1;
      return route.fulfill({ status: 500 });
    }
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers":
            "authorization, apikey, content-type, x-client-info",
        },
      });
    if (url.pathname === "/auth/v1/token") {
      tokenExchange = route.request().postDataJSON();
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          access_token: accessToken(expiresAt),
          refresh_token: "google-refresh-token",
          expires_at: expiresAt,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: playerId,
            aud: "authenticated",
            role: "authenticated",
            email: "player@example.invalid",
            app_metadata: { provider: "google" },
            user_metadata: { full_name: "Dalgo Player" },
            created_at: "2026-09-23T00:00:00Z",
          },
        }),
      });
    }
    return route.fulfill({ status: 204 });
  });

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({
        json: {
          supabaseUrl: "https://testproject.supabase.invalid",
          supabaseKey: "browser-test-only",
          googleClientId: "google-client.apps.googleusercontent.com",
          playEnabled: true,
          admissionMode: "public",
          reason: "",
          dailyCapacity: null,
        },
      });
    if (path === "/api/profile")
      return route.fulfill({
        json: {
          id: playerId,
          username: "dalgo_player",
          usernameConfigured: true,
          name: "Dalgo Player",
        },
      });
    if (path === "/api/admission")
      return route.fulfill({
        json: { mode: "public", canJoin: true, reason: "" },
      });
    if (path === "/api/ratings" || path === "/api/history")
      return route.fulfill({ json: [] });
    return route.fulfill({ json: { status: "idle" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("google-signin").locator("button").click();

  await expect(
    page.getByRole("link", { name: "Your account", exact: true }),
  ).toBeVisible();
  expect(authorizeRequests).toBe(0);
  expect(tokenExchange).toMatchObject({
    provider: "google",
    id_token: "google-id-token",
  });
  expect(tokenExchange?.nonce).toBeTruthy();

  const hashedNonce = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __dalgoGoogleConfig?: { nonce?: string };
        }
      ).__dalgoGoogleConfig?.nonce,
  );
  expect(createHash("sha256").update(tokenExchange!.nonce!).digest("hex")).toBe(
    hashedNonce,
  );
});
