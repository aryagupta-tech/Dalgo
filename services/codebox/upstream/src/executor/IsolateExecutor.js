import { execFile } from 'child_process';
import fs from 'fs/promises';
import { constants } from 'node:fs';
import path from 'path';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import { getStatusById } from '../languages/index.js';

const execFileAsync = promisify(execFile);

class InvalidOutputError extends Error {}
const MULTI_FILE_LANGUAGE_ID = 89;

// Atomic box-ID counter (0-999). Safe in single-threaded Node.js event loop.
let nextBoxId = 0;
function allocateBoxId() {
  const id = nextBoxId;
  nextBoxId = (nextBoxId + 1) % 1000;
  return id;
}

class IsolateExecutor {
  /**
   * Execute a submission inside an isolate sandbox.
   */
  async execute(submission) {
    const boxId = allocateBoxId();
    const { language } = submission;
    let boxDir = null;

    try {
      if (submission.additional_files || submission.compiler_options || submission.command_line_arguments || ![71, 54, 62, 63].includes(language.id)) throw new Error('Unsupported execution options');
      // ── Init sandbox ─────────────────────────────────────────────────
      const { stdout: initOut } = await execFileAsync('isolate', [
        '--init', `--box-id=${boxId}`, '--cg',
      ]);
      boxDir = initOut.trim();                     // e.g. /var/local/lib/isolate/0
      const workDir = path.join(boxDir, 'box');    // host path: <root>/box/ maps to /box inside sandbox

      // ── Write source code (skip if empty or multi-file) ────────────
      if (submission.source_code && language.source_file) {
        await fs.writeFile(path.join(workDir, language.source_file), submission.source_code);
      }

      // ── Write stdin ─────────────────────────────────────────────────
      const stdinPath = path.join(workDir, '_stdin.txt');
      await fs.writeFile(stdinPath, submission.stdin || '');

      // ── Extract additional files (ZIP) ──────────────────────────────
      if (submission.additional_files) {
        await this.extractAdditionalFiles(workDir, submission);
      }

      // ── Multi-file program: language 89 or ZIP with run script ─────
      if (language.id === MULTI_FILE_LANGUAGE_ID) {
        return await this.executeMultiFile(boxId, workDir, submission);
      }
      // Detect multi-file mode: empty source_code + additional_files with run script
      if (!submission.source_code && submission.additional_files) {
        for (const name of ['run', 'run.sh']) {
          try {
            await fs.access(path.join(workDir, name));
            return await this.executeMultiFile(boxId, workDir, submission);
          } catch { /* try next */ }
        }
      }

      // ── Compile if needed ───────────────────────────────────────────
      if (language.compile_cmd) {
        let compileCmd = language.compile_cmd;
        if (submission.compiler_options) {
          compileCmd += ` ${submission.compiler_options}`;
        }
        const compileResult = await this.runIsolate(boxId, workDir, {
          cmd: compileCmd,
          timeLimit: config.execution.compileCpuTimeLimit,
          wallTimeLimit: config.execution.compileWallTimeLimit,
          memoryLimit: Math.max(submission.memory_limit, language.min_memory || 0),
          processes: submission.max_processes_and_or_threads,
        });

        if (compileResult.isoStatus === 'XX') throw new Error('Compiler sandbox failed');
        if (compileResult.exitCode !== 0 || compileResult.isoStatus) {
          return {
            status: getStatusById(6),
            compile_output: compileResult.stderr || compileResult.stdout || compileResult.message,
            time: null,
            wall_time: null,
            memory: null,
            stdout: null,
            stderr: null,
            exit_code: compileResult.exitCode,
            exit_signal: compileResult.exitSignal,
          };
        }
      }

      // ── Run ─────────────────────────────────────────────────────────
      let runCmd = language.run_cmd;
      if (submission.command_line_arguments) {
        runCmd += ` ${submission.command_line_arguments}`;
      }

      const result = await this.runIsolate(boxId, workDir, {
        cmd: runCmd,
        stdinFile: stdinPath,
        timeLimit: submission.cpu_time_limit,
        wallTimeLimit: submission.wall_time_limit,
        memoryLimit: submission.memory_limit,
        processes: submission.max_processes_and_or_threads,
        fsize: submission.max_file_size || 1024,
      });

      return this.buildResult(result, submission);
    } catch (error) {
      logger.error({
        event: 'isolate_execution_error',
        token: submission.token,
        error: error.message,
      });
      return {
        status: getStatusById(error instanceof InvalidOutputError ? 12 : 13),
        message: error instanceof InvalidOutputError ? "Invalid output file" : error.message,
        time: null,
        wall_time: null,
        memory: null,
        stdout: null,
        stderr: null,
        compile_output: null,
        exit_code: null,
        exit_signal: null,
      };
    } finally {
      // Always clean up the box
      try {
        await execFileAsync('isolate', ['--cleanup', `--box-id=${boxId}`, '--cg']);
      } catch { throw new Error('Sandbox cleanup failed'); }
    }
  }

