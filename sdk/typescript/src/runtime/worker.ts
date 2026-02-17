/**
 * Worker class for executing Polos workflows.
 *
 * The worker:
 * 1. Registers with the orchestrator (creates/replaces deployment)
 * 2. Registers all workflow definitions in deployment_workflows table
 * 3. Receives workflows via push mode and executes them
 */

import type { Workflow } from '../core/workflow.js';
import { isToolWorkflow, type ToolWorkflow } from '../core/tool.js';
import { isAgentWorkflow, type AgentWorkflow } from '../agents/agent.js';
import type { Channel } from '../channels/channel.js';
import { globalRegistry } from '../core/registry.js';
import { StepExecutionError } from '../core/step.js';
import type {
  RegisterWorkerRequest,
  QueueRegistration,
  ExecutionContext,
} from './orchestrator-types.js';
import {
  OrchestratorClient,
  OrchestratorApiError,
  type OrchestratorClientConfig,
} from './orchestrator-client.js';
import { WorkerServer, type WorkerExecutionData } from './worker-server.js';
import { executeWorkflow, serializeFinalState, type ExecutionResult } from './executor.js';
import { createLogger } from '../utils/logger.js';
import { initializeOtel } from '../features/tracing.js';
import { getModelId, getModelProvider } from '../llm/types.js';

const logger = createLogger({ name: 'worker' });

/**
 * Configuration for the Worker.
 */
export interface WorkerConfig {
  /** Polos orchestrator API URL */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Project ID */
  projectId: string;
  /** Deployment ID (unique identifier for this deployment) */
  deploymentId: string;
  /** Workflows to register and execute */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workflows?: Workflow<any, any, any>[] | undefined;
  /** Maximum concurrent workflow executions (default: 100) */
  maxConcurrentWorkflows?: number | undefined;
  /** Worker server URL for push mode (default: http://localhost:8000) */
  workerServerUrl?: string | undefined;
  /** Port for the worker server (default: 8000) */
  port?: number | undefined;
  /** Whether running in local mode (binds to 127.0.0.1) */
  localMode?: boolean | undefined;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number | undefined;
  /** Default notification channels for suspend events (e.g., Slack, Discord) */
  channels?: Channel[] | undefined;
}

/**
 * Worker state.
 */
type WorkerState = 'stopped' | 'starting' | 'running' | 'stopping';

/**
 * Worker for executing Polos workflows.
 *
 * @example
 * ```typescript
 * import { Worker, defineWorkflow } from '@polos/sdk';
 * import { z } from 'zod';
 *
 * const myWorkflow = defineWorkflow({
 *   id: 'my-workflow',
 *   payloadSchema: z.object({ message: z.string() }),
 * }, async (ctx, payload) => {
 *   return { received: payload.message };
 * });
 *
 * const worker = new Worker({
 *   apiUrl: 'http://localhost:8080',
 *   apiKey: process.env.POLOS_API_KEY!,
 *   projectId: 'my-project',
 *   deploymentId: 'my-deployment',
 *   workflows: [myWorkflow],
 * });
 *
 * await worker.run();
 * ```
 */
export class Worker {
  private readonly config: WorkerConfig;
  private readonly orchestratorClient: OrchestratorClient;
  private readonly workflowRegistry = new Map<string, Workflow>();
  private readonly channels: Channel[];
  private readonly maxConcurrentWorkflows: number;
  private readonly workerServerUrl: string;
  private readonly port: number;

  private workerId: string | null = null;
  private workerServer: WorkerServer | null = null;
  private state: WorkerState = 'stopped';
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private activeExecutions = new Map<string, { abortController: AbortController }>();
  private signalHandler: (() => void) | null = null;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.channels = config.channels ?? [];
    this.maxConcurrentWorkflows = config.maxConcurrentWorkflows ?? 100;
    this.workerServerUrl =
      config.workerServerUrl ?? `http://localhost:${String(config.port ?? 8000)}`;
    this.port = config.port ?? 8000;

