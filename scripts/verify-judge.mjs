#!/usr/bin/env node
/**
 * JDoodle launch-check runner. Node >=22; uses the project's installed esbuild.
 * Credentials are read only from JDOODLE_CLIENT_ID/JDOODLE_CLIENT_SECRET.
 * No remote requests occur without --execute. No live-play setting is modified.
 *
 * Dry run:
 *   node scripts/verify-judge.mjs --problem-offset 0 --problem-limit 10
 * Execute after reviewing the plan, with account quota/cost in the environment:
 *   node --env-file=.env scripts/verify-judge.mjs --problem-offset 0 \
 *     --problem-limit 10 --execute --max-credits 114 --report /tmp/judge-part1.json
 * Small-account probe batch (eight probes, ten estimated credits):
 *   node scripts/verify-judge.mjs --problem-limit 0 --probe-offset 0 --probe-limit 8
 * Repeat probe offsets 8, 16 and 24 on later quota days to cover all languages.
 * Repeat disjoint chunks on subsequent quota days; use --skip-probes only when
 * reusing a successful probe report for the exact same source/runtime hashes.
 *
 * Primary docs:
 * https://www.jdoodle.com/docs/compiler-apis/jdoodle-api-quickstart/rest-apis/
 * https://www.jdoodle.com/docs/compiler-apis/api-faqs/
 * https://www.jdoodle.com/docs/compiler-apis/api-credits/
 * https://www.jdoodle.com/docs/compiler-apis/api-timeout-errors
 */
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";

const API = "https://api.jdoodle.com/v1";
const LANGUAGES = ["python", "cpp", "java", "javascript"];
const MAX_RESPONSE_BYTES = 512000;
const VERSION_MARKER = "__DALGO_VERSION__";
const NETWORK_MARKER = "__DALGO_NETWORK__";
const MEMORY_MARKER = "__DALGO_MEMORY__";
const MEMORY_MAX_BYTES = 512 * 1024 * 1024;
const MEMORY_CHUNK_BYTES = 8 * 1024 * 1024;
const PROBE_SECONDS = 135;
const OUTPUT_CHARACTERS = 300000;
const abort = new AbortController();
let stopRequested = false;

