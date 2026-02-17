/**
 * Local execution environment.
 *
 * Runs commands and accesses files directly on the host machine.
 * Optionally restricts file operations to a specified directory
 * and blocks symlink traversal when path restriction is active.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ExecutionEnvironment,
  ExecOptions,
  ExecResult,
  GlobOptions,
  GrepOptions,
  GrepMatch,
  EnvironmentInfo,
  LocalEnvironmentConfig,
} from './types.js';
import { truncateOutput, isBinary, parseGrepOutput, stripAnsi } from './output.js';

/** Default command timeout in seconds */
const DEFAULT_TIMEOUT_SECONDS = 300;

/** Default maximum output characters */
const DEFAULT_MAX_OUTPUT_CHARS = 100_000;

/**
 * Execute a shell command via child_process.spawn.
 * @internal
 */
function spawnLocal(
  command: string,
  options: {
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    timeout?: number | undefined;
    stdin?: string | undefined;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const proc = spawn('sh', ['-c', command], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Guard against stream errors leaving the promise unresolved
    proc.stdin.on('error', () => {
      /* noop */
    });
    proc.stdout.on('error', () => {
      /* noop */
    });
    proc.stderr.on('error', () => {
      /* noop */
    });

    const timeoutMs = (options.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      settle(() => {
        if (killed) {
          resolve({
            exitCode: 137,
            stdout,
            stderr: stderr + '\n[Process killed: timeout exceeded]',
          });
        } else {
          resolve({ exitCode: code ?? 1, stdout, stderr });
        }
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => {
        reject(err);
      });
    });

    if (options.stdin) {
      proc.stdin.write(options.stdin, () => {
        proc.stdin.end();
      });
    } else {
      proc.stdin.end();
    }
  });
}

/**
 * Local execution environment.
 *
 * Executes commands and file operations directly on the host.
 * When `pathRestriction` is configured, file operations are restricted
 * to the specified directory and symlink traversal is blocked.
 */
export class LocalEnvironment implements ExecutionEnvironment {
  readonly type = 'local' as const;

  private readonly config: LocalEnvironmentConfig;
  private readonly cwd: string;
  private readonly maxOutputChars: number;

  constructor(config?: LocalEnvironmentConfig, maxOutputChars?: number) {
    this.config = config ?? {};
    this.cwd = path.resolve(config?.cwd ?? process.cwd());
    this.maxOutputChars = maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  }

  async initialize(): Promise<void> {
    // Validate that the working directory exists
    try {
      const stat = await fs.stat(this.cwd);
      if (!stat.isDirectory()) {
        throw new Error(`Working directory is not a directory: ${this.cwd}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Working directory does not exist: ${this.cwd}`);
      }
      throw err;
    }
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const cwd = opts?.cwd ? this.resolvePath(opts.cwd) : this.cwd;
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const start = Date.now();

    const result = await spawnLocal(command, {
      cwd,
      env: opts?.env,
      timeout,
      stdin: opts?.stdin,
    });

    const durationMs = Date.now() - start;
    const { text: stdout, truncated: stdoutTruncated } = truncateOutput(
      stripAnsi(result.stdout),
      this.maxOutputChars
    );
    const { text: stderr } = truncateOutput(stripAnsi(result.stderr), this.maxOutputChars);

    return {
      exitCode: result.exitCode,
      stdout,
      stderr,
      durationMs,
      truncated: stdoutTruncated,
    };
  }

  async readFile(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);
    // Path restriction for reads is handled at the tool layer (approval gate).
    // Symlink traversal is still blocked at the environment level.
    await this.assertNotSymlink(resolved);

    const buffer = await fs.readFile(resolved);
    if (isBinary(buffer)) {
      throw new Error(`Cannot read binary file: ${filePath}`);
    }
    return buffer.toString('utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolvePath(filePath);
    this.assertPathSafe(resolved);

    const parentDir = path.dirname(resolved);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    const resolved = this.resolvePath(filePath);
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async glob(pattern: string, opts?: GlobOptions): Promise<string[]> {
    const cwd = opts?.cwd ? this.resolvePath(opts.cwd) : this.cwd;

    let command = `find ${cwd} -type f -name '${pattern}'`;

    if (opts?.ignore) {
      for (const ignore of opts.ignore) {
        command += ` ! -path '${ignore}'`;
      }
    }

    command += ' 2>/dev/null | sort | head -1000';

    const result = await this.exec(command);
    if (!result.stdout.trim()) return [];

    return result.stdout.trim().split('\n').filter(Boolean);
  }

  async grep(pattern: string, opts?: GrepOptions): Promise<GrepMatch[]> {
    const cwd = opts?.cwd ? this.resolvePath(opts.cwd) : this.cwd;
    const maxResults = opts?.maxResults ?? 100;

    let command = 'grep -rn';

    if (opts?.contextLines !== undefined) {
      command += ` -C ${String(opts.contextLines)}`;
    }

    if (opts?.include) {
      for (const inc of opts.include) {
        command += ` --include='${inc}'`;
      }
    }

    // Escape single quotes in pattern, use -- to separate pattern from paths
    const escapedPattern = pattern.replace(/'/g, "'\\''");
    command += ` -- '${escapedPattern}' ${cwd}`;
    command += ` 2>/dev/null | head -${String(maxResults)}`;

    const result = await this.exec(command);
    return parseGrepOutput(result.stdout);
  }

  async destroy(): Promise<void> {
    // No-op — local environment has no resources to clean up
  }

  getCwd(): string {
    return this.cwd;
  }

  getInfo(): EnvironmentInfo {
    return {
      type: 'local',
      cwd: this.cwd,
    };
  }

  /**
   * Resolve a path relative to the working directory.
   */
  private resolvePath(p: string): string {
    return path.resolve(this.cwd, p);
  }

  /**
   * Assert that a resolved path stays within the path restriction.
   * No-op when path restriction is not configured.
   */
  private assertPathSafe(resolvedPath: string): void {
    if (!this.config.pathRestriction) return;

    const restriction = path.resolve(this.config.pathRestriction);
    if (resolvedPath !== restriction && !resolvedPath.startsWith(restriction + '/')) {
      throw new Error(`Path traversal detected: "${resolvedPath}" is outside of "${restriction}"`);
    }
  }

  /**
   * Assert that a path is not a symbolic link.
   * Only enforced when path restriction is configured.
   */
  private async assertNotSymlink(resolvedPath: string): Promise<void> {
    if (!this.config.pathRestriction) return;

    try {
      const stat = await fs.lstat(resolvedPath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Symbolic link detected: "${resolvedPath}". Symlinks are blocked when pathRestriction is set.`
        );
      }
    } catch (err) {
      // File doesn't exist — that's fine, let readFile handle the ENOENT
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }
}
