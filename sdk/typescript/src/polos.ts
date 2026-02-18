/**
 * Unified Polos class that combines PolosClient (submit/stream work) and Worker
 * (receive/execute work) into a single object.
 */

import {
  PolosClient,
  type EventsApi,
  type SchedulesApi,
  type ClientInvokeOptions,
  type ClientBatchWorkflowInput,
} from './client.js';
import { Worker } from './runtime/worker.js';
import type { Workflow, WorkflowRunClient } from './core/workflow.js';
import type { Channel } from './channels/channel.js';
import { globalRegistry } from './core/registry.js';
import type { ExecutionHandle } from './execution-handle.js';
import type { GetExecutionResponse } from './runtime/orchestrator-types.js';
import { createLogger, configureLogging } from './utils/logger.js';

const logger = createLogger({ name: 'polos' });

/**
 * Configuration for the unified Polos class.
 * All fields are optional — defaults come from environment variables.
 */
export interface PolosConfig {
  /** Project ID (default: POLOS_PROJECT_ID env var) */
  projectId?: string | undefined;
  /** Orchestrator API URL (default: POLOS_API_URL or http://localhost:8080) */
  apiUrl?: string | undefined;
  /** API key (default: POLOS_API_KEY env var) */
  apiKey?: string | undefined;
  /** Deployment ID (default: POLOS_DEPLOYMENT_ID or "default") */
  deploymentId?: string | undefined;
  /** Worker server port (default: 8000) */
  port?: number | undefined;
  /** Maximum concurrent workflow executions */
  maxConcurrentWorkflows?: number | undefined;
  /** Notification channels for suspend events */
  channels?: Channel[] | undefined;
  /** Path to a log file. When set, SDK logs are written here instead of stdout. */
  logFile?: string | undefined;
}

/**
 * Unified Polos client + worker.
 *
 * @example
 * ```typescript
 * import { Polos, defineAgent } from '@polos/sdk';
 * import { openai } from '@ai-sdk/openai';
 *
 * const agent = defineAgent({
 *   id: 'weather',
 *   model: openai('gpt-4o'),
 *   systemPrompt: 'You are a weather assistant.',
 * });
 *
 * const polos = new Polos();
 * await polos.start();
 * const result = await agent.run(polos, { input: "What's the weather?" });
 * await polos.stop();
 * ```
 */
export class Polos implements WorkflowRunClient {
  private readonly client: PolosClient;
  private readonly worker: Worker;
  private started = false;
  private serverPromise: Promise<void> | null = null;

  /**
   * Events API for publishing and subscribing to events.
   */
  public readonly events: EventsApi;

  /**
   * Schedules API for managing workflow schedules.
   */
  public readonly schedules: SchedulesApi;

  constructor(config: PolosConfig = {}) {
    // Redirect SDK logs to file if requested
    if (config.logFile) {
      configureLogging({ file: config.logFile });
    }

    const projectId = config.projectId ?? process.env['POLOS_PROJECT_ID'] ?? '';
    const apiUrl = config.apiUrl ?? process.env['POLOS_API_URL'] ?? 'http://localhost:8080';
    const apiKey = config.apiKey ?? process.env['POLOS_API_KEY'] ?? '';
    const deploymentId = config.deploymentId ?? process.env['POLOS_DEPLOYMENT_ID'] ?? 'default';
    const port =
      config.port ??
      (process.env['POLOS_WORKER_PORT'] ? Number(process.env['POLOS_WORKER_PORT']) : 8000);

    // Create client
    this.client = new PolosClient({
      projectId,
      apiUrl,
      apiKey,
      deploymentId,
    });

    // Discover workflows from globalRegistry — they auto-register
    // when defined with defineAgent(), defineTool(), defineWorkflow().
    const workflows: Workflow[] = globalRegistry.getAll();

    // Create worker
    this.worker = new Worker({
      apiUrl,
      apiKey,
      projectId,
      deploymentId,
      workflows,
      maxConcurrentWorkflows: config.maxConcurrentWorkflows,
      port,
      localMode: true,
      channels: config.channels,
    });

    // Expose APIs from client
    this.events = this.client.events;
    this.schedules = this.client.schedules;
  }

  /**
   * Start the worker in background (non-blocking).
   *
   * Registers with orchestrator, starts worker server, begins heartbeat.
   * Returns once registration is complete so the caller can immediately
   * invoke workflows.
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    // Phase 1: register (blocking — must complete before we return)
    await this.worker.registerAll();
    this.started = true;

    // Phase 2: start server in background (non-blocking)
    this.serverPromise = this.worker.runServer().catch((err: unknown) => {
      logger.error('Worker server error', { error: String(err) });
    });

    logger.info('Polos started');
  }

  /**
   * Start the worker and block until shutdown signal (SIGINT/SIGTERM).
   *
   * This is the deployment mode — equivalent to Worker.run().
   * Use for servers, Kubernetes, Docker, etc.
   */
  async serve(): Promise<void> {
    await this.start();
    if (this.serverPromise) {
      await this.serverPromise;
    }
  }

  /**
   * Gracefully stop the worker and clean up.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.worker.shutdown();

    if (this.serverPromise) {
      // Wait for server to finish shutting down
      await this.serverPromise;
      this.serverPromise = null;
    }

    this.started = false;
    logger.info('Polos stopped');
  }

  /**
   * Get the underlying PolosClient.
   * Needed for APIs that require PolosClient explicitly (e.g., agent.stream()).
   */
  getClient(): PolosClient {
    return this.client;
  }

  // ── WorkflowRunClient interface ──

  /**
   * Invoke a workflow (fire and forget).
   */
  async invoke(
    workflow: string | Workflow,
    payload?: unknown,
    options?: ClientInvokeOptions
  ): Promise<ExecutionHandle> {
    return this.client.invoke(workflow, payload, options);
  }

  /**
   * Invoke multiple workflows in batch.
   */
  async batchInvoke(
    items: ClientBatchWorkflowInput[],
    options?: {
      sessionId?: string;
      userId?: string;
      parentExecutionId?: string;
      rootWorkflowId?: string;
      rootExecutionId?: string;
      stepKey?: string;
      waitForSubworkflow?: boolean;
    }
  ): Promise<ExecutionHandle[]> {
    return this.client.batchInvoke(items, options);
  }

  /**
   * Resume a suspended execution.
   */
  async resume(
    suspendWorkflowId: string,
    suspendExecutionId: string,
    suspendStepKey: string,
    data: unknown
  ): Promise<void> {
    return this.client.resume(suspendWorkflowId, suspendExecutionId, suspendStepKey, data);
  }

  /**
   * Get execution details.
   */
  async getExecution(executionId: string): Promise<GetExecutionResponse> {
    return this.client.getExecution(executionId);
  }

  /**
   * Cancel an execution.
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    return this.client.cancelExecution(executionId);
  }
}