export function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    offset: 0,
    limit: null,
    execute: false,
    skipProbes: false,
    probeOffset: 0,
    probeLimit: null,
    report: null,
    maxCredits: null,
    help: false,
  };
  const valued = {
    "--project": "project",
    "--problem-offset": "offset",
    "--problem-limit": "limit",
    "--probe-offset": "probeOffset",
    "--probe-limit": "probeLimit",
    "--report": "report",
    "--max-credits": "maxCredits",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--execute") out.execute = true;
    else if (flag === "--skip-probes") out.skipProbes = true;
    else if (flag === "--help" || flag === "-h") out.help = true;
    else if (valued[flag]) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${flag}.`);
      out[valued[flag]] = argv[++i];
    } else
      throw new Error(
        "Unknown option. Use --help. Credentials must be supplied through environment variables, never CLI arguments.",
      );
  }
  for (const key of [
    "offset",
    "limit",
    "probeOffset",
    "probeLimit",
    "maxCredits",
  ]) {
    if (out[key] === null) continue;
    const value = Number(out[key]);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${key} must be a nonnegative integer.`);
    out[key] = value;
  }
  if (
    out.skipProbes &&
    (argv.includes("--probe-offset") || argv.includes("--probe-limit"))
  )
    throw new Error("--skip-probes cannot be combined with a probe range.");
  out.project = path.resolve(out.project);
  out.report = path.resolve(
    out.report ||
      path.join(
        os.tmpdir(),
        `dalgo-judge-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      ),
  );
  return out;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function integerEnv(name, fallback = null) {
  if (!process.env[name]?.trim()) return fallback;
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function safeError(error) {
  // Provider payloads and headers are never included in error output.
  const message =
    error instanceof Error ? error.message : "Unknown local error.";
  return [process.env.JDOODLE_CLIENT_ID, process.env.JDOODLE_CLIENT_SECRET]
    .filter(Boolean)
    .reduce((text, secret) => text.split(secret).join("[redacted]"), message)
    .slice(0, 500);
}
function reportJson(report) {
  const secrets = [
    process.env.JDOODLE_CLIENT_ID,
    process.env.JDOODLE_CLIENT_SECRET,
  ].filter(Boolean);
  return (
    JSON.stringify(
      report,
      (_key, value) =>
        typeof value === "string"
          ? secrets.reduce(
              (text, secret) => text.split(secret).join("[redacted]"),
              value,
            )
          : value,
      2,
    ) + "\n"
  );
}
async function saveReport(report, filename) {
  report.finishedAt = new Date().toISOString();
  const text = reportJson(report);
  await writeFile(filename, text, { mode: 0o600 });
  process.stdout.write(text);
  process.stderr.write(`Report saved to ${filename}\n`);
}

async function loadProject(project) {
  const files = [
    "worker/harness.ts",
    "worker/judge.ts",
    "worker/problems.json",
  ];
  const contents = await Promise.all(
    files.map((file) => readFile(path.join(project, file), "utf8")),
  );
  const problems = JSON.parse(contents[2]);
  if (!Array.isArray(problems) || !problems.length)
    throw new Error("The problem bank is missing or empty.");
  const require = createRequire(path.join(project, "package.json"));
  const esbuild = await import(pathToFileURL(require.resolve("esbuild")).href);
  const temp = await mkdtemp(path.join(os.tmpdir(), "dalgo-judge-verify-"));
  try {
    const bundle = path.join(temp, "adapter.mjs");
    await esbuild.build({
      stdin: {
        contents: `export {buildHarness} from ${JSON.stringify(path.join(project, "worker/harness.ts"))};\nexport {interpretJudge,RUNTIMES} from ${JSON.stringify(path.join(project, "worker/judge.ts"))};`,
        resolveDir: project,
        sourcefile: "verification-entry.ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: bundle,
      logLevel: "silent",
    });
    const adapter = await import(pathToFileURL(bundle).href);
    const sourceHashes = Object.fromEntries(
      files.map((file, i) => [file, hash(contents[i])]),
    );
    sourceHashes["scripts/verify-judge.mjs"] = hash(
      await readFile(new URL(import.meta.url), "utf8"),
    );
    return { ...adapter, problems, sourceHashes };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const probeProblem = {
  id: "verification-probe",
  version: 1,
  title: "Verification probe",
  arena: "easy",
  parameters: [],
  returnType: "int",
  examples: [{ args: [], expected: 17 }],
  tests: [{ args: [], expected: 17 }],
};

export function probeSource(language, category) {
  const sources = {
    wrong_answer: {
      python: "def solve():\n    return 16",
      javascript: "function solve() { return 16; }",
      cpp: "int solve() { return 16; }",
      java: "public static int solve() { return 16; }",
    },
    // Retain and touch bounded chunks, so lazy allocation cannot make the test
    // appear to consume memory. Never increase this cap automatically. A cap
    // reached without rejection is inconclusive, not proof of memory isolation.
    memory: {
      python: `def solve():\n    chunks = []\n    try:\n        for _ in range(${MEMORY_MAX_BYTES / MEMORY_CHUNK_BYTES}):\n            block = bytearray(${MEMORY_CHUNK_BYTES})\n            for page in range(0, len(block), 4096):\n                block[page] = 1\n            chunks.append(block)\n    except MemoryError:\n        chunks.clear()\n        print("${MEMORY_MARKER}allocation_failed", flush=True)\n        raise\n    print("${MEMORY_MARKER}cap_reached", flush=True)\n    return 17`,
      javascript: `function solve() { const chunks = []; try { for (let i = 0; i < ${MEMORY_MAX_BYTES / MEMORY_CHUNK_BYTES}; i++) { const block = new Uint8Array(${MEMORY_CHUNK_BYTES}); for(let page = 0; page < block.length; page += 4096) block[page] = 1; chunks.push(block); } } catch (error) { chunks.length = 0; if(error instanceof RangeError && /alloc|memory|array buffer/i.test(String(error.message))) require('node:fs').writeSync(1, '${MEMORY_MARKER}allocation_failed\\n'); throw error; } require('node:fs').writeSync(1, '${MEMORY_MARKER}cap_reached\\n'); return 17; }`,
      cpp: `#include <memory>\n#include <new>\nint solve() { std::vector<std::unique_ptr<unsigned char[]>> chunks; try { for(int i = 0; i < ${MEMORY_MAX_BYTES / MEMORY_CHUNK_BYTES}; i++) { auto block = std::make_unique<unsigned char[]>(${MEMORY_CHUNK_BYTES}); volatile unsigned char* touched = block.get(); for(size_t page = 0; page < ${MEMORY_CHUNK_BYTES}; page += 4096) touched[page] = 1; chunks.push_back(std::move(block)); } } catch(const std::bad_alloc&) { chunks.clear(); std::cout << "\\n${MEMORY_MARKER}allocation_failed" << std::endl; throw; } std::cout << "\\n${MEMORY_MARKER}cap_reached" << std::endl; return 17; }`,
      java: `public static int solve() { java.util.ArrayList<byte[]> chunks = new java.util.ArrayList<>(); try { for(int i = 0; i < ${MEMORY_MAX_BYTES / MEMORY_CHUNK_BYTES}; i++) { byte[] block = new byte[${MEMORY_CHUNK_BYTES}]; for(int page = 0; page < block.length; page += 4096) block[page] = 1; chunks.add(block); } } catch(OutOfMemoryError error) { chunks.clear(); System.out.println("\\n${MEMORY_MARKER}allocation_failed"); throw error; } System.out.println("\\n${MEMORY_MARKER}cap_reached"); return 17; }`,
    },
    syntax: {
      python: "def solve(:\n    return 17",
      javascript: "function solve( { return 17; }",
      cpp: "int solve( { return 17; }",
      java: "public static int solve( { return 17; }",
    },
    runtime: {
      python:
        'def solve():\n    raise RuntimeError("intentional verification failure")',
      javascript:
        'function solve() { throw new Error("intentional verification failure"); }',
      cpp: "int solve() { throw 1; }",
      java: 'public static int solve() { throw new RuntimeException("intentional verification failure"); }',
    },
    timeout: {
      python: `import time\ndef solve():\n    until = time.monotonic() + ${PROBE_SECONDS}\n    while time.monotonic() < until:\n        pass\n    return 17`,
      javascript: `function solve() { const until = Date.now() + ${PROBE_SECONDS * 1000}; while(Date.now() < until) {} return 17; }`,
      cpp: `#include <chrono>\nint solve() { auto until = std::chrono::steady_clock::now() + std::chrono::seconds(${PROBE_SECONDS}); while(std::chrono::steady_clock::now() < until) {} return 17; }`,
      java: `public static int solve() { long until = System.nanoTime() + ${PROBE_SECONDS}L * 1000000000L; while(System.nanoTime() < until) {} return 17; }`,
    },
    output: {
      python: `def solve():\n    print("x" * ${OUTPUT_CHARACTERS})\n    return 17`,
      javascript: `function solve() { process.stdout.write("x".repeat(${OUTPUT_CHARACTERS})); return 17; }`,
      cpp: `int solve() { std::cout << std::string(${OUTPUT_CHARACTERS}, 'x'); return 17; }`,
      java: `public static int solve() { char[] output = new char[${OUTPUT_CHARACTERS}]; java.util.Arrays.fill(output, 'x'); System.out.print(output); return 17; }`,
    },
  };
  return sources[category][language];
}

