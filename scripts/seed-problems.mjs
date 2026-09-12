import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const bank = JSON.parse(
  await readFile(new URL("../worker/problems.json", import.meta.url), "utf8"),
);
const rows = bank.map(
  ({ tests, reference, references, complexity, ...problem }) => ({
    id: problem.id,
    version: problem.version,
    arena: problem.arena,
    public: problem,
    private: { tests, reference, references, complexity },
  }),
);
if (!process.argv.includes("--apply")) {
  console.log(
    `Ready to seed ${rows.length} versioned problems. Run with --apply after applying the SQL migration. Existing versions are never overwritten.`,
  );
  process.exit(0);
}
const { SUPABASE_URL } = process.env;
const backendKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !backendKey)
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SECRET_KEY in your local .env. Never use a VITE_ variable for the service key.",
  );
const endpoint = new URL("/rest/v1/problems", SUPABASE_URL);
if (endpoint.protocol !== "https:")
  throw new Error("A HTTPS Supabase URL is required.");
const headers = {
  apikey: backendKey,
  ...(!backendKey.startsWith("sb_secret_")
    ? { Authorization: `Bearer ${backendKey}` }
    : {}),
  "Content-Type": "application/json",
};
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Problem seed failed with HTTP ${response.status}. Check the migration and service credential.`,
    );
  return response;
}
const existing = await (
  await request(`${endpoint}?select=id,version,arena,public,private`)
).json();
for (const row of rows) {
  const prior = existing.find(
    (p) => p.id === row.id && p.version === row.version,
  );
  if (prior && !isDeepStrictEqual(prior, row))
    throw new Error(
      `Refusing to change immutable problem ${row.id} v${row.version}. Add a new version instead.`,
    );
}
const missing = rows.filter(
  (row) => !existing.some((p) => p.id === row.id && p.version === row.version),
);
if (missing.length)
  await request(`${endpoint}?on_conflict=id,version`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(missing),
  });
console.log(
  `Seed complete: ${missing.length} inserted; ${rows.length - missing.length} unchanged.`,
);
