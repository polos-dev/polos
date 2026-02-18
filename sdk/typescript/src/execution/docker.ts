/**
 * Docker execution environment.
 *
 * Runs commands inside a Docker container and accesses files via bind mount
 * for optimal performance. The container runs `sleep infinity` and commands
 * are executed via `docker exec`.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ExecutionEnvironment,
  ExecOptions,
  ExecResult,
  GlobOptions,
  GrepOptions,
  GrepMatch,
  EnvironmentInfo,
  DockerEnvironmentConfig,
} from './types.js';
import { truncateOutput, isBinary, parseGrepOutput, stripAnsi } from './output.js';

/** Default container working directory */
const DEFAULT_CONTAINER_WORKDIR = '/workspace';

/** Default command timeout in seconds */
const DEFAULT_TIMEOUT_SECONDS = 300;

/** Default maximum output characters */
const DEFAULT_MAX_OUTPUT_CHARS = 100_000;

/**
 * Execute a command via child_process.spawn and capture output.
 * @internal
 */
function spawnCommand(
  command: string,
  args: string[],
  options?: { timeout?: number | undefined; stdin?: string | undefined }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

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
      // Ignore stdin errors — the process may have exited before we finished writing.
      // The 'close' event will still fire and resolve the promise.
    });
    proc.stdout.on('error', () => {
      /* noop */
    });
    proc.stderr.on('error', () => {
      /* noop */
    });

    const timeoutMs = (options?.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
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

    if (options?.stdin) {
      proc.stdin.write(options.stdin, () => {
        proc.stdin.end();
      });
    } else {
      proc.stdin.end();
    }
  });
}

/**
 * Docker-based execution environment.
 *
 * Creates a persistent Docker container with a bind-mounted workspace.
 * Commands run inside the container via `docker exec`, while file
 * operations use the host filesystem through the bind mount for speed.
 */
export class DockerEnvironment implements ExecutionEnvironment {
  readonly type = 'docker' as const;

  private containerId: string | null = null;
  private containerName: string;
  private readonly config: DockerEnvironmentConfig;
  private readonly containerWorkdir: string;
  private readonly maxOutputChars: number;

  constructor(config: DockerEnvironmentConfig, maxOutputChars?: number) {
    this.config = config;
    this.containerWorkdir = config.containerWorkdir ?? DEFAULT_CONTAINER_WORKDIR;
    this.containerName = `polos-sandbox-${randomUUID().slice(0, 8)}`;
    this.maxOutputChars = maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  }

  /**
   * Get the container name (useful for health checking and identification).
   */
  getContainerName(): string {
    return this.containerName;
  }

  async initialize(labels?: Record<string, string>): Promise<void> {
    const args = [
      'run',
      '-d',
      '--name',
      this.containerName,
      '-v',
      `${this.config.workspaceDir}:${this.containerWorkdir}:rw`,
      '-w',
      this.containerWorkdir,
    ];

    if (this.config.memory) {
      args.push('--memory', this.config.memory);
    }
    if (this.config.cpus) {
      args.push('--cpus', this.config.cpus);
    }
    args.push('--network', this.config.network ?? 'none');

    if (this.config.env) {
      for (const [key, value] of Object.entries(this.config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    if (labels) {
      for (const [key, value] of Object.entries(labels)) {
        args.push('--label', `${key}=${value}`);
      }
    }

    args.push(this.config.image, 'sleep', 'infinity');

    const result = await spawnCommand('docker', args, { timeout: 60 });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Docker container: ${result.stderr.trim()}`);
    }
    this.containerId = result.stdout.trim().slice(0, 12);

    // Run setup command if provided
    if (this.config.setupCommand) {
      const setupResult = await this.exec(this.config.setupCommand);
      if (setupResult.exitCode !== 0) {
        throw new Error(
          `Setup command failed (exit ${String(setupResult.exitCode)}): ${setupResult.stderr.trim()}`
        );
      }
    }
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    this.assertInitialized();

    // Only use -i (interactive/keep-stdin-open) when stdin data is provided.
    // Without stdin data, -i can cause docker exec to hang waiting for EOF.
    const args = opts?.stdin ? ['exec', '-i'] : ['exec'];

    // Set working directory
    const cwd = opts?.cwd ?? this.containerWorkdir;
    args.push('-w', cwd);

    // Set environment variables
    if (opts?.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(this.containerName, 'sh', '-c', command);

    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const start = Date.now();

    const result = await spawnCommand('docker', args, {
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
    const hostPath = this.toHostPath(filePath);
    const buffer = await fs.readFile(hostPath);
    if (isBinary(buffer)) {
      throw new Error(`Cannot read binary file: ${filePath}`);
    }
    return buffer.toString('utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const hostPath = this.toHostPath(filePath);
    await fs.mkdir(path.dirname(hostPath), { recursive: true });
    await fs.writeFile(hostPath, content, 'utf-8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    const hostPath = this.toHostPath(filePath);
    try {
      await fs.access(hostPath);
      return true;
    } catch {
      return false;
    }
  }

  async glob(pattern: string, opts?: GlobOptions): Promise<string[]> {
    const cwd = opts?.cwd ?? this.containerWorkdir;
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
    const cwd = opts?.cwd ?? this.containerWorkdir;
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

    // Use -- to separate pattern from paths, escape single quotes in pattern
    const escapedPattern = pattern.replace(/'/g, "'\\''");
    command += ` -- '${escapedPattern}' ${cwd}`;
    command += ` 2>/dev/null | head -${String(maxResults)}`;

    const result = await this.exec(command);
    return parseGrepOutput(result.stdout);
  }

  async destroy(): Promise<void> {
    if (!this.containerId) return;
    try {
      await spawnCommand('docker', ['rm', '-f', this.containerName], { timeout: 30 });
    } finally {
      this.containerId = null;
    }
  }

  getCwd(): string {
    return this.containerWorkdir;
  }

  getInfo(): EnvironmentInfo {
    return {
      type: 'docker',
      cwd: this.containerWorkdir,
      sandboxId: this.containerId ?? undefined,
    };
  }

  /**
   * Translate a container path to the corresponding host filesystem path.
   * Validates the path stays within the workspace to prevent traversal.
   */
  toHostPath(containerPath: string): string {
    // Resolve relative to container workdir
    const resolved = path.posix.resolve(this.containerWorkdir, containerPath);

    // Ensure the resolved path is within the container workdir
    if (!resolved.startsWith(this.containerWorkdir)) {
      throw new Error(`Path traversal detected: "${containerPath}" resolves outside workspace`);
    }

    // Translate to host path
    const relative = path.posix.relative(this.containerWorkdir, resolved);
    return path.join(this.config.workspaceDir, relative);
  }

  /**
   * Translate a host filesystem path to the corresponding container path.
   */
  toContainerPath(hostPath: string): string {
    const resolved = path.resolve(hostPath);

    if (!resolved.startsWith(this.config.workspaceDir)) {
      throw new Error(
        `Path outside workspace: "${hostPath}" is not within "${this.config.workspaceDir}"`
      );
    }

    const relative = path.relative(this.config.workspaceDir, resolved);
    return path.posix.join(this.containerWorkdir, relative);
  }

  private assertInitialized(): void {
    if (!this.containerId) {
      throw new Error('Docker environment not initialized. Call initialize() first.');
    }
  }
}