function versionScript(language) {
  return {
    python: `import platform\nprint("${VERSION_MARKER}" + platform.python_version())`,
    javascript: `console.log("${VERSION_MARKER}" + process.version);`,
    cpp: `#include <iostream>\nint main() { std::cout << "${VERSION_MARKER}" << __VERSION__ << "\\n"; }`,
    java: `public class Main { public static void main(String[] args) { System.out.println("${VERSION_MARKER}" + System.getProperty("java.version")); } }`,
  }[language];
}

function networkScript(language, target) {
  // Exactly one TCP connection to a preflight-confirmed public IPv4/443 endpoint.
  // No HTTP request, credentials, filesystem contents, or user input is sent.
  const ip = JSON.stringify(target.address);
  return {
    python: `import socket, json\nr={"connected":False,"policyDenied":False}\ntry:\n    s=socket.create_connection((${ip},443),timeout=3)\n    s.close()\n    r["connected"]=True\nexcept OSError as e:\n    r["code"]=e.errno\n    r["policyDenied"]=isinstance(e,PermissionError) or e.errno in (1,13)\nprint("${NETWORK_MARKER}"+json.dumps(r))`,
    javascript: `const net=require('node:net');let done=false;const s=net.createConnection({host:${ip},port:443});function finish(r){if(done)return;done=true;s.destroy();console.log('${NETWORK_MARKER}'+JSON.stringify(r));}s.setTimeout(3000,()=>finish({connected:false,policyDenied:false,code:'TIMEOUT'}));s.on('connect',()=>finish({connected:true,policyDenied:false}));s.on('error',e=>finish({connected:false,policyDenied:e.code==='EPERM'||e.code==='EACCES',code:e.code}));`,
    java: `import java.net.*;\npublic class Main {public static void main(String[] args){boolean connected=false, denied=false;String code="";try(Socket socket=new Socket()){socket.connect(new InetSocketAddress(${ip},443),3000);connected=true;}catch(SecurityException e){denied=true;code="SecurityException";}catch(Exception e){code=e.getClass().getSimpleName();String msg=String.valueOf(e.getMessage()).toLowerCase();denied=msg.contains("permission denied")||msg.contains("operation not permitted");}System.out.println("${NETWORK_MARKER}{\\"connected\\":"+connected+",\\"policyDenied\\":"+denied+",\\"code\\":\\""+code+"\\"}");}}`,
    cpp: `#include <sys/socket.h>\n#include <sys/select.h>\n#include <arpa/inet.h>\n#include <fcntl.h>\n#include <unistd.h>\n#include <cerrno>\n#include <iostream>\nint main(){bool connected=false;int error=0;int fd=socket(AF_INET,SOCK_STREAM,0);if(fd<0){error=errno;}else{int flags=fcntl(fd,F_GETFL,0);fcntl(fd,F_SETFL,flags|O_NONBLOCK);sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_port=htons(443);inet_pton(AF_INET,${ip},&addr.sin_addr);int result=connect(fd,reinterpret_cast<sockaddr*>(&addr),sizeof(addr));if(result==0){connected=true;}else if(errno==EINPROGRESS){fd_set writes;FD_ZERO(&writes);FD_SET(fd,&writes);timeval timeout{3,0};result=select(fd+1,nullptr,&writes,nullptr,&timeout);if(result>0){socklen_t size=sizeof(error);getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&size);connected=error==0;}else error=result==0?ETIMEDOUT:errno;}else error=errno;close(fd);}std::cout<<"${NETWORK_MARKER}{\\"connected\\":"<<(connected?"true":"false")<<",\\"policyDenied\\":"<<((error==EPERM||error==EACCES)?"true":"false")<<",\\"code\\":"<<error<<"}\\n";}`,
  }[language];
}

