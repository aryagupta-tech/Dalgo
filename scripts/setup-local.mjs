#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

// Creates only a private, ignored local file. Existing settings are never replaced.
const destination = new URL("../.dev.vars.staging", import.meta.url);
const template = await readFile(
  new URL("../.dev.vars.example", import.meta.url),
  "utf8",
);
const content = template
  .replace(
    /^WEBSOCKET_SIGNING_SECRET=.*$/m,
    `WEBSOCKET_SIGNING_SECRET=${randomBytes(32).toString("hex")}`,
  )
  .replace(/^ADMISSION_MODE=.*$/m, "ADMISSION_MODE=staging");
try {
  await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  console.log(
    "Created private .dev.vars.staging with a random WebSocket signing secret. Live play remains disabled.",
  );
} catch (error) {
  if (error.code !== "EEXIST")
    throw new Error("Could not create local staging configuration.");
  console.log("Existing .dev.vars.staging preserved. No values were changed.");
}
console.log(
  "Fill the provider values locally, then run npm run check:setup. Do not paste credentials into chat.",
);
