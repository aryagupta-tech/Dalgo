import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("hosted Supabase Auth redirects", () => {
  const config = readFileSync("supabase/config.toml", "utf8");

  it("uses production as the fallback and excludes retired Worker origins", () => {
    expect(config).toContain('site_url = "https://dalgo.site"');
    expect(config).not.toContain("workers.dev");
  });

  it("allows production, staging, and local development return routes", () => {
    for (const redirect of [
      "https://dalgo.site/",
      "https://dalgo.site/match/*",
      "https://staging.dalgo.site/",
      "https://staging.dalgo.site/match/*",
      "http://127.0.0.1:5173/**",
      "http://localhost:5173/**",
    ])
      expect(config).toContain(`"${redirect}"`);
  });
});