export function makeChecks(adapter, selected, skipProbes) {
  const checks = [];
  if (!skipProbes) {
    for (const language of LANGUAGES) {
      checks.push({
        id: `${language}:version`,
        language,
        category: "version",
        script: versionScript(language),
      });
      for (const category of [
        "syntax",
        "runtime",
        "wrong_answer",
        "output",
        "timeout",
        "memory",
      ]) {
        checks.push({
          id: `${language}:${category}`,
          language,
          category,
          problem: probeProblem,
          kind: "submit",
          expectedVerdict: {
            syntax: "compile_error",
            runtime: "runtime_error",
            wrong_answer: "wrong_answer",
            memory: "runtime_error",
            output: "output_limit",
            timeout: "time_limit",
          }[category],
          script: adapter.buildHarness(
            probeProblem,
            language,
            probeSource(language, category),
            "submit",
          ),
        });
      }
      checks.push({ id: `${language}:network`, language, category: "network" });
    }
  }
  for (const problem of selected) {
    for (const language of LANGUAGES) {
      if (
        typeof problem.references?.[language] !== "string" ||
        !problem.references[language].trim()
      )
        throw new Error(`Missing ${language} reference for ${problem.id}.`);
      if (!problem.examples?.length || !problem.tests?.length)
        throw new Error(`Empty sample/hidden suite for ${problem.id}.`);
      for (const kind of ["run", "submit"])
        checks.push({
          id: `${problem.id}:${language}:${kind}`,
          language,
          category: "reference",
          problem,
          kind,
          expectedVerdict: "accepted",
          script: adapter.buildHarness(
            problem,
            language,
            problem.references[language],
            kind,
          ),
        });
    }
  }
  return checks;
}

