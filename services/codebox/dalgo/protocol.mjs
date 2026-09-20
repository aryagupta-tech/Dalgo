import { createHash, timingSafeEqual } from "node:crypto";
export const QUEUE = "dalgo-executions";
export const RETENTION_MS = 24 * 60 * 60 * 1000;
export const languages = {
  71: { id: 71, source_file: "main.py", run_cmd: "python3 main.py" },
  54: {
    id: 54,
    source_file: "main.cpp",
    compile_cmd: "g++ -O2 -std=c++17 -o main main.cpp",
    run_cmd: "./main",
    min_memory: 524288,
  },
  62: {
    id: 62,
    source_file: "Main.java",
    compile_cmd: "javac -J-Xmx256m Main.java",
    run_cmd: "java -Xmx256m -XX:ActiveProcessorCount=1 Main",
  },
  63: {
    id: 63,
    source_file: "main.js",
    run_cmd: "node --max-old-space-size=256 main.js",
  },
};
export function authorized(value, secret) {
  if (
    typeof value !== "string" ||
    typeof secret !== "string" ||
    secret.length < 32
  )
    return false;
  const a = Buffer.from(value),
    b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function submission(body, key, now = Date.now()) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) => !["source_code", "language_id", "deadline"].includes(k),
    ) ||
    !Object.hasOwn(languages, body.language_id) ||
    typeof body.language_id !== "number" ||
    typeof body.source_code !== "string" ||
    !body.source_code.trim() ||
    body.source_code.includes("\0") ||
    Buffer.byteLength(body.source_code) > 262144 ||
    Buffer.from(body.source_code).toString("utf8") !== body.source_code ||
    !Number.isSafeInteger(body.deadline) ||
    body.deadline <= now ||
    body.deadline > now + 150000 ||
    typeof key !== "string" ||
    !/^[a-zA-Z0-9:-]{1,160}$/.test(key)
  ) {
    throw new Error("Invalid execution request");
  }
  const token = createHash("sha256").update(key).digest("hex");
  const canonical = JSON.stringify([
    body.source_code,
    body.language_id,
    body.deadline,
  ]);
  return {
    token,
    digest: createHash("sha256").update(canonical).digest("hex"),
    createdAt: now,
    deadline: body.deadline,
    source_code: body.source_code,
    language_id: body.language_id,
  };
}
export function execution(data) {
  return {
    token: data.token,
    source_code: data.source_code,
    language_id: data.language_id,
    language: languages[data.language_id],
    stdin: "",
    cpu_time_limit: 5,
    wall_time_limit: 10,
    memory_limit: 524288,
    max_processes_and_or_threads: 32,
    max_file_size: 64,
  };
}
export const infrastructureError = () => ({
  status: { id: 13 },
  exit_code: null,
});
export function publicResult(result) {
  // Codebox responses never include source, stdin, environment, or diagnostics.
  return {
    status: result.status,
    stdout: result.stdout ?? null,
    exit_code: result.exit_code,
    output_limit: result.output_limit === true,
    time: result.time ?? null,
    memory: result.memory ?? null,
  };
}
