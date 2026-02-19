/**
 * Fastify server for push-based workers.
 *
 * Handles execution requests from the orchestrator in push mode.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ExecuteRequest } from './orchestrator-types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ name: 'worker-server' });

/**
 * Execution data passed to the work handler.
 */
export interface WorkerExecutionData {
  executionId: string;
  workflowId: string;
  deploymentId: string;
  payload: unknown;
  parentExecutionId?: string | undefined;
  rootExecutionId?: string | undefined;
  rootWorkflowId?: string | undefined;
  stepKey?: string | undefined;
  retryCount: number;
  createdAt?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  otelTraceparent?: string | undefined;
  otelSpanId?: string | undefined;
  initialState?: Record<string, unknown> | undefined;
  runTimeoutSeconds?: number | undefined;
  channelContext?: { channelId: string; source: Record<string, unknown> } | undefined;
}

/**
 * Callback for handling received work.
 */
export type OnWorkReceivedCallback = (data: WorkerExecutionData) => Promise<void>;

/**
 * Callback for handling cancel requests.
 * Returns true if execution was found and cancelled, false otherwise.
 */
export type OnCancelRequestedCallback = (executionId: string) => Promise<boolean>;

/**
 * Configuration for WorkerServer.
 */
export interface WorkerServerConfig {
  /** Worker ID (assigned by orchestrator) */
  workerId: string;
  /** Maximum concurrent workflows */
  maxConcurrentWorkflows: number;
  /** Callback when work is received from orchestrator */
  onWorkReceived: OnWorkReceivedCallback;
  /** Callback when cancel request is received */
  onCancelRequested?: OnCancelRequestedCallback | undefined;
  /** Port to listen on (default: 8000) */
  port?: number | undefined;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string | undefined;
  /** Whether running in local mode (binds to 127.0.0.1) */
  localMode?: boolean | undefined;
}

/**
 * Fastify server that receives pushed work from the orchestrator.
 */
export class WorkerServer {
  private readonly app: FastifyInstance;
  private workerId: string;
  private readonly maxConcurrentWorkflows: number;
  private readonly onWorkReceived: OnWorkReceivedCallback;
  private readonly onCancelRequested: OnCancelRequestedCallback | undefined;
  private readonly port: number;
  private readonly host: string;
  private currentExecutionCount = 0;

  constructor(config: WorkerServerConfig) {
    this.workerId = config.workerId;
    this.maxConcurrentWorkflows = config.maxConcurrentWorkflows;
    this.onWorkReceived = config.onWorkReceived;
    this.onCancelRequested = config.onCancelRequested;
    this.port = config.port ?? 8000;
    this.host = config.localMode ? '127.0.0.1' : (config.host ?? '0.0.0.0');

    this.app = Fastify({
      logger: false, // We use our own logger
    });

    this.setupRoutes();
  }

  /**
   * Update the worker ID (used when re-registering).
   */
  updateWorkerId(newWorkerId: string): void {
    this.workerId = newWorkerId;
  }

  /**
   * Get current execution count.
   */
  getCurrentExecutionCount(): number {
    return this.currentExecutionCount;
  }

