import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.env.DALGO_PROJECT_ROOT ?? process.cwd();

describe("Dalgo browser icon", () => {
  it("uses the canonical white double-chevron mark on black", () => {
    const favicon = readFileSync(resolve(root, "public/favicon.svg"), "utf8");
    const path = favicon.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/)?.[0];
    const drawing = favicon.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/)?.[1];

    expect(favicon).toContain('fill="#080808"');
    expect(path).toContain('stroke="#F1F5F9"');
    expect(path).toContain('fill="none"');
    expect(drawing?.match(/M/g)).toHaveLength(2);
    expect(favicon).not.toMatch(/<text\b/i);
  });

  it("is the icon referenced by the document head", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2" />',
    );
  });
});
