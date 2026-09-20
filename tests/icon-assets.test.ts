import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.env.DALGO_PROJECT_ROOT ?? process.cwd();

describe("dalgo browser identity", () => {
  it("uses the canonical white double-chevron mark on black", () => {
    const favicon = readFileSync(resolve(root, "public/favicon.svg"), "utf8");
    const path = favicon.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/)?.[0];
    const drawing = favicon.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/)?.[1];

    expect(favicon).toContain('fill="#080808"');
    expect(path).toContain('stroke="#F1F5F9"');
    expect(path).toContain('fill="none"');
    expect(drawing?.match(/M/g)).toHaveLength(2);
    expect(favicon).toContain('aria-label="dalgo"');
    expect(favicon).not.toMatch(/<text\b/i);
  });

  it("is the icon referenced by the document head", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2" />',
    );
  });

  it("uses the lowercase brand in browser and installed-app metadata", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const manifest = JSON.parse(
      readFileSync(resolve(root, "public/site.webmanifest"), "utf8"),
    );

    expect(html).toContain("<title>dalgo — The coding club</title>");
    expect(html).toContain('<meta name="application-name" content="dalgo" />');
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-title" content="dalgo" />',
    );
    expect(html).toContain('<meta property="og:site_name" content="dalgo" />');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(manifest).toMatchObject({
      name: "dalgo",
      short_name: "dalgo",
      start_url: "/",
      display: "standalone",
    });
  });
});
