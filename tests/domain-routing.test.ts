import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/env";

function runtime(mode: "staging" | "public") {
  return {
    ADMISSION_MODE: mode,
    ASSETS: {
      fetch: vi.fn(
        async () =>
          new Response("<html>Dalgo</html>", {
            headers: { "Content-Type": "text/html" },
          }),
      ),
    },
  } as unknown as Env;
}

describe("custom domain routing", () => {
  it("runs the Worker before assets so host redirects and noindex headers apply", () => {
    const config = parse(readFileSync("wrangler.jsonc", "utf8")) as {
      assets?: { run_worker_first?: boolean | string[] };
    };
    expect(config.assets?.run_worker_first).toBe(true);
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
