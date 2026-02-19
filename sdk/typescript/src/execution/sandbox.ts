/**
 * Managed sandbox — wraps an ExecutionEnvironment with identity,
 * lifecycle tracking, and crash recovery.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutionEnvironment, SandboxConfig, SandboxScope } from './types.js';
import { DockerEnvironment } from './docker.js';
import { LocalEnvironment } from './local.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ name: 'sandbox' });

/** Default base directory for sandbox workspaces. */
const DEFAULT_WORKSPACES_DIR = path.join(os.homedir(), '.polos', 'workspaces');

/** Environment variable to override the base workspaces directory. */
const WORKSPACES_DIR_ENV = 'POLOS_WORKSPACES_DIR';

/**
 * A managed sandbox wrapping an ExecutionEnvironment.
 */
export interface Sandbox {
  readonly id: string;
  readonly scope: SandboxScope;
  readonly config: SandboxConfig;
  readonly workerId: string;
  readonly sessionId?: string | undefined;
  readonly activeExecutionIds: ReadonlySet<string>;
  readonly initialized: boolean;
  readonly destroyed: boolean;
  readonly lastActivityAt: Date;

  /** Get or lazily initialize the environment. Updates lastActivityAt. */
  getEnvironment(): Promise<ExecutionEnvironment>;

  /** Record that an execution is using this sandbox. */
  attachExecution(executionId: string): void;

  /** Record that an execution is done with this sandbox. */
  detachExecution(executionId: string): void;

  /** Destroy the sandbox. Safe to call multiple times. */
  destroy(): Promise<void>;

  /** Recreate after container crash. Filesystem survives via bind mount. */
  recreate(): Promise<void>;
}

/** Health check debounce interval in milliseconds. */
const HEALTH_CHECK_DEBOUNCE_MS = 30_000;

/**
 * Concrete implementation of the Sandbox interface.
 */
export class ManagedSandbox implements Sandbox {
  readonly id: string;
  readonly scope: SandboxScope;
  readonly config: SandboxConfig;
  private _workerId: string;
  readonly projectId: string;
  readonly sessionId?: string | undefined;
  private readonly _activeExecutionIds = new Set<string>();
  private _lastActivityAt = new Date();
  private _destroyed = false;

  private _env: ExecutionEnvironment | null = null;
  private _envPromise: Promise<ExecutionEnvironment> | null = null;
  private _lastHealthCheckAt = 0;

  constructor(config: SandboxConfig, workerId: string, projectId: string, sessionId?: string) {
    this.id = config.id ?? `sandbox-${randomUUID().slice(0, 8)}`;
    this.scope = config.scope ?? 'execution';
    this.config = config;
    this._workerId = workerId;
    this.projectId = projectId;
    this.sessionId = sessionId;
  }

  get workerId(): string {
    return this._workerId;
  }

  get activeExecutionIds(): ReadonlySet<string> {
    return this._activeExecutionIds;
  }

  get initialized(): boolean {
    return this._env !== null;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  async getEnvironment(): Promise<ExecutionEnvironment> {
    if (this._destroyed) {
      throw new Error(`Sandbox ${this.id} has been destroyed`);
    }

    this._lastActivityAt = new Date();

    // If environment exists, optionally health-check
    if (this._env) {
      await this._healthCheck();
      return this._env;
    }

    // Coalesce concurrent init calls
    if (this._envPromise) {
      return this._envPromise;
    }

    this._envPromise = this._initializeEnvironment();
    try {
      const env = await this._envPromise;
      this._env = env;
      return env;
    } catch (err) {
      this._envPromise = null;
      throw err;
    }
  }

  attachExecution(executionId: string): void {
    this._activeExecutionIds.add(executionId);
  }

  detachExecution(executionId: string): void {
    this._activeExecutionIds.delete(executionId);
  }

  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._env) {
      try {
        await this._env.destroy();
      } catch (err) {
        logger.warn(`Failed to destroy environment for sandbox ${this.id}`, {
          error: String(err),
        });
      }
      this._env = null;
      this._envPromise = null;
    }
  }

  async recreate(): Promise<void> {
    logger.info(`Recreating sandbox ${this.id}`);

    // Best-effort destroy old env
    if (this._env) {
      try {
        await this._env.destroy();
      } catch {
        // Container may already be gone
      }
    }

    this._env = null;
    this._envPromise = null;
    this._destroyed = false;
    this._lastHealthCheckAt = 0;

    // Next getEnvironment() call will re-initialize
  }

  /**
   * Create the execution environment based on config.
   */
  /**
   * Compute the default workspace directory for Docker.
   * Uses `POLOS_WORKSPACES_DIR/{projectId}/{sessionId || sandboxId}`.
   */
  private _getDefaultWorkspaceDir(): string {
    const base = process.env[WORKSPACES_DIR_ENV] ?? DEFAULT_WORKSPACES_DIR;
    const leaf = this.sessionId ?? this.id;
    return path.join(base, this.projectId, leaf);
  }

  private async _initializeEnvironment(): Promise<ExecutionEnvironment> {
    const envType = this.config.env ?? 'docker';

    switch (envType) {
      case 'docker': {
        const workspaceDir = this.config.docker?.workspaceDir ?? this._getDefaultWorkspaceDir();

        const dockerConfig = {
          image: 'node:20-slim',
          ...this.config.docker,
          workspaceDir,
        };

        // Ensure workspace directory exists on host before bind-mounting
        await fs.mkdir(workspaceDir, { recursive: true });

        const env = new DockerEnvironment(dockerConfig, this.config.exec?.maxOutputChars);

        // Build labels for lifecycle management and orphan detection
        const labels: Record<string, string> = {
          'polos.managed': 'true',
          'polos.sandbox-id': this.id,
          'polos.worker-id': this._workerId,
        };
        if (this.sessionId) {
          labels['polos.session-id'] = this.sessionId;
        }

        await env.initialize(labels);
        return env;
      }
      case 'local': {
        const localCwd = this.config.local?.cwd ?? this._getDefaultWorkspaceDir();
        await fs.mkdir(localCwd, { recursive: true });
        // Default pathRestriction to cwd; set to false to explicitly disable
        const pathRestriction =
          this.config.local?.pathRestriction === false
            ? undefined
            : (this.config.local?.pathRestriction ?? localCwd);
        const localConfig = { ...this.config.local, cwd: localCwd, pathRestriction };
        const env = new LocalEnvironment(localConfig, this.config.exec?.maxOutputChars);
        await env.initialize();
        return env;
      }
      case 'e2b':
        throw new Error('E2B environment is not yet implemented.');
      default:
        throw new Error(`Unknown environment type: ${String(envType)}`);
    }
  }

  /**
   * Health check with 30s debounce. Only probes Docker containers.
   */
  private async _healthCheck(): Promise<void> {
    if (!this._env) return;
    if (this._env.type !== 'docker') return;

    const now = Date.now();
    if (now - this._lastHealthCheckAt < HEALTH_CHECK_DEBOUNCE_MS) {
      return;
    }

    this._lastHealthCheckAt = now;

    try {
      await this._env.exec('true', { timeout: 5 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No such container') || msg.includes('is not running')) {
        logger.warn(`Container for sandbox ${this.id} is dead, recreating`, { error: msg });
        await this.recreate();
        // Re-initialize immediately so caller gets a working env
        await this.getEnvironment();
      }
      // Other errors (e.g., timeout) — don't recreate, let the actual tool call fail
    }
  }
}
