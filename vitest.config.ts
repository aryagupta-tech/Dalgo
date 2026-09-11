import { defineConfig } from "vitest/config";

// Unit tests run without Cloudflare or external credentials. Lifecycle tests
// provide durable storage and service mocks; workerd is verified separately.
export default defineConfig({
  plugins: [
    {
      name: "offline-cloudflare-workers",
      resolveId(id) {
        if (id === "cloudflare:workers") return "\0offline-cloudflare-workers";
      },
      load(id) {
        if (id === "\0offline-cloudflare-workers")
          return "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";
      },
    },
  ],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