    // Create orchestrator client
    const clientConfig: OrchestratorClientConfig = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      projectId: config.projectId,
      timeout: config.timeout,
    };
    this.orchestratorClient = new OrchestratorClient(clientConfig);

    // Register workflows
    if (config.workflows) {
      for (const workflow of config.workflows) {
        this.workflowRegistry.set(workflow.id, workflow);
      }
    }
  }

  /**
   * Get the worker ID (assigned by orchestrator after registration).
   */
  getWorkerId(): string | null {
    return this.workerId;
  }

  /**
   * Get the worker ID, throwing if not registered.
   */
  private getWorkerIdOrThrow(): string {
    if (!this.workerId) {
      throw new Error('Worker not registered');
    }
    return this.workerId;
  }

  /**
   * Get the current worker state.
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get registered workflow IDs.
   */
  getWorkflowIds(): string[] {
    return Array.from(this.workflowRegistry.keys());
  }

  /**
   * Run the worker (blocks until shutdown).
   */
  async run(): Promise<void> {
    if (this.state !== 'stopped') {
      throw new Error(`Cannot start worker: current state is ${this.state}`);
    }

    this.state = 'starting';

    try {
      logger.info('Starting worker...');
      logger.info(`Deployment ID: ${this.config.deploymentId}`);
      logger.info(`Orchestrator: ${this.config.apiUrl}`);
      logger.info(`Workflows: ${Array.from(this.workflowRegistry.keys()).join(', ')}`);

      // Initialize OpenTelemetry tracing
      initializeOtel({
        apiUrl: this.config.apiUrl,
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
      });

      // Step 1: Register worker with orchestrator
      await this.register();

      // Step 2: Register deployment
      await this.registerDeployment();

      // Step 3: Register agents, tools, and workflows
      await this.registerAgents();
      await this.registerTools();
      await this.registerWorkflows();

      // Step 4: Register queues (non-fatal)
      try {
        await this.registerQueues();
      } catch (error) {
        logger.warn('Failed to register queues', { error: String(error) });
      }

      // Step 5: Mark worker as online (non-fatal)
      try {
        await this.markOnline();
      } catch (error) {
        logger.warn('Failed to mark worker as online', { error: String(error) });
      }

      // Step 6: Setup worker server
      await this.setupWorkerServer();

      // Step 7: Start heartbeat loop
      this.startHeartbeat();

      this.state = 'running';
      logger.info('Worker is running');

      // Register signal handlers for graceful shutdown
      const signalHandler = (): void => {
        void this.shutdown();
      };
      process.on('SIGINT', signalHandler);
      process.on('SIGTERM', signalHandler);
      this.signalHandler = signalHandler;

      // Keep running until shutdown is called
      await new Promise<void>((resolve) => {
        const checkState = (): void => {
          if (this.state === 'stopping' || this.state === 'stopped') {
            resolve();
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });
    } catch (error) {
      this.state = 'stopped';
      logger.error('Failed to start worker', { error: String(error) });
      throw error;
    }
  }

  /**
   * Gracefully shutdown the worker.
   */
  async shutdown(): Promise<void> {
    if (this.state !== 'running') {
      logger.warn(`Cannot shutdown worker: current state is ${this.state}`);
      return;
    }

    this.state = 'stopping';
    logger.info('Shutting down worker...');

    // Remove signal handlers
    if (this.signalHandler) {
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
      this.signalHandler = null;
    }

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Cancel all active executions
    for (const [executionId, execution] of this.activeExecutions) {
      logger.info(`Cancelling execution: ${executionId}`);
      execution.abortController.abort();
    }

    // Wait for executions to complete (with timeout)
    const waitTimeout = 30000; // 30 seconds
    const waitStart = Date.now();
    while (this.activeExecutions.size > 0 && Date.now() - waitStart < waitTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.activeExecutions.size > 0) {
      logger.warn(`${String(this.activeExecutions.size)} executions did not complete in time`);
    }

    // Stop worker server
    if (this.workerServer) {
      await this.workerServer.stop();
      this.workerServer = null;
    }

    this.state = 'stopped';
    logger.info('Worker shutdown complete');
  }

  /**
   * Register worker with orchestrator.
   */
  private async register(): Promise<void> {
    logger.info('Registering worker with orchestrator...');

    const request: RegisterWorkerRequest = {
      deploymentId: this.config.deploymentId,
      projectId: this.config.projectId,
      mode: 'push',
      capabilities: {
        runtime: 'typescript',
        agentIds: this.getAgentIds(),
        toolIds: this.getToolIds(),
        workflowIds: Array.from(this.workflowRegistry.keys()),
      },
      maxConcurrentExecutions: this.maxConcurrentWorkflows,
      pushEndpointUrl: this.workerServerUrl,
    };

    const response = await this.orchestratorClient.registerWorker(request);
    this.workerId = response.worker_id;

    logger.info(`Registered worker: ${this.workerId}`);
  }

  /**
   * Register deployment with orchestrator.
   */
  private async registerDeployment(): Promise<void> {
    logger.info('Registering deployment...');

    await this.orchestratorClient.registerDeployment({
      deploymentId: this.config.deploymentId,
    });

    logger.info(`Deployment registered: ${this.config.deploymentId}`);
  }

  /**
   * Get agent IDs from registered workflows.
   */
  private getAgentIds(): string[] {
    const agentIds: string[] = [];
    for (const workflow of this.workflowRegistry.values()) {
      if (isAgentWorkflow(workflow)) {
        agentIds.push(workflow.id);
      }
    }
    return agentIds;
  }

  /**
   * Get tool IDs from registered workflows.
   */
  private getToolIds(): string[] {
    const toolIds: string[] = [];
    for (const workflow of this.workflowRegistry.values()) {
      if (isToolWorkflow(workflow)) {
        toolIds.push(workflow.id);
      }
    }
    return toolIds;
  }

  /**
   * Register agent definitions with orchestrator.
   */
  private async registerAgents(): Promise<void> {
    const agents: AgentWorkflow[] = [];
    for (const workflow of this.workflowRegistry.values()) {
      if (isAgentWorkflow(workflow)) {
        agents.push(workflow);
      }
    }

    if (agents.length === 0) {
      return;
    }

    logger.info(`Registering ${String(agents.length)} agent(s)...`);

    for (const agent of agents) {
      // Build tool definitions for the agent
      const toolsJson = agent.tools.length > 0 ? agent.tools : undefined;

      // Build metadata
      const metadata: Record<string, unknown> = {};

      // Add stop condition function names
      if (agent.stopConditions.length > 0) {
        const stopConditionNames: string[] = [];
        for (const sc of agent.stopConditions) {
          if (sc.__stop_condition_name__) {
            stopConditionNames.push(sc.__stop_condition_name__);
          } else if (sc.name) {
            stopConditionNames.push(sc.name);
          } else {
            stopConditionNames.push('anonymous');
          }
        }
        metadata['stop_conditions'] = stopConditionNames;
      }

      // Add guardrail info
      if (agent.guardrails.length > 0) {
        const guardrailInfo: { type: string; name: string }[] = [];
        for (const gr of agent.guardrails) {
          const name = gr.name ?? 'anonymous';
          guardrailInfo.push({ type: 'function', name });
        }
        metadata['guardrails'] = guardrailInfo;
      }

      // Register agent definition with orchestrator
      await this.orchestratorClient.registerAgent({
        id: agent.id,
        deploymentId: this.config.deploymentId,
        provider: getModelProvider(agent.llm.model),
        model: getModelId(agent.llm.model),
        systemPrompt: agent.agentConfig.systemPrompt,
        tools: toolsJson,
        temperature: agent.agentConfig.temperature,
        maxOutputTokens: agent.agentConfig.maxOutputTokens,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      });

      // Register in deployment_workflows
      await this.orchestratorClient.registerDeploymentWorkflow(this.config.deploymentId, {
        workflowId: agent.id,
        workflowType: 'agent',
      });

      logger.debug(`Registered agent: ${agent.id}`);
    }

    logger.info('Agents registered');
  }

  /**
   * Register tool definitions with orchestrator.
   */
  private async registerTools(): Promise<void> {
    const tools: ToolWorkflow[] = [];
    for (const workflow of this.workflowRegistry.values()) {
      if (isToolWorkflow(workflow)) {
        tools.push(workflow);
      }
    }

    if (tools.length === 0) {
      return;
    }

    logger.info(`Registering ${String(tools.length)} tool(s)...`);

    for (const tool of tools) {
      await this.orchestratorClient.registerTool({
        id: tool.id,
        deploymentId: this.config.deploymentId,
        toolType: tool.getToolType(),
        description: tool.toolDescription,
        parameters: tool.toolParameters,
        metadata: tool.getToolMetadata(),
      });

      // Register in deployment_workflows
      await this.orchestratorClient.registerDeploymentWorkflow(this.config.deploymentId, {
        workflowId: tool.id,
        workflowType: 'tool',
      });

      logger.debug(`Registered tool: ${tool.id} (type: ${tool.getToolType()})`);
    }

    logger.info('Tools registered');
  }

  /**
   * Register workflows with orchestrator.
   */
  private async registerWorkflows(): Promise<void> {
    // Filter to pure workflows only (not agents or tools)
    const pureWorkflows: Workflow[] = [];
    for (const workflow of this.workflowRegistry.values()) {
      if (!isAgentWorkflow(workflow) && !isToolWorkflow(workflow)) {
        pureWorkflows.push(workflow);
      }
    }

    if (pureWorkflows.length === 0) {
      logger.info('No workflows to register');
      return;
    }

    logger.info(`Registering ${String(pureWorkflows.length)} workflow(s)...`);

    for (const workflow of pureWorkflows) {
      const config = workflow.config;

      await this.orchestratorClient.registerDeploymentWorkflow(this.config.deploymentId, {
        workflowId: workflow.id,
        workflowType: 'workflow',
        triggerOnEvent: config.triggerOnEvent !== undefined ? true : undefined,
        scheduled: config.schedule !== undefined ? true : undefined,
      });

      logger.debug(`Registered workflow: ${workflow.id}`);
    }

    logger.info('Workflows registered');
  }

  /**
   * Helper to extract queue name and concurrency limit from a workflow config.
   */
  private getQueueInfo(workflow: Workflow): {
    queueName: string;
    concurrencyLimit: number | undefined;
  } {
    const config = workflow.config;
    let queueName: string;
    let concurrencyLimit: number | undefined;

    if (typeof config.queue === 'string') {
      queueName = config.queue;
    } else if (config.queue) {
      queueName = config.queue.name;
      concurrencyLimit = config.queue.concurrencyLimit;
    } else {
      queueName = workflow.id;
    }

    return { queueName, concurrencyLimit };
  }

  /**
   * Helper to merge a queue into the queues map with most-restrictive concurrency.
   */
  private mergeQueue(
    queues: Map<string, number | undefined>,
    queueName: string,
    concurrencyLimit: number | undefined
  ): void {
    if (queues.has(queueName)) {
      const existing = queues.get(queueName);
      if (concurrencyLimit !== undefined && existing !== undefined) {
        queues.set(queueName, Math.min(existing, concurrencyLimit));
      } else if (concurrencyLimit !== undefined) {
        queues.set(queueName, concurrencyLimit);
      }
    } else {
      queues.set(queueName, concurrencyLimit);
    }
  }

  /**
   * Register queues with orchestrator.
   */
  private async registerQueues(): Promise<void> {
    const queues = new Map<string, number | undefined>();

    // Collect from pure workflows (skip scheduled, skip agents/tools)
    for (const workflow of this.workflowRegistry.values()) {
      if (isAgentWorkflow(workflow) || isToolWorkflow(workflow)) {
        continue;
      }

      // Skip scheduled workflows — they get their own queues registered separately
      const config = workflow.config;
      const isSchedulable = config.schedule !== undefined;
      if (isSchedulable) {
        continue;
      }

      const { queueName, concurrencyLimit } = this.getQueueInfo(workflow);
      this.mergeQueue(queues, queueName, concurrencyLimit);
    }

    // Collect from agents
    for (const workflow of this.workflowRegistry.values()) {
      if (!isAgentWorkflow(workflow)) {
        continue;
      }
      const { queueName, concurrencyLimit } = this.getQueueInfo(workflow);
      this.mergeQueue(queues, queueName, concurrencyLimit);
    }

    // Collect from tools
    for (const workflow of this.workflowRegistry.values()) {
      if (!isToolWorkflow(workflow)) {
        continue;
      }
      const { queueName, concurrencyLimit } = this.getQueueInfo(workflow);
      this.mergeQueue(queues, queueName, concurrencyLimit);
    }

    if (queues.size === 0) {
      logger.info('No queues to register');
      return;
    }

    const queueList: QueueRegistration[] = Array.from(queues.entries()).map(
      ([name, concurrencyLimit]) => ({
        name,
        concurrencyLimit,
      })
    );

    await this.orchestratorClient.registerQueues({
      deploymentId: this.config.deploymentId,
      queues: queueList,
    });

    logger.info(`Registered ${String(queues.size)} queue(s)`);
  }

  /**
   * Mark worker as online.
   */
  private async markOnline(): Promise<void> {
    if (!this.workerId) {
      throw new Error('Worker not registered');
    }

    await this.orchestratorClient.markOnline(this.workerId);
    logger.info('Worker marked as online');
  }

  /**
   * Setup worker server for push mode.
   */
  private async setupWorkerServer(): Promise<void> {
    if (!this.workerId) {
      throw new Error('Worker not registered');
    }

    this.workerServer = new WorkerServer({
      workerId: this.workerId,
      maxConcurrentWorkflows: this.maxConcurrentWorkflows,
      onWorkReceived: (data) => this.handleWorkReceived(data),
      onCancelRequested: (executionId) => this.handleCancelRequested(executionId),
      port: this.port,
      localMode: this.config.localMode,
    });

    await this.workerServer.start();
  }

  /**
   * Start heartbeat loop.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      void this.sendHeartbeat();
    }, 30000); // 30 seconds
  }

  /**
   * Send heartbeat to orchestrator.
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.workerId) {
      return;
    }

    try {
      const response = await this.orchestratorClient.sendHeartbeat(this.workerId);

      if (response.re_register) {
        logger.info('Orchestrator requested re-registration');
        await this.reRegister();
      }
    } catch (error) {
      logger.warn('Heartbeat failed', { error: String(error) });
    }
  }

  /**
   * Re-register worker, deployment, workflows, and queues.
   */
  private async reRegister(): Promise<void> {
    try {
      await this.register();
      await this.registerDeployment();
      await this.registerAgents();
      await this.registerTools();
      await this.registerWorkflows();
      await this.registerQueues();
      await this.markOnline();

      // Update worker server with new worker ID
      if (this.workerServer && this.workerId) {
        this.workerServer.updateWorkerId(this.workerId);
      }

      logger.info('Re-registration complete');
    } catch (error) {
      logger.error('Re-registration failed', { error: String(error) });
    }
  }

  /**
   * Handle work received from orchestrator.
   */
  private async handleWorkReceived(data: WorkerExecutionData): Promise<void> {
    const { executionId, workflowId } = data;

    // Find workflow (check local registry first, then global registry)
    let workflow = this.workflowRegistry.get(workflowId);
    if (!workflow && globalRegistry.has(workflowId)) {
      workflow = globalRegistry.get(workflowId);
    }
    if (!workflow) {
      logger.error(`Workflow not found: ${workflowId}`);
      await this.reportFailure(executionId, `Workflow not found: ${workflowId}`, false);
      return;
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, { abortController });

    // Enforce per-execution timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (data.runTimeoutSeconds) {
      timeoutId = setTimeout(() => {
        logger.warn(`Execution ${executionId} timed out after ${String(data.runTimeoutSeconds)}s`);
        abortController.abort();
      }, data.runTimeoutSeconds * 1000);
    }

    try {
      // Build execution context
      const context: ExecutionContext = {
        executionId,
        deploymentId: data.deploymentId,
        parentExecutionId: data.parentExecutionId,
        rootExecutionId: data.rootExecutionId,
        rootWorkflowId: data.rootWorkflowId,
        retryCount: data.retryCount,
        sessionId: data.sessionId,
        userId: data.userId,
        otelTraceparent: data.otelTraceparent,
        otelSpanId: data.otelSpanId,
        initialState: data.initialState,
        runTimeoutSeconds: data.runTimeoutSeconds,
        createdAt: data.createdAt,
      };

      // Execute workflow
      const result = await executeWorkflow({
        workflow,
        payload: data.payload,
        context,
        orchestratorClient: this.orchestratorClient,
        workerId: this.getWorkerIdOrThrow(),
        abortSignal: abortController.signal,
        channels: this.channels,
      });

      // Handle result
      await this.handleExecutionResult(executionId, workflowId, context, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      // StepExecutionError and "tool" workflows are not retryable
      const retryable =
        !(error instanceof StepExecutionError) && workflow.config.workflowType !== 'tool';

      logger.error(`Execution failed: ${executionId}`, { error: errorMessage, stack });
      await this.reportFailure(executionId, errorMessage, retryable, stack);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Handle execution result.
   */
  private async handleExecutionResult(
    executionId: string,
    workflowId: string,
    context: ExecutionContext,
    result: ExecutionResult
  ): Promise<void> {
    if (result.success) {
      await this.reportSuccess(executionId, result.result, result.finalState);
    } else if (result.waiting) {
      // Workflow is waiting (WaitError) - don't report as failure
      logger.debug(`Execution ${executionId} is waiting: ${result.error ?? 'unknown'}`);
    } else if (result.error === 'Execution cancelled') {
      await this.emitCancellationEvent(executionId, workflowId, context);
      await this.confirmCancellation(executionId);
    } else {
      await this.reportFailure(
        executionId,
        result.error ?? 'Unknown error',
        result.retryable ?? true,
        result.stack,
        result.finalState
      );
    }
  }

  /**
   * Handle cancel request from orchestrator.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires async
  private async handleCancelRequested(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.abortController.abort();
      return true;
    }
    return false;
  }

  /**
   * Report successful execution.
   */
  private async reportSuccess(
    executionId: string,
    result: unknown,
    finalState?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.orchestratorClient.completeExecution(executionId, {
        result,
        workerId: this.getWorkerIdOrThrow(),
        finalState: finalState
          ? (JSON.parse(serializeFinalState(finalState)) as Record<string, unknown>)
          : undefined,
      });
      logger.debug(`Reported success: ${executionId}`);
    } catch (error) {
      if (error instanceof OrchestratorApiError && error.statusCode === 409) {
        logger.debug(`Execution ${executionId} was reassigned, ignoring completion`);
        return;
      }
      logger.error(`Failed to report success: ${executionId}`, { error: String(error) });
    }
  }

  /**
   * Report failed execution.
   */
  private async reportFailure(
    executionId: string,
    error: string,
    retryable: boolean,
    stack?: string,
    finalState?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.orchestratorClient.failExecution(executionId, {
        error,
        workerId: this.getWorkerIdOrThrow(),
        stack,
        retryable,
        finalState: finalState
          ? (JSON.parse(serializeFinalState(finalState)) as Record<string, unknown>)
          : undefined,
      });
      logger.debug(`Reported failure: ${executionId}`);
    } catch (err) {
      if (err instanceof OrchestratorApiError && err.statusCode === 409) {
        logger.debug(`Execution ${executionId} was reassigned, ignoring failure report`);
        return;
      }
      logger.error(`Failed to report failure: ${executionId}`, { error: String(err) });
    }
  }

  /**
   * Emit a cancellation event so UI/streaming clients are notified.
   */
  private async emitCancellationEvent(
    executionId: string,
    workflowId: string,
    context: ExecutionContext
  ): Promise<void> {
    try {
      const rootExecutionId = context.rootExecutionId ?? executionId;
      const rootWorkflowId = context.rootWorkflowId ?? workflowId;
      const topic = `workflow/${rootWorkflowId}/${rootExecutionId}`;
      await this.orchestratorClient.publishEvent({
        topic,
        events: [
          {
            eventType: 'workflow_cancel',
            data: { _metadata: { execution_id: executionId, workflow_id: workflowId } },
          },
        ],
        executionId,
        rootExecutionId: context.rootExecutionId,
      });
    } catch (error) {
      logger.error(`Failed to emit cancellation event for ${executionId}`, {
        error: String(error),
      });
    }
  }

  /**
   * Confirm cancellation.
   */
  private async confirmCancellation(executionId: string): Promise<void> {
    try {
      await this.orchestratorClient.confirmCancellation(executionId, {
        workerId: this.getWorkerIdOrThrow(),
      });
      logger.debug(`Confirmed cancellation: ${executionId}`);
    } catch (error) {
      if (error instanceof OrchestratorApiError && error.statusCode === 409) {
        logger.debug(`Execution ${executionId} was reassigned, ignoring cancellation confirmation`);
        return;
      }
      logger.error(`Failed to confirm cancellation: ${executionId}`, { error: String(error) });
    }
  }
}
