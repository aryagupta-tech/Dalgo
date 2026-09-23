#!/usr/bin/env node
// Deploy only the pinned private judge service over SSH; never copy app credentials.
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const [host, keyPath = join(homedir(), ".ssh", "dalgo-codebox-aws-2026")] =
  process.argv.slice(2);
if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host ?? ""))
  throw new Error(
    "Usage: node scripts/deploy-codebox-aws.mjs PUBLIC_IPV4 [SSH_KEY]",
  );
await access(keyPath);
await access("services/codebox/.env");

function run(command, args, input) {
  const result = spawnSync(command, args, {
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
  });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

const ssh = [
  "-i",
  keyPath,
  "-o",
  "StrictHostKeyChecking=yes",
  `ubuntu@${host}`,
];
run("ssh", [...ssh, "sudo install -d -m 0700 /opt/dalgo-codebox"]);
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
  "ssh",
  [
    ...ssh,
    "sudo tar -xzf - -C /opt/dalgo-codebox && sudo chmod 600 /opt/dalgo-codebox/.env && sudo docker compose -f /opt/dalgo-codebox/compose.yaml up -d --build --quiet-build",
  ],
  archive.stdout,
);
console.log(
  "Codebox deployed. Verify it through an SSH port forward before changing bindings.",
);