// Keep selection pure and report the excluded scope explicitly. A passing
// partial batch establishes only its selected checks, never full launch proof.
export function selectChecks(adapter, options) {
  if (options.offset > adapter.problems.length)
    throw new Error("The problem offset exceeds the problem bank length.");
  const selected = adapter.problems.slice(
    options.offset,
    options.limit === null ? undefined : options.offset + options.limit,
  );
  const allChecks = makeChecks(adapter, selected, false);
  const allProbes = allChecks.filter((check) => check.category !== "reference");
  if (options.probeOffset > allProbes.length)
    throw new Error("The probe offset exceeds the probe suite length.");
  if (
    options.probeLimit !== null &&
    options.probeLimit > allProbes.length - options.probeOffset
  )
    throw new Error(
      "The requested probe range exceeds the probe suite length.",
    );
  const selectedProbes = options.skipProbes
    ? []
    : allProbes.slice(
        options.probeOffset,
        options.probeLimit === null
          ? undefined
          : options.probeOffset + options.probeLimit,
      );
  const selectedProbeIds = selectedProbes.map((check) => check.id);
  const selectedProbeSet = new Set(selectedProbeIds);
  const checks = selectedProbes.concat(
    allChecks.filter((check) => check.category === "reference"),
  );
  if (!checks.length) throw new Error("The selected plan contains no checks.");
  const fullBankSelected =
    selected.length === adapter.problems.length && options.offset === 0;
  const allProbesSelected = selectedProbes.length === allProbes.length;
  return {
    checks,
    selected,
    coverage: {
      allProblemCount: adapter.problems.length,
      selectedProblemIds: selected.map((problem) => problem.id),
      offset: options.offset,
      languages: LANGUAGES.filter((language) =>
        checks.some((check) => check.language === language),
      ),
      referenceSuites: selected.length ? ["samples", "hidden"] : [],
      probesIncluded: selectedProbes.length > 0,
      allProbeCount: allProbes.length,
      probeOffset: options.skipProbes ? null : options.probeOffset,
      probeLimit: options.skipProbes ? 0 : options.probeLimit,
      selectedProbeIds,
      skippedProbeIds: allProbes
        .filter((check) => !selectedProbeSet.has(check.id))
        .map((check) => check.id),
      allProbesSelected,
      fullBankSelected,
      fullCoverageSelected: fullBankSelected && allProbesSelected,
    },
  };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The provider returned an empty body.");
  const parts = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Provider JSON exceeded ${MAX_RESPONSE_BYTES} bytes.`);
    }
    parts.push(value);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(parts, length).toString("utf8"));
  } catch {
    throw new Error("The provider returned malformed JSON.");
  }
  if (!data || Array.isArray(data) || typeof data !== "object")
    throw new Error("The provider returned an invalid response object.");
  return data;
}

async function post(endpoint, body, timeoutMs, options, report) {
  if (!options.execute) throw new Error("Remote execution requires --execute.");
  if (
    !process.env.JDOODLE_CLIENT_ID?.trim() ||
    !process.env.JDOODLE_CLIENT_SECRET?.trim()
  )
    throw new Error("JDoodle credentials are missing.");
  report.requests[endpoint] = (report.requests[endpoint] || 0) + 1;
  const response = await fetch(API + "/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.JDOODLE_CLIENT_ID,
      clientSecret: process.env.JDOODLE_CLIENT_SECRET,
      ...body,
    }),
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`JDoodle returned HTTP ${response.status}.`);
    error.httpStatus = response.status;
    throw error;
  }
  return boundedJson(response);
}
async function credits(options, report) {
  const data = await post("credit-spent", {}, 10000, options, report);
  if (!Number.isSafeInteger(data.used) || data.used < 0)
    throw new Error("The provider returned an invalid credit counter.");
  return data.used;
}

function publicIPv4(address) {
  if (!net.isIPv4(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
async function networkTarget() {
  const host = process.env.JUDGE_PROBE_HOST || "example.com";
  if (!/^[a-zA-Z0-9.-]+$/.test(host))
    throw new Error(
      "JUDGE_PROBE_HOST must be a public hostname without a scheme, path, or port.",
    );
  const records = await lookup(host, { family: 4, all: true });
  const address = records.find((record) => publicIPv4(record.address))?.address;
  if (!address)
    throw new Error(
      "The network probe hostname did not resolve to an allowed public IPv4 address.",
    );
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port: 443 });
    socket.setTimeout(3000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("The local TCP control connection timed out."));
    });
    socket.once("error", () => {
      socket.destroy();
      reject(new Error("The local TCP control connection failed."));
    });
  });
  return { host, address, port: 443, localTcpControlPassed: true };
}

function responseEvidence(data) {
  const output = typeof data.output === "string" ? data.output : "";
  const scalar = (value) =>
    ["string", "number", "boolean"].includes(typeof value)
      ? String(value).slice(0, 80)
      : null;
  return {
    providerStatus: scalar(data.statusCode),
    compilationStatus: scalar(data.compilationStatus),
    isCompiled: scalar(data.isCompiled),
    isExecutionSuccess: scalar(data.isExecutionSuccess),
    exitCode: scalar(data.exitCode),
    hasError: Boolean(data.error),
    outputBytes: Buffer.byteLength(output),
    outputSha256: hash(output),
    cpuTime: scalar(data.cpuTime),
    memory: scalar(data.memory),
  };
}
export function evaluate(check, data, adapter) {
  const output = typeof data.output === "string" ? data.output : "";
  if (
    ["version", "network"].includes(check.category) &&
    (data.statusCode !== 200 ||
      data.error ||
      [false, 0, "0"].includes(data.isExecutionSuccess) ||
      [false, 0, "0"].includes(data.isCompiled) ||
      (data.exitCode !== undefined && Number(data.exitCode) !== 0))
  ) {
    return {
      status: "failed",
      failure: "The provider did not report a successful probe execution.",
    };
  }
  if (check.category === "version") {
    const line = output
      .split(/\r?\n/)
      .find((line) => line.startsWith(VERSION_MARKER));
    const value = line?.slice(VERSION_MARKER.length).trim();
    const failed =
      data.error ||
      data.statusCode !== 200 ||
      data.isExecutionSuccess === false ||
      data.isExecutionSuccess === 0;
    return !failed && value && /^[A-Za-z0-9 ._()+:/-]{1,120}$/.test(value)
      ? { status: "passed", runtimeVersion: value }
      : {
          status: "failed",
          failure: "A reliable runtime version was not returned.",
        };
  }
  if (check.category === "network") {
    const line = output
      .split(/\r?\n/)
      .find((line) => line.startsWith(NETWORK_MARKER));
    let value;
    try {
      value = JSON.parse(line?.slice(NETWORK_MARKER.length) || "");
    } catch {
      return {
        status: "failed",
        failure: "The network probe did not return its result marker.",
      };
    }
    if (value.connected === true)
      return {
        status: "failed",
        failure: "Outbound TCP succeeded despite internetEnabled:false.",
        securityFailure: true,
      };
    if (value.connected === false && value.policyDenied === true)
      return {
        status: "passed",
        networkObservation:
          "Explicit permission denial observed for this public TCP target.",
      };
    return {
      status: "inconclusive",
      failure:
        "Connection failure alone does not prove an egress policy; obtain provider confirmation or investigate the probe.",
      networkCode:
        typeof value.code === "string" || typeof value.code === "number"
          ? String(value.code).slice(0, 40)
          : null,
    };
  }
  const result = adapter.interpretJudge(data, check.problem, check.kind);
  if (check.category === "memory") {
    const capReached = output
      .split(/\r?\n/)
      .some((line) => line === MEMORY_MARKER + "cap_reached");
    const allocationRejected = output
      .split(/\r?\n/)
      .some((line) => line === MEMORY_MARKER + "allocation_failed");
    // Accept only explicit allocation failures. SIGKILL/exit 137, timeout,
    // generic runtime errors and provider outages do not establish a memory
    // limit, even when the provider also reports a memory usage value.
    const explicitOom =
      /(?:^|\n)MemoryError(?:[:\r\n]|$)|java\.lang\.OutOfMemoryError|std::bad_alloc|FATAL ERROR:[^\n]*(?:heap out of memory|Allocation failed)/i.test(
        output,
      );
    const compiled =
      ![false, 0, "0"].includes(data.isCompiled) &&
      (!data.compilationStatus || data.compilationStatus === "success");
    if (
      result.verdict === "runtime_error" &&
      compiled &&
      !capReached &&
      (allocationRejected || explicitOom)
    ) {
      return {
        status: "passed",
        verdict: result.verdict,
        memoryObservation:
          "An explicit allocation failure was safely reported before the bounded probe cap.",
        memoryProbeMaximumBytes: MEMORY_MAX_BYTES,
      };
    }
    if (
      ["judge_error", "compile_error", "output_limit"].includes(
        result.verdict,
      ) ||
      !compiled
    ) {
      return {
        status: "failed",
        verdict: result.verdict,
        failure:
          "The memory probe did not produce a reliable memory-limit observation.",
      };
    }
    return {
      status: "inconclusive",
      verdict: result.verdict,
      memoryProbeMaximumBytes: MEMORY_MAX_BYTES,
      failure: capReached
        ? "The bounded memory cap was reached without allocation failure; confirm the provider limit before changing the reviewed probe cap."
        : "No explicit memory-allocation failure was observed; a crash, kill, or timeout alone cannot establish memory isolation.",
    };
  }
  return result.verdict === check.expectedVerdict
    ? { status: "passed", verdict: result.verdict }
    : {
        status: "failed",
        verdict: result.verdict,
        expectedVerdict: check.expectedVerdict,
        failure: `Expected ${check.expectedVerdict}; the actual application adapter returned ${result.verdict}.`,
      };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node verify-judge.mjs [--project DIR] [--problem-offset N] [--problem-limit N] [--probe-offset N] [--probe-limit N] [--skip-probes] [--report FILE] [--execute --max-credits N]\n\nWithout --execute this only validates local files and prints a credit estimate.\nRequired for execution: JDOODLE_CLIENT_ID, JDOODLE_CLIENT_SECRET, JUDGE_DAILY_QUOTA.\nOptional: JUDGE_CREDIT_COST (default 1, provisional until measured), JUDGE_PROBE_HOST (default example.com).\n--problem-limit 0 runs probes only. Probes default to the full suite; --probe-offset/--probe-limit select a reviewed, zero-based range. Use disjoint ranges and retain every report with matching source/runtime hashes. --skip-probes excludes all probes and cannot be combined with a probe range. Reference checks always include all four languages and both sample/hidden suites.\n",
    );
    return;
  }
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: "preflight",
    executeRequested: options.execute,
    livePlayChanged: false,
    launchVerified: false,
    requestedCoveragePassed: false,
    requests: {},
    checks: [],
    failures: [],
    warnings: [],
    unverified: [
      "Actual concurrent execution capacity",
      "Daily quota reset hour/timezone and rollover",
      "Other reports needed for full-bank coverage when chunked",
      "Provider-confirmed memory ceiling and sandbox isolation beyond these bounded probes",
      "Comprehensive egress policy beyond the bounded TCP probes",
      "Deployed Worker/DO/Auth/Postgres integration",
    ],
    credentialsPresent: {
      clientId: Boolean(process.env.JDOODLE_CLIENT_ID?.trim()),
      clientSecret: Boolean(process.env.JDOODLE_CLIENT_SECRET?.trim()),
    },
  };
  let exitCode = 0;
  try {
    if (Number(process.versions.node.split(".")[0]) < 22)
      throw new Error("Node.js 22 or newer is required.");
    const adapter = await loadProject(options.project);
    const { checks, selected, coverage } = selectChecks(adapter, options);
    const cost = integerEnv("JUDGE_CREDIT_COST", 1);
    if (!cost)
      throw new Error(
        "JUDGE_CREDIT_COST must be a positive integer if supplied.",
      );
    const quota = integerEnv("JUDGE_DAILY_QUOTA");
    const executionEstimate = checks.length * cost;
    const estimatedMaximum = executionEstimate + 2;
    report.sourceHashes = adapter.sourceHashes;
    report.runtimes = adapter.RUNTIMES;
    report.coverage = coverage;
    if (!coverage.allProbesSelected) {
      report.unverified.push(
        "Probe categories omitted from this batch; see coverage.skippedProbeIds",
      );
      report.warnings.push(
        "This batch omits probes. Retain disjoint reports covering every probe with matching source/runtime hashes; requestedCoveragePassed describes this batch only.",
      );
    }
    report.plan = {
      executeRequests: checks.length,
      creditCounterRequestsAtMost: checks.length + 2,
      estimatedCreditCostPerExecution: cost,
      estimatedMaximumCredits: estimatedMaximum,
      maximumCreditsAuthorized: options.maxCredits,
      quotaFromEnvironment: quota,
      quotaSafetyCap: quota ? Math.floor(quota * 0.8) : null,
      boundedTimeoutProbeSeconds: checks.some(
        (check) => check.category === "timeout",
      )
        ? PROBE_SECONDS
        : 0,
      boundedMemoryProbeBytes: checks.some(
        (check) => check.category === "memory",
      )
        ? MEMORY_MAX_BYTES
        : 0,
      memoryProbeChunkBytes: checks.some((check) => check.category === "memory")
        ? MEMORY_CHUNK_BYTES
        : 0,
      creditAssumptions: [
        "The configured cost matches a non-network REST execution.",
        "Credit-counter reads are free; two consecutive reads test this before execution.",
        "Two provisional credits are reserved for initial accounting probes; any observed counter-read charge stops the run.",
        "Any execution cost mismatch, reset, or counter failure stops further execution.",
      ],
      checkIds: checks.map((check) => check.id),
    };
    if (
      !report.credentialsPresent.clientId ||
      !report.credentialsPresent.clientSecret
    )
      report.failures.push(
        "Missing JDOODLE_CLIENT_ID and/or JDOODLE_CLIENT_SECRET environment variables. No remote execution is allowed.",
      );
    if (!quota)
      report.failures.push(
        "Set JUDGE_DAILY_QUOTA to the quota confirmed in this account’s dashboard.",
      );
    if (quota && executionEstimate > Math.floor(quota * 0.8))
      report.warnings.push(
        "The selected checks exceed 80% of the account quota. Split problem and probe ranges into smaller batches and retain every report.",
      );
    report.warnings.push(
      "Stop other users of the same JDoodle credentials during this run; unrelated spending makes credit measurements inconclusive.",
    );
    process.stderr.write(
      `Plan: ${checks.length} executions; estimated maximum ${estimatedMaximum} credits under the stated assumptions; ${selected.length}/${adapter.problems.length} problems; ${coverage.selectedProbeIds.length}/${coverage.allProbeCount} probes; languages: ${coverage.languages.join(", ")}.\n`,
    );
    if (!options.execute) {
      report.status = "dry_run";
      report.warnings.push(
        "Dry run only: no API requests, DNS lookups, or TCP probes were made. Pass --execute and a reviewed --max-credits value to run.",
      );
      return;
    }
    if (options.maxCredits === null || options.maxCredits < estimatedMaximum)
      report.failures.push(
        `Execution requires --max-credits of at least ${estimatedMaximum} for this plan. Reduce the selected problem or probe count to lower it.`,
      );
    if (report.failures.length) {
      report.status = "preflight_failed";
      exitCode = 2;
      return;
    }

    let used = await credits(options, report);
    const control = await credits(options, report);
    report.credits = {
      before: used,
      counterControlAfter: control,
      after: control,
      estimatedExecutionSpend: 0,
    };
    if (control !== used)
      throw new Error(
        "Two credit-counter reads changed the used-credit count. Counter charging, concurrent use, or reset makes this run unsafe to budget. No execute calls were made.",
      );
    const cap = Math.floor(quota * 0.8);
    if (control + executionEstimate > cap)
      throw new Error(
        `Insufficient reserved free capacity: used=${control}, requested=${executionEstimate}, safety cap=${cap}. Select a smaller chunk or wait for the account’s verified reset.`,
      );
    let target = null;
    if (checks.some((check) => check.category === "network")) {
      try {
        target = await networkTarget();
        report.networkControl = target;
      } catch (error) {
        report.networkControl = {
          localTcpControlPassed: false,
          reason: safeError(error),
        };
      }
    }

    report.status = "running";
    for (const check of checks) {
      if (stopRequested) {
        report.status = "stopped";
        report.failures.push("Interrupted by the operator.");
        break;
      }
      if (check.category === "network" && !target) {
        report.checks.push({
          id: check.id,
          language: check.language,
          category: check.category,
          status: "inconclusive",
          failure:
            "The local public-target control failed; no remote network probe was attempted.",
        });
        continue;
      }
      if (
        used + cost > cap ||
        report.credits.estimatedExecutionSpend + cost > options.maxCredits - 2
      ) {
        report.status = "stopped";
        report.failures.push(
          "The remaining authorized free capacity is insufficient for the next execution.",
        );
        break;
      }
      const script =
        check.category === "network"
          ? networkScript(check.language, target)
          : check.script;
      const entry = {
        id: check.id,
        language: check.language,
        category: check.category,
        problemId: check.problem?.id || null,
        suite: check.kind || null,
        sourceSha256: hash(script),
        startedAt: new Date().toISOString(),
      };
      const started = Date.now();
      process.stderr.write(
        `Running ${check.id}${check.category === "timeout" ? " (provider timeout probe; may take two minutes)" : ""}\n`,
      );
      let fatal = false;
      try {
        const data = await post(
          "execute",
          {
            script,
            stdin: "",
            ...adapter.RUNTIMES[check.language],
            compileOnly: false,
            internetEnabled: false,
          },
          140000,
          options,
          report,
        );
        Object.assign(
          entry,
          responseEvidence(data),
          evaluate(check, data, adapter),
        );
        if (
          entry.securityFailure ||
          entry.verdict === "judge_error" ||
          [401, 403, 410, 429, 500, 502, 503, 504].includes(
            Number(data.statusCode),
          )
        )
          fatal = true;
      } catch (error) {
        entry.status = "failed";
        entry.failure = safeError(error);
        entry.httpStatus = error.httpStatus || null;
        // An unknown transport result must not be retried or assumed unbilled.
        fatal = true;
      }
      entry.latencyMs = Date.now() - started;
      report.credits.estimatedExecutionSpend += cost;
      try {
        const after = await credits(options, report);
        entry.creditDelta = after - used;
        report.credits.after = after;
        if (entry.creditDelta !== cost) {
          report.failures.push(
            `Credit accounting changed after ${check.id}: expected delta ${cost}, observed ${entry.creditDelta}. No further executions are allowed.`,
          );
          fatal = true;
        }
        used = after;
      } catch (error) {
        report.failures.push(
          `Credit reconciliation failed after ${check.id}: ${safeError(error)}`,
        );
        fatal = true;
      }
      report.checks.push(entry);
      // Checkpoint results so an operator interruption retains completed evidence.
      await writeFile(options.report, reportJson(report), { mode: 0o600 });
      if (fatal) {
        report.status = "stopped";
        break;
      }
    }
    const completed = new Set(report.checks.map((check) => check.id));
    for (const check of checks)
      if (!completed.has(check.id))
        report.checks.push({
          id: check.id,
          language: check.language,
          category: check.category,
          status: "skipped",
          failure: "Execution stopped before this check.",
        });
    if (report.status === "running") report.status = "completed";
    report.requestedCoveragePassed =
      report.status === "completed" &&
      report.checks.every((check) => check.status === "passed") &&
      report.failures.length === 0;
    report.summary = {
      passed: report.checks.filter((check) => check.status === "passed").length,
      failed: report.checks.filter((check) => check.status === "failed").length,
      inconclusive: report.checks.filter(
        (check) => check.status === "inconclusive",
      ).length,
      skipped: report.checks.filter((check) => check.status === "skipped")
        .length,
    };
    report.warnings.push(
      "This report does not set JUDGE_VERIFIED_AT or LIVE_MATCHES_ENABLED. Review failed/inconclusive checks, combine complete coverage reports, and verify concurrency/reset separately.",
    );
    if (!report.requestedCoveragePassed) exitCode = 1;
  } catch (error) {
    report.status =
      report.status === "running" ? "stopped" : "preflight_failed";
    report.failures.push(safeError(error));
    exitCode = 2;
  } finally {
    await saveReport(report, options.report);
    process.exitCode = exitCode;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  process.once("SIGINT", () => {
    stopRequested = true;
    abort.abort();
  });
  main().catch((error) => {
    process.stderr.write(`Verification could not start: ${safeError(error)}\n`);
    process.exitCode = 2;
  });
}
