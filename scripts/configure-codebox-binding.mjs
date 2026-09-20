#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parse, modify, applyEdits } from "jsonc-parser";
const [environment, serviceId] = process.argv.slice(2);
if (
  !["staging", "production"].includes(environment) ||
  !/^[a-zA-Z0-9-]{8,100}$/.test(serviceId ?? "")
)
  throw new Error(
    "Usage: node scripts/configure-codebox-binding.mjs staging SERVICE_ID",
  );
const path = new URL("../wrangler.jsonc", import.meta.url);
const content = await readFile(path, "utf8");
const parsed = parse(content);
if (parsed.env[environment].vars.LIVE_MATCHES_ENABLED !== "false")
  throw new Error(
    "Pause live admissions before changing the execution service",
  );
await writeFile(
  path,
  applyEdits(
    content,
    modify(
      content,
      ["env", environment, "vpc_services"],
      [{ binding: "CODEBOX", service_id: serviceId }],
      { formattingOptions: { insertSpaces: true, tabSize: 2 } },
    ),
  ),
);
console.log(
  `Private Codebox binding saved for ${environment}; live play remains disabled.`,
);