  /**
   * Multi-file program (language_id 89): compile + run scripts from ZIP.
   */
  async executeMultiFile(boxId, workDir, submission) {
    // Verify run script exists (check both 'run' and 'run.sh')
    let runScript = null;
    for (const name of ['run', 'run.sh']) {
      try {
        await fs.access(path.join(workDir, name));
        runScript = name;
        break;
      } catch { /* try next */ }
    }
    if (!runScript) {
      return {
        status: getStatusById(6),
        compile_output: 'Multi-file program requires a "run" (or "run.sh") script in the ZIP archive',
        time: null,
        wall_time: null,
        memory: null,
        stdout: null,
        stderr: null,
        exit_code: null,
        exit_signal: null,
      };
    }

    const stdinPath = path.join(workDir, '_stdin.txt');

    // Optional compile step (check both 'compile' and 'compile.sh')
    let compileScript = null;
    for (const name of ['compile', 'compile.sh']) {
      try {
        await fs.access(path.join(workDir, name));
        compileScript = name;
        break;
      } catch { /* try next */ }
    }

    if (compileScript) {
      const compileResult = await this.runIsolate(boxId, workDir, {
        cmd: `bash /box/${compileScript}`,
        timeLimit: config.execution.compileCpuTimeLimit,
        wallTimeLimit: config.execution.compileWallTimeLimit,
        memoryLimit: Math.max(submission.memory_limit, 512000),
        processes: submission.max_processes_and_or_threads,
      });

      if (compileResult.exitCode !== 0 || compileResult.isoStatus) {
        return {
          status: getStatusById(6),
          compile_output: compileResult.stderr || compileResult.stdout || compileResult.message,
          time: null,
          wall_time: null,
          memory: null,
          stdout: null,
          stderr: null,
          exit_code: compileResult.exitCode,
          exit_signal: compileResult.exitSignal,
        };
      }
    }

    // Run
    const result = await this.runIsolate(boxId, workDir, {
      cmd: `bash /box/${runScript}`,
      stdinFile: stdinPath,
      timeLimit: submission.cpu_time_limit,
      wallTimeLimit: submission.wall_time_limit,
      memoryLimit: submission.memory_limit,
      processes: submission.max_processes_and_or_threads,
      fsize: submission.max_file_size || 1024,
    });

    return this.buildResult(result, submission);
  }

  /**
   * Core isolate invocation.
   * Returns { stdout, stderr, time, wallTime, memory, exitCode, exitSignal, isoStatus }.
   */
  async runIsolate(boxId, workDir, opts) {
    const { cmd, stdinFile, timeLimit, wallTimeLimit, memoryLimit, processes, fsize = 10240 } = opts;

    const metaPath = `/tmp/isolate-meta-${boxId}.txt`;
    await fs.rm(metaPath, { force: true });

    // Sandbox-relative paths (used by isolate flags)
    const sandboxStdout = '/box/_stdout.txt';
    const sandboxStderr = '/box/_stderr.txt';

    // Host paths (for reading results after execution)
    const hostStdoutPath = path.join(workDir, '_stdout.txt');
    const hostStderrPath = path.join(workDir, '_stderr.txt');

    const args = [
      `--box-id=${boxId}`,
      '--cg',
      `--cg-mem=${memoryLimit}`,           // cgroup memory limit (KB)
      `--meta=${metaPath}`,                // host path (written by parent process)
      `--time=${timeLimit}`,
      `--wall-time=${wallTimeLimit}`,
      `--processes=${processes}`,
      `--fsize=${fsize}`,                     // max output file size (KB)
      `--stdout=${sandboxStdout}`,          // sandbox path
      `--stderr=${sandboxStderr}`,          // sandbox path
      '--dir=/etc:noexec',                 // read-only /etc (Java, Python need it)
      '--dir=/tmp:tmp',                       // writable /tmp
      '--env=PATH=/usr/local/bin:/usr/bin:/bin',
      '--env=HOME=/box',
      '--env=LANG=C.UTF-8',
    ];

    if (stdinFile) {
      args.push(`--stdin=/box/_stdin.txt`);  // sandbox path (file written to workDir on host)
    }

    args.push('--run', '--', '/bin/sh', '-c', `cd /box && ${cmd}`);

    try {
      await execFileAsync('isolate', args, {
        timeout: (wallTimeLimit + 10) * 1000,
      });
    } catch {
      // isolate exits non-zero on TLE, RE, etc. — that's normal
    }

    // Read outputs from HOST paths
    let stdout = '';
    let stderr = '';
    stdout = await this.readOutput(hostStdoutPath);
    stderr = await this.readOutput(hostStderrPath);

    // Parse meta file (isolate's precise measurements)
    const meta = await this.parseMeta(metaPath);

    return { stdout, stderr, ...meta };
  }

