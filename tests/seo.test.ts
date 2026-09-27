import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicPageForPath } from "../worker/seo";

const read = (path: string) => readFileSync(path, "utf8");

describe("search metadata", () => {
  it("keeps the canonical public pages distinct from private match and account pages", () => {
    expect(publicPageForPath("/")?.path).toBe("/");
    expect(publicPageForPath("/leaderboard/")?.path).toBe("/leaderboard");
    expect(publicPageForPath("/privacy")?.path).toBe("/privacy");
    for (const path of [
      "/match/123",
      "/matches/123/review",
      "/friends",
      "/profile",
      "/history",
      "/players/123",
      "/missing",
    ])
      expect(publicPageForPath(path)).toBeNull();
  });

  it("lists only crawlable public pages in the sitemap", () => {
    const sitemap = read("public/sitemap.xml");
    expect(sitemap.match(/<loc>/g)).toHaveLength(3);
    for (const path of ["/", "/leaderboard", "/privacy"])
      expect(sitemap).toContain(`<loc>https://dalgo.site${path}</loc>`);
    expect(sitemap).not.toContain("staging.dalgo.site");
    expect(read("public/robots.txt")).toContain(
      "Sitemap: https://dalgo.site/sitemap.xml",
    );
  });

  it("provides consistent home metadata and valid application structured data", () => {
    const html = read("index.html");
    const schema = JSON.parse(
      html.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
      )?.[1] ?? "null",
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://dalgo.site/" />',
    );
    expect(html).toContain('property="og:url" content="https://dalgo.site/"');
    expect(schema).toMatchObject({
      "@type": "WebApplication",
      name: "dalgo",
      url: "https://dalgo.site/",
      offers: { price: "0" },
    });
  });
});
