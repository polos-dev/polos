/**
 * SandboxManager — manages sandbox creation, reuse, auto-cleanup,
 * and orphan detection. Lives on the Worker.
 */

import { spawn } from 'node:child_process';
import type { SandboxConfig } from './types.js';
import { ManagedSandbox, type Sandbox } from './sandbox.js';
import { createLogger } from '../utils/logger.js';
import type { OrchestratorClient } from '../runtime/orchestrator-client.js';

const logger = createLogger({ name: 'sandbox-manager' });

/** Default idle sweep interval: 10 minutes. */
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** Default idle destroy timeout: 1 hour. */
const DEFAULT_IDLE_TIMEOUT = '1h';

/** Grace period before removing orphan containers (30 minutes). */
const ORPHAN_GRACE_PERIOD_MS = 30 * 60 * 1000;

/**
 * Parse a human-readable duration string to milliseconds.
 * Supports: '30m', '1h', '24h', '3d', '7d'.
 */
export function parseDuration(str: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/.exec(str.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${str}". Expected format: "1h", "24h", "3d", etc.`);
  }
  const value = parseFloat(match[1] ?? '0');
  const unit = match[2] ?? 'h';

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: "${unit}"`);
  }
}

/**
 * Manages sandbox lifecycle across executions.
 */
export class SandboxManager {
  private _workerId: string;
  private _projectId: string;
  private readonly _orchestratorClient: OrchestratorClient | undefined;
  private readonly sandboxes = new Map<string, ManagedSandbox>();
  private readonly sessionSandboxes = new Map<string, ManagedSandbox>();
  private readonly sessionCreationLocks = new Map<string, Promise<Sandbox>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(workerId: string, projectId: string, orchestratorClient?: OrchestratorClient) {
    this._workerId = workerId;
    this._projectId = projectId;
    this._orchestratorClient = orchestratorClient;
  }

  /**
   * Update the worker ID (called after registration or re-registration).
   */
  setWorkerId(workerId: string): void {
    this._workerId = workerId;
  }

  /**
   * Create or retrieve a sandbox.
   *
   * - Session-scoped: returns existing sandbox for the session if available.
   * - Execution-scoped: always creates a new sandbox.
   */
  async getOrCreateSandbox(
    config: SandboxConfig,
    ctx: { executionId: string; sessionId?: string | undefined }
  ): Promise<Sandbox> {
    const scope = config.scope ?? 'execution';

    if (scope === 'session') {
      if (!ctx.sessionId) {
        throw new Error('sessionId is required for session-scoped sandboxes');
      }

      // Check for existing sandbox
      const existing = this.sessionSandboxes.get(ctx.sessionId);
      if (existing && !existing.destroyed) {
        existing.attachExecution(ctx.executionId);
        return existing;
      }

      // Serialize concurrent creation for the same session
      const existingLock = this.sessionCreationLocks.get(ctx.sessionId);
      if (existingLock) {
        const sandbox = await existingLock;
        sandbox.attachExecution(ctx.executionId);
        return sandbox;
      }

      // Register the lock as an unresolved promise BEFORE starting creation.
      // This ensures a concurrent caller arriving between here and the resolve
      // will find the lock and wait, even if _createSessionSandbox becomes async.
      let resolveLock!: (value: Sandbox) => void;
      let rejectLock!: (reason: unknown) => void;
      const lockPromise = new Promise<Sandbox>((resolve, reject) => {
        resolveLock = resolve;
        rejectLock = reject;
      });
      this.sessionCreationLocks.set(ctx.sessionId, lockPromise);

      try {
        const sandbox = this._createSessionSandbox(config, ctx.executionId, ctx.sessionId);
        resolveLock(sandbox);
        return sandbox;
      } catch (err) {
        rejectLock(err);
        throw err;
      } finally {
        this.sessionCreationLocks.delete(ctx.sessionId);
      }
    }

    // Execution-scoped: always new
    return this._createExecutionSandbox(config, ctx.executionId);
  }

  /**
   * Notify that an execution completed. Triggers cleanup for execution-scoped sandboxes.
   */
  async onExecutionComplete(executionId: string): Promise<void> {
    for (const [sandboxId, sandbox] of this.sandboxes) {
      if (!sandbox.activeExecutionIds.has(executionId)) continue;

      sandbox.detachExecution(executionId);

      // Execution-scoped sandboxes are 1:1 with executions — destroy immediately.
      // Session-scoped sandboxes survive; they're cleaned up by the idle sweep.
      if (sandbox.scope === 'execution') {
        await this._destroyAndRemove(sandboxId, sandbox);
      }
    }
  }

  /**
   * Destroy a specific sandbox by ID.
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      await this._destroyAndRemove(sandboxId, sandbox);
    }
  }

  /**
   * Destroy all managed sandboxes. Called during worker shutdown.
   */
  async destroyAll(): Promise<void> {
    const entries = Array.from(this.sandboxes.entries());
    await Promise.allSettled(
      entries.map(async ([id, sandbox]) => {
        try {
          await sandbox.destroy();
        } catch (err) {
          logger.warn(`Failed to destroy sandbox ${id}`, { error: String(err) });
        }
      })
    );
    this.sandboxes.clear();
    this.sessionSandboxes.clear();
  }

  /**
   * Start periodic sweep. Each cycle:
   * 1. Destroys own sandboxes idle past their idleDestroyTimeout.
   * 2. Removes orphan Docker containers from dead workers (orchestrator-based).
   */
  startSweep(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
    this.stopSweep();
    this.sweepTimer = setInterval(() => {
      void this._sweep();
    }, intervalMs);
    // Don't keep process alive just for the sweep
    this.sweepTimer.unref();
  }

  /**
   * Stop the periodic sweep.
   */
  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Lookup a sandbox by ID.
   */
  getSandbox(sandboxId: string): Sandbox | undefined {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * Lookup a session sandbox by session ID.
   */
  getSessionSandbox(sessionId: string): Sandbox | undefined {
    return this.sessionSandboxes.get(sessionId);
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private _createExecutionSandbox(config: SandboxConfig, executionId: string): Sandbox {
    const sandbox = new ManagedSandbox(config, this._workerId, this._projectId);
    sandbox.attachExecution(executionId);
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  private _createSessionSandbox(
    config: SandboxConfig,
    executionId: string,
    sessionId: string
  ): Sandbox {
    const sandbox = new ManagedSandbox(config, this._workerId, this._projectId, sessionId);
    sandbox.attachExecution(executionId);
    this.sandboxes.set(sandbox.id, sandbox);
    this.sessionSandboxes.set(sessionId, sandbox);
    return sandbox;
  }

  private async _destroyAndRemove(sandboxId: string, sandbox: ManagedSandbox): Promise<void> {
    await sandbox.destroy();
    this.sandboxes.delete(sandboxId);

    if (sandbox.sessionId) {
      const current = this.sessionSandboxes.get(sandbox.sessionId);
      if (current === sandbox) {
        this.sessionSandboxes.delete(sandbox.sessionId);
      }
    }
  }

  /**
   * Unified sweep: Phase 1 cleans own idle sandboxes, Phase 2 cleans orphan containers.
   */
  private async _sweep(): Promise<void> {
    // Phase 1: Sweep own idle sandboxes (in-memory lastActivityAt)
    await this._sweepIdleSandboxes();

    // Phase 2: Sweep orphan containers from dead workers
    await this._sweepOrphanContainers();
  }

  /**
   * Phase 1: Destroy own sandboxes that have been idle past their timeout.
   */
  private async _sweepIdleSandboxes(): Promise<void> {
    const now = Date.now();

    for (const [sandboxId, sandbox] of this.sandboxes) {
      // Use lastActivityAt as the sole signal. It's updated on every
      // getEnvironment() call (i.e., every tool invocation). If nothing has
      // touched this sandbox for longer than the timeout, it's dead —
      // regardless of scope or what activeExecutionIds claims.
      //
      // This handles two failure modes:
      // 1. Execution-scoped sandboxes orphaned by crashes (onExecutionComplete never called)
      // 2. Stale activeExecutionIds from executions that crashed without detaching
      const timeoutStr = sandbox.config.idleDestroyTimeout ?? DEFAULT_IDLE_TIMEOUT;
      const timeoutMs = parseDuration(timeoutStr);
      const idleMs = now - sandbox.lastActivityAt.getTime();

      if (idleMs > timeoutMs) {
        logger.info(
          `Destroying idle sandbox ${sandboxId} (scope=${sandbox.scope}, ` +
            `session=${sandbox.sessionId ?? 'none'}, idle ${String(Math.round(idleMs / 1000))}s)`
        );
        try {
          await this._destroyAndRemove(sandboxId, sandbox);
        } catch (err) {
          logger.warn(`Failed to destroy idle sandbox ${sandboxId}`, { error: String(err) });
        }
      }
    }
  }

  /**
   * Phase 2: Remove Docker containers from dead workers.
   *
   * Queries the orchestrator for active worker IDs, lists all polos-managed
   * Docker containers, and removes any whose worker-id is not in the active set
   * AND whose age exceeds ORPHAN_GRACE_PERIOD_MS.
   *
   * If the orchestrator is unavailable, this phase is skipped entirely.
   */
  private async _sweepOrphanContainers(): Promise<void> {
    if (!this._orchestratorClient) return;

    let activeWorkerIds: Set<string>;
    try {
      const ids = await this._orchestratorClient.getActiveWorkerIds();
      activeWorkerIds = new Set(ids);
    } catch (err) {
      logger.warn('Failed to query active workers, skipping orphan cleanup', {
        error: String(err),
      });
      return;
    }

    try {
      const result = await spawnSimple('docker', [
        'ps',
        '-a',
        '--filter',
        'label=polos.managed=true',
        '--format',
        '{{.Names}}\t{{.Label "polos.worker-id"}}\t{{.CreatedAt}}',
      ]);

      if (result.exitCode !== 0 || !result.stdout.trim()) return;

      const now = Date.now();
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const [name, workerId, createdAt] = line.split('\t');
        if (!name || !workerId) continue;

        // Skip containers belonging to active workers
        if (activeWorkerIds.has(workerId)) continue;

        // Skip containers younger than the grace period to avoid TOCTOU races
        const containerAge = now - new Date(createdAt ?? '').getTime();
        if (isNaN(containerAge) || containerAge < ORPHAN_GRACE_PERIOD_MS) continue;

        logger.info(`Removing orphaned container: ${name} (worker: ${workerId})`);
        try {
          await spawnSimple('docker', ['rm', '-f', name]);
        } catch (err) {
          logger.warn(`Failed to remove orphaned container ${name}`, { error: String(err) });
        }
      }
    } catch (err) {
      logger.warn('Failed to sweep orphan containers', { error: String(err) });
    }
  }
}

/**
 * Simple spawn helper for manager-level docker commands.
 */
function spawnSimple(
  command: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    proc.on('error', reject);
  });
}
