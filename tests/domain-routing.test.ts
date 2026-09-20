import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it, vi } from "vitest";
import { oauthReturnUrl } from "../src/components/Chrome";
import worker from "../worker/index";
import type { Env } from "../worker/env";

function runtime(mode: "staging" | "public") {
  return {
    ADMISSION_MODE: mode,
    ASSETS: {
      fetch: vi.fn(
        async () =>
          new Response("<html>dalgo</html>", {
            headers: { "Content-Type": "text/html" },
          }),
      ),
    },
  } as unknown as Env;
}

describe("custom domain routing", () => {
  it("runs the Worker before assets and exposes only custom domains", () => {
    const config = parse(readFileSync("wrangler.jsonc", "utf8")) as {
      assets?: { run_worker_first?: boolean | string[] };
      workers_dev?: boolean;
      preview_urls?: boolean;
      env?: Record<string, { workers_dev?: boolean; preview_urls?: boolean }>;
    };
    expect(config.assets?.run_worker_first).toBe(true);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.env?.staging?.workers_dev).toBe(false);
    expect(config.env?.staging?.preview_urls).toBe(false);
    expect(config.env?.production?.workers_dev).toBe(false);
    expect(config.env?.production?.preview_urls).toBe(false);
  });

  it("returns OAuth only to production, staging, or the local dev server", () => {
    expect(
      oauthReturnUrl({
        origin: "https://dalgo.site",
        pathname: "/profile",
      }),
    ).toBe("https://dalgo.site/profile");
    expect(
      oauthReturnUrl({
        origin: "https://staging.dalgo.site",
        pathname: "/friends",
      }),
    ).toBe("https://staging.dalgo.site/friends");
    expect(
      oauthReturnUrl({
        origin: "http://127.0.0.1:5173",
        pathname: "/history",
      }),
    ).toBe("http://127.0.0.1:5173/history");
    expect(
      oauthReturnUrl({
        origin: "https://dalgo.dalgo-arya.workers.dev",
        pathname: "/profile",
      }),
    ).toBe("https://dalgo.site/profile");
  });

  it("permanently redirects www to the canonical apex with path and query", async () => {
    const env = runtime("public");
    const response = await worker.fetch(
      new Request("https://www.dalgo.site/profile?from=bookmark"),
      env,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      "https://dalgo.site/profile?from=bookmark",
    );
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("marks staging assets as noindex without changing production assets", async () => {
    const staging = await worker.fetch(
      new Request("https://staging.dalgo.site/profile"),
      runtime("staging"),
    );
    expect(staging.headers.get("X-Robots-Tag")).toBe("noindex");

    const production = await worker.fetch(
      new Request("https://dalgo.site/profile"),
      runtime("public"),
    );
    expect(production.headers.has("X-Robots-Tag")).toBe(false);
  });
});
