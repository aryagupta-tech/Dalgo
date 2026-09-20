#!/usr/bin/env node
// Copies only the isolated judge service through gcloud SSH.
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";

const [instance, zone = "asia-southeast1-b", project = "dalgo-508410"] =
  process.argv.slice(2);
const safe = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
if (!safe.test(instance ?? "") || !safe.test(project) || !/^[a-z0-9-]+$/.test(zone))
  throw new Error(
    "Usage: node scripts/deploy-codebox-gcp.mjs INSTANCE [ZONE] [PROJECT]",
  );
await access("services/codebox/.env");

function run(command, args, input) {
  const result = spawnSync(command, args, {
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
  });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

const target = [
  "compute",
  "ssh",
  instance,
  `--project=${project}`,
  `--zone=${zone}`,
  "--quiet",
  "--command",
];
run("gcloud", [...target, "sudo install -d -m 0700 /opt/dalgo-codebox"]);
const archive = spawnSync(
  "tar",
  [
    "-C",
    "services/codebox",
    "--exclude=**/node_modules",
    "--exclude=.DS_Store",
    "-czf",
    "-",
    ".",
  ],
  { maxBuffer: 20 * 1024 * 1024 },
);
if (archive.status !== 0) throw new Error("Could not package Codebox");
run(
  "gcloud",
  [
    ...target,
    "sudo tar -xzf - -C /opt/dalgo-codebox && sudo chmod 600 /opt/dalgo-codebox/.env && sudo docker compose -f /opt/dalgo-codebox/compose.yaml up -d --build",
  ],
  archive.stdout,
);
console.log("Codebox uploaded. Verify it through a gcloud SSH port forward.");