  /**
   * Parse isolate's meta file.
   * Format: key:value per line.
   * Keys: time, time-wall, max-rss, cg-mem, status, exitcode, exitsig, message, killed
   */
  async readOutput(filename) {
    let file;
    try {
      file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile()) throw new InvalidOutputError('Invalid output file');
      const buffer = Buffer.alloc(Math.min(stat.size, 65537));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      if (error.code === 'ELOOP') throw new InvalidOutputError('Invalid output file');
      throw error;
    } finally { await file?.close(); }
  }

  async parseMeta(metaPath) {
    const defaults = {
      time: null,
      wallTime: null,
      memory: null,
      exitCode: null,
      exitSignal: null,
      isoStatus: 'XX',
      message: null,
    };

    try {
      const content = await fs.readFile(metaPath, 'utf-8');
      const meta = {};
      for (const line of content.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }

      if (!meta.status && (!Number.isFinite(Number(meta.exitcode)) || meta.exitcode === undefined || !Number.isFinite(Number(meta.time)))) return defaults;
      if (meta.status && !['RE', 'SG', 'TO', 'XX'].includes(meta.status)) return defaults;
      return {
        time: meta.time ? parseFloat(meta.time) : null,
        wallTime: meta['time-wall'] ? parseFloat(meta['time-wall']) : null,
        memory: meta['max-rss'] ? parseInt(meta['max-rss']) : (meta['cg-mem'] ? parseInt(meta['cg-mem']) : null),
        exitCode: meta.exitcode ? parseInt(meta.exitcode) : 0,
        exitSignal: meta.exitsig ? parseInt(meta.exitsig) : null,
        isoStatus: meta.status || null,   // RE, SG, TO, XX
        message: meta.message || null,
      };
    } catch {
      return defaults;
    }
  }

  /**
   * Extract base64-encoded ZIP into the work directory.
   */
  async extractAdditionalFiles(workDir, submission) {
    const tmpZip = path.join(workDir, '_additional.zip');

    try {
      const zipBuffer = Buffer.from(submission.additional_files, 'base64');
      await fs.writeFile(tmpZip, zipBuffer);

      // Path traversal check
      const { stdout: listing } = await execFileAsync('unzip', ['-l', tmpZip]);
      if (listing.includes('../') || listing.includes('/..')) {
        throw new Error('ZIP archive contains path traversal entries');
      }

      await execFileAsync('unzip', ['-n', '-qq', tmpZip, '-d', workDir]);
      await fs.unlink(tmpZip);

      logger.info({
        event: 'additional_files_extracted',
        token: submission.token,
        size: zipBuffer.length,
      });
    } catch (error) {
      try { await fs.unlink(tmpZip); } catch { /* ignore */ }
      throw new Error(`Failed to extract additional files: ${error.message}`);
    }
  }

  /**
   * Map isolate meta to a Judge0-compatible result object.
   */
  buildResult(result, submission) {
    let status;

    if (result.isoStatus === 'TO') {
      status = getStatusById(5);            // Time Limit Exceeded
    } else if (result.isoStatus === 'SG') {
      // Killed by signal
      const sig = result.exitSignal;
      if (sig === 11) status = getStatusById(7);       // SIGSEGV
      else if (sig === 8) status = getStatusById(9);   // SIGFPE
      else if (sig === 6) status = getStatusById(10);  // SIGABRT
      else if (sig === 25) status = getStatusById(8);  // SIGXFSZ
      else if (sig === 9) status = getStatusById(5);   // SIGKILL → TLE/MLE
      else status = getStatusById(12);                 // Other
    } else if (result.isoStatus === 'RE') {
      status = getStatusById(11);           // NZEC
    } else if (result.isoStatus === 'XX') {
      status = getStatusById(13);           // Internal Error
    } else if (result.exitCode === 0) {
      status = getStatusById(3);            // Accepted
    } else {
      status = getStatusById(11);           // NZEC
    }

    if (Buffer.byteLength(result.stdout || '') >= 65536 || Buffer.byteLength(result.stderr || '') >= 65536) status = getStatusById(8);
    // Truncate outputs
    const maxLen = 65536;
    let stdout = result.stdout || null;
    let stderr = result.stderr || null;
    if (stdout && stdout.length > maxLen) stdout = stdout.slice(0, maxLen) + '\n[truncated]';
    if (stderr && stderr.length > maxLen) stderr = stderr.slice(0, maxLen) + '\n[truncated]';

    // Merge stderr into stdout if requested
    if (submission.redirect_stderr_to_stdout) {
      stdout = (stdout || '') + (stderr ? '\n' + stderr : '');
      stderr = null;
    }

    return {
      status,
      stdout: stdout || null,
      stderr: stderr || null,
      compile_output: null,
      time: result.time != null ? result.time.toFixed(3) : null,
      wall_time: result.wallTime != null ? result.wallTime.toFixed(3) : null,
      memory: result.memory != null ? result.memory : null,
      exit_code: result.exitCode,
      exit_signal: result.exitSignal,
      message: result.message,
    };
  }
}

export default IsolateExecutor;