  /**
   * Setup Fastify routes.
   */
  private setupRoutes(): void {
    // POST /execute - Receive pushed work from orchestrator
    this.app.post('/execute', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Check if worker is at capacity
        if (this.currentExecutionCount >= this.maxConcurrentWorkflows) {
          return await reply.status(429).send({ error: 'Worker at capacity' });
        }

        const body = request.body as ExecuteRequest;

        // Validate worker ID
        if (body.worker_id !== this.workerId) {
          return await reply.status(400).send({ error: 'Worker ID mismatch' });
        }

        // Extract execution data from flat body (matches orchestrator PushWorkRequest)
        const executionId = body.execution_id;
        const workflowId = body.workflow_id;
        const payload = body.payload;

        logger.info(
          `POST /execute - execution_id=${executionId}, worker_id=${this.workerId}, ` +
            `workflow_id=${workflowId}, root_execution_id=${String(body.root_execution_id)}, ` +
            `root_workflow_id=${String(body.root_workflow_id)}, step_key=${String(body.step_key)}, ` +
            `session_id=${String(body.session_id)}, user_id=${String(body.user_id)}, ` +
            `retry_count=${String(body.retry_count)}`
        );

        // Build execution data
        const executionData: WorkerExecutionData = {
          executionId,
          workflowId,
          deploymentId: body.deployment_id ?? '',
          payload,
          parentExecutionId: body.parent_execution_id ?? undefined,
          rootExecutionId: body.root_execution_id ?? undefined,
          rootWorkflowId: body.root_workflow_id ?? undefined,
          stepKey: body.step_key ?? undefined,
          retryCount: body.retry_count,
          createdAt: body.created_at ?? undefined,
          sessionId: body.session_id ?? undefined,
          userId: body.user_id ?? undefined,
          otelTraceparent: body.otel_traceparent ?? undefined,
          otelSpanId: body.otel_span_id ?? undefined,
          initialState: body.initial_state ?? undefined,
          runTimeoutSeconds: body.run_timeout_seconds ?? undefined,
          channelContext: body.channel_context
            ? {
                channelId: body.channel_context['channel_id'] as string,
                source: body.channel_context['source'] as Record<string, unknown>,
              }
            : undefined,
        };

        // Increment execution count
        this.currentExecutionCount++;

        // Execute in background (don't await)
        void this.executeWithCleanup(executionData);

        // Return 200 OK immediately (work accepted)
        return await reply.status(200).send({ status: 'accepted', execution_id: executionId });
      } catch (error) {
        logger.error('Error handling /execute', { error: String(error) });
        return await reply.status(503).send({ error: String(error) });
      }
    });

    // POST /cancel/:executionId - Handle cancellation request
    this.app.post<{ Params: { executionId: string } }>(
      '/cancel/:executionId',
      async (request: FastifyRequest<{ Params: { executionId: string } }>, reply: FastifyReply) => {
        try {
          const { executionId } = request.params;

          // Get worker_id from header
          const workerId = request.headers['x-worker-id'] as string | undefined;
          if (!workerId) {
            return await reply.status(400).send({ error: 'Missing Worker ID in request headers' });
          }

          if (workerId !== this.workerId) {
            return await reply.status(400).send({ error: 'Worker ID mismatch' });
          }

          logger.info(`POST /cancel/${executionId}`);

          // Trigger cancellation
          if (this.onCancelRequested) {
            const found = await this.onCancelRequested(executionId);
            if (found) {
              return await reply.status(200).send({
                status: 'cancellation_requested',
                execution_id: executionId,
              });
            } else {
              return await reply.status(404).send({
                error: 'Execution not found or already completed',
                execution_id: executionId,
              });
            }
          } else {
            return await reply.status(503).send({ error: 'Cancel handler not configured' });
          }
        } catch (error) {
          logger.error('Error handling /cancel', { error: String(error) });
          return await reply.status(500).send({ error: String(error) });
        }
      }
    );

    // GET /health - Health check endpoint
    this.app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        status: 'healthy',
        mode: 'push',
        current_executions: this.currentExecutionCount,
        max_concurrent_workflows: this.maxConcurrentWorkflows,
      });
    });
  }

  /**
   * Execute work with cleanup on completion.
   */
  private async executeWithCleanup(executionData: WorkerExecutionData): Promise<void> {
    try {
      await this.onWorkReceived(executionData);
    } catch (error) {
      // Errors are already handled in the callback
      // This just prevents unhandled promise rejection warnings
      logger.debug('Execution completed with error (already handled)', {
        executionId: executionData.executionId,
        error: String(error),
      });
    } finally {
      // Decrement execution count when done
      this.currentExecutionCount = Math.max(0, this.currentExecutionCount - 1);
    }
  }

  /**
   * Start the server.
   */
  async start(): Promise<void> {
    try {
      await this.app.listen({ port: this.port, host: this.host });
      logger.info(`Worker server listening on ${this.host}:${String(this.port)}`);
    } catch (error) {
      logger.error('Failed to start worker server', { error: String(error) });
      throw error;
    }
  }

  /**
   * Stop the server gracefully.
   */
  async stop(): Promise<void> {
    try {
      await this.app.close();
      logger.info('Worker server stopped');
    } catch (error) {
      logger.error('Error stopping worker server', { error: String(error) });
    }
  }
}
