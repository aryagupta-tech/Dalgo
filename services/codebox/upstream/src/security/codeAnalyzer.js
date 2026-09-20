/**
 * Pre-execution source code analyzer.
 * Detects obviously dangerous patterns and rejects before execution.
 * This is defense-in-depth — isolate is the primary sandbox.
 *
 * NOT a substitute for sandboxing. Static analysis is bypassable
 * via obfuscation, but it catches low-effort attacks and saves resources.
 */

const MULTI_FILE_LANGUAGE_ID = 89;

// ── Sensitive file paths (all languages) ────────────────────────────────────
const SENSITIVE_PATHS = [
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\/etc\/group/,
  /\/etc\/gshadow/,
  /\/etc\/hostname/,
  /\/etc\/hosts/,
  /\/proc\/self\//,
  /\/proc\/1\//,
  /\/proc\/version/,
  /\/proc\/cpuinfo/,
  /\/proc\/meminfo/,
  /\/proc\/net\//,
  /\/proc\/mounts/,
  /\/sys\/class/,
  /\/sys\/devices/,
  /\/dev\/sd[a-z]/,
  /\/dev\/nvme/,
  /\/dev\/tcp/,
  /\/dev\/udp/,
  /\/var\/run\/docker\.sock/,
  /\/root\//,
];

// ── C / C++ patterns (language IDs 50, 54) ──────────────────────────────────
const C_CPP_PATTERNS = [
  { pattern: /\bptrace\s*\(/, reason: 'ptrace syscall' },
  { pattern: /sys\/ptrace\.h/, reason: 'ptrace header' },
  { pattern: /SYS_ptrace/, reason: 'ptrace syscall constant' },
  { pattern: /\bsocket\s*\(/, reason: 'socket syscall' },
  { pattern: /\bconnect\s*\(\s*\w+\s*,/, reason: 'network connect' },
  { pattern: /\bbind\s*\(\s*\w+\s*,/, reason: 'network bind' },
  { pattern: /\blisten\s*\(\s*\w+\s*,/, reason: 'network listen' },
  { pattern: /\baccept\s*\(/, reason: 'network accept' },
  { pattern: /\bmount\s*\(/, reason: 'mount syscall' },
  { pattern: /\bsyscall\s*\(\s*(101|200|435)\b/, reason: 'dangerous syscall number' }, // ptrace, tkill, clone3
  { pattern: /while\s*\(\s*1\s*\)\s*\{?\s*fork\s*\(/, reason: 'fork bomb' },
  { pattern: /while\s*\(fork\s*\(\)/, reason: 'fork bomb' },
  { pattern: /:\s*fork\s*\(\)\s*\|/, reason: 'fork bomb' },
  { pattern: /keylog/i, reason: 'keylogger indicator' },
];

// ── Java patterns (language ID 62) ──────────────────────────────────────────
const JAVA_PATTERNS = [
  { pattern: /Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec/, reason: 'Runtime.exec()' },
  { pattern: /ProcessBuilder/, reason: 'ProcessBuilder' },
  { pattern: /java\.net\.Socket/, reason: 'network socket' },
  { pattern: /java\.net\.ServerSocket/, reason: 'server socket' },
  { pattern: /java\.net\.DatagramSocket/, reason: 'UDP socket' },
  { pattern: /java\.net\.URL/, reason: 'URL connection' },
  { pattern: /java\.net\.HttpURLConnection/, reason: 'HTTP connection' },
  { pattern: /sun\.misc\.Unsafe/, reason: 'Unsafe access' },
  { pattern: /java\.lang\.reflect/, reason: 'reflection' },
];

// ── Python patterns (language ID 71) ─────────────────────────────────────────
const PYTHON_PATTERNS = [
  { pattern: /\bos\s*\.\s*system\s*\(/, reason: 'os.system()' },
  { pattern: /\bsubprocess\b/, reason: 'subprocess module' },
  { pattern: /\bos\s*\.\s*popen\s*\(/, reason: 'os.popen()' },
  { pattern: /\bctypes\b/, reason: 'ctypes (native call)' },
  { pattern: /\bos\s*\.\s*fork\s*\(/, reason: 'os.fork()' },
  { pattern: /import\s+pty/, reason: 'pty module' },
  { pattern: /import\s+socket/, reason: 'socket module' },
  { pattern: /from\s+socket\s+import/, reason: 'socket module' },
  { pattern: /while\s+True\s*:\s*os\s*\.\s*fork/, reason: 'fork bomb' },
  { pattern: /exec\s*\(\s*__import__/, reason: 'dynamic import execution' },
  { pattern: /\b__import__\s*\(\s*['"]os['"]/, reason: 'dynamic os import' },
];

// ── JavaScript / TypeScript patterns (language IDs 63, 74) ───────────────────
const JS_PATTERNS = [
  { pattern: /child_process/, reason: 'child_process module' },
  { pattern: /require\s*\(\s*['"]net['"]/, reason: 'net module' },
  { pattern: /require\s*\(\s*['"]dgram['"]/, reason: 'dgram module' },
  { pattern: /require\s*\(\s*['"]http['"]/, reason: 'http module' },
  { pattern: /require\s*\(\s*['"]https['"]/, reason: 'https module' },
  { pattern: /process\s*\.\s*binding\s*\(/, reason: 'process.binding()' },
  { pattern: /from\s+['"]child_process['"]/, reason: 'child_process module' },
  { pattern: /from\s+['"]net['"]/, reason: 'net module' },
];

// ── Map language IDs to their pattern sets ───────────────────────────────────
const LANGUAGE_PATTERNS = {
  50: C_CPP_PATTERNS,   // C
  54: C_CPP_PATTERNS,   // C++
  62: JAVA_PATTERNS,    // Java
  71: PYTHON_PATTERNS,  // Python
  63: JS_PATTERNS,      // JavaScript
  74: JS_PATTERNS,      // TypeScript
};

/**
 * Analyze source code for dangerous patterns.
 *
 * @param {string} sourceCode - The source code to analyze
 * @param {number} languageId - The Judge0 language ID
 * @returns {{ rejected: boolean, reason: string|null }}
 */
export function analyzeCode(sourceCode, languageId) {
  // Skip analysis for multi-file programs (can't scan ZIP here)
  if (!sourceCode || languageId === MULTI_FILE_LANGUAGE_ID) {
    return { rejected: false, reason: null };
  }

  // Check sensitive file paths (universal)
  for (const pathRegex of SENSITIVE_PATHS) {
    if (pathRegex.test(sourceCode)) {
      return {
        rejected: true,
        reason: `Access to sensitive path: ${pathRegex.source}`,
      };
    }
  }

  // Check language-specific patterns
  const patterns = LANGUAGE_PATTERNS[languageId];
  if (patterns) {
    for (const { pattern, reason } of patterns) {
      if (pattern.test(sourceCode)) {
        return { rejected: true, reason: `Forbidden operation: ${reason}` };
      }
    }
  }

  return { rejected: false, reason: null };
}

export default { analyzeCode };
