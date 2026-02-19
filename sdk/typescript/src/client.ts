/**
 * PolosClient - Central entry point for interacting with the Polos orchestrator.
 *
 * The client stores configuration and provides methods for invoking workflows,
 * publishing events, and managing schedules.
 */

import type { Workflow, EventData, StreamEvent } from './types/index.js';
import { validateCronGranularity } from './core/workflow.js';
import { OrchestratorClient } from './runtime/orchestrator-client.js';
import type { GetExecutionResponse } from './runtime/orchestrator-types.js';
import { ExecutionHandle } from './execution-handle.js';
import { assertNotInExecutionContext } from './runtime/execution-context.js';

/**
 * Configuration options for PolosClient.
 */
export interface PolosClientConfig {
  /** Orchestrator API URL */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Project ID */
  projectId: string;
  /** Deployment ID for routing workflows to specific workers */
  deploymentId?: string;
  /** Maximum concurrent workflow executions (default: 100) */
  maxConcurrentWorkflows?: number;
}

/**
 * Options for invoking a workflow via PolosClient.
 */
export interface ClientInvokeOptions {
  /** Queue name override */
  queueName?: string | undefined;
  /** Concurrency limit for queue */
  queueConcurrencyLimit?: number | undefined;
  /** Concurrency key for per-tenant queuing */
  concurrencyKey?: string | undefined;
  /** Session ID */
  sessionId?: string | undefined;
  /** User ID */
  userId?: string | undefined;
  /** Initial state dictionary */
  initialState?: Record<string, unknown> | undefined;
  /** Timeout in seconds for the execution */
  runTimeoutSeconds?: number | undefined;
  /** Parent execution ID (when invoked from another workflow) */
  parentExecutionId?: string | undefined;
  /** Root workflow ID */
  rootWorkflowId?: string | undefined;
  /** Root execution ID */
  rootExecutionId?: string | undefined;
  /** Step key (when invoked from a step) */
  stepKey?: string | undefined;
  /** Channel context for bidirectional channels (e.g., originating Slack thread) */
  channelContext?: { channelId: string; source: Record<string, unknown> } | undefined;
}

/**
 * Input for batch workflow invocation via PolosClient.
 */
export interface ClientBatchWorkflowInput {
  /** Workflow to invoke (string ID or Workflow object) */
  workflow: string | Workflow;
  /** Payload for this invocation */
  payload?: unknown;
  /** Queue name override */
  queueName?: string | undefined;
  /** Concurrency key */
  concurrencyKey?: string | undefined;
  /** Concurrency limit for queue */
  queueConcurrencyLimit?: number | undefined;
  /** Initial state dictionary */
  initialState?: Record<string, unknown> | undefined;
  /** Timeout in seconds for the execution */
  runTimeoutSeconds?: number | undefined;
}

/**
 * Payload passed to scheduled workflows.
 * Matches Python SchedulePayload.
 */
export interface SchedulePayload {
  /** When this workflow was scheduled to run */
  timestamp: string;
  /** When this schedule last ran (null if first run) */
  lastTimestamp: string | null;
  /** Timezone of the schedule */
  timezone: string;
  /** Unique identifier for this schedule */
  scheduleId: string;
  /** User ID or custom identifier for the schedule */
  key: string;
  /** Next scheduled run time */
  upcoming: string;
}

/**
 * Events API accessed via client.events.
 * Matches Python sdk/python/polos/features/events.py function signatures.
 */
export interface EventsApi {
  /**
   * Publish a single event to a topic. Returns the sequence ID.
   * Matches Python publish().
   */
  publish(
    topic: string,
    eventData: EventData,
    executionId?: string,
    rootExecutionId?: string
  ): Promise<number>;

  /**
   * Publish a batch of events to a single topic. Returns list of sequence IDs.
   * Matches Python batch_publish().
   */
  batchPublish(
    topic: string,
    events: EventData[],
    executionId?: string,
    rootExecutionId?: string
  ): Promise<number[]>;

  /**
   * Stream events from a topic using Server-Sent Events (SSE).
   * Matches Python stream_topic().
   */
  streamTopic(
    topic: string,
    lastSequenceId?: number,
    lastTimestamp?: Date
  ): AsyncIterable<StreamEvent>;

  /**
   * Stream events from a workflow run using Server-Sent Events (SSE).
   * Automatically stops when it receives a finish event with matching execution ID.
   * Matches Python stream_workflow().
   */
  streamWorkflow(
    workflowId: string,
    workflowRunId: string,
    lastSequenceId?: number,
    lastTimestamp?: Date
  ): AsyncIterable<StreamEvent>;
}

/**
 * Schedules API accessed via client.schedules.
 * Matches Python sdk/python/polos/features/schedules.py.
 */
export interface SchedulesApi {
  /**
   * Create or update a schedule for a workflow.
   * If a schedule with the same workflow and key already exists, it will be updated.
   * Matches Python schedules.create().
   *
   * @param workflow - Workflow ID to schedule
   * @param cron - Cron expression (e.g., "0 8 * * *" for 8 AM daily)
   * @param timezone - Timezone for the schedule (default: "UTC")
   * @param key - Key for per-user/per-entity schedules (default: "global")
   * @returns schedule_id: Unique identifier for the schedule
   */
  create(workflow: string, cron: string, timezone?: string, key?: string): Promise<string>;
}

/**
 * PolosClient - The main client for interacting with Polos orchestrator.
 *
 * @example
 * ```typescript
 * import { PolosClient, defineWorkflow } from '@polos/sdk';
 *
 * const client = new PolosClient({
 *   apiUrl: 'https://api.polos.dev',
 *   apiKey: 'your-api-key',
 *   projectId: 'your-project',
 *   deploymentId: 'my-deployment', // optional, can also use POLOS_DEPLOYMENT_ID env var
 * });
 *
 * // Invoke a workflow
 * const handle = await client.invoke(myWorkflow, { data: 'value' });
 *
 * // Run and wait for result
 * const result = await client.run(myWorkflow, { data: 'value' });
 * ```
 */
/** Internal config type with defaults applied but deploymentId remaining optional */
type ResolvedPolosClientConfig = Required<Omit<PolosClientConfig, 'deploymentId'>> & {
  deploymentId: string | undefined;
};

/** Resolve a workflow-or-string to its ID */
function resolveWorkflowId(workflow: string | Workflow): string {
  return typeof workflow === 'string' ? workflow : workflow.id;
}

export class PolosClient {
  private readonly config: ResolvedPolosClientConfig;
  private readonly orchestratorClient: OrchestratorClient;

  /**
   * Events API for publishing and subscribing to events.
   */
  public readonly events: EventsApi;

  /**
   * Schedules API for managing workflow schedules.
   */
  public readonly schedules: SchedulesApi;

  constructor(config: PolosClientConfig) {
    this.config = {
      maxConcurrentWorkflows: 100,
      ...config,
      // Use provided deploymentId or fall back to environment variable
      deploymentId: config.deploymentId ?? process.env['POLOS_DEPLOYMENT_ID'],
    };

    this.orchestratorClient = new OrchestratorClient({
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
      projectId: this.config.projectId,
    });

    // Initialize sub-APIs
    this.events = this.createEventsApi();
    this.schedules = this.createSchedulesApi();
  }

  /**
   * Create a PolosClient from environment variables.
   *
   * Reads from:
   * - POLOS_API_URL
   * - POLOS_API_KEY
   * - POLOS_PROJECT_ID
   * - POLOS_DEPLOYMENT_ID (optional)
   * - POLOS_MAX_CONCURRENT_WORKFLOWS (optional)
   *
   * @throws Error if required environment variables are missing
   */
  static fromEnv(): PolosClient {
    const apiUrl = process.env['POLOS_API_URL'];
    const apiKey = process.env['POLOS_API_KEY'];
    const projectId = process.env['POLOS_PROJECT_ID'];
    const deploymentId = process.env['POLOS_DEPLOYMENT_ID'];

    if (!apiUrl) {
      throw new Error('POLOS_API_URL environment variable is required');
    }
    if (!apiKey) {
      throw new Error('POLOS_API_KEY environment variable is required');
    }
    if (!projectId) {
      throw new Error('POLOS_PROJECT_ID environment variable is required');
    }

    const config: PolosClientConfig = {
      apiUrl,
      apiKey,
      projectId,
      ...(deploymentId && { deploymentId }),
    };

    const maxConcurrent = process.env['POLOS_MAX_CONCURRENT_WORKFLOWS'];
    if (maxConcurrent) {
      const parsed = parseInt(maxConcurrent, 10);
      if (!isNaN(parsed)) {
        config.maxConcurrentWorkflows = parsed;
      }
    }

    return new PolosClient(config);
  }

  /**
   * Get the client configuration.
   */
  getConfig(): Readonly<ResolvedPolosClientConfig> {
    return this.config;
  }

  /**
   * Get the underlying OrchestratorClient for advanced use.
   */
  getOrchestratorClient(): OrchestratorClient {
    return this.orchestratorClient;
  }

  /**
   * Invoke a workflow (fire and forget).
   *
   * @param workflow - The workflow to invoke (string ID or Workflow object)
   * @param payload - Payload to pass to the workflow
   * @param options - Optional invocation options
   * @returns An ExecutionHandle to track the workflow execution
   */
  async invoke(
    workflow: string | Workflow,
    payload?: unknown,
    options?: ClientInvokeOptions
  ): Promise<ExecutionHandle> {
    assertNotInExecutionContext('client.invoke()', 'step.invoke()');
    const workflowId = resolveWorkflowId(workflow);

    const response = await this.orchestratorClient.invokeWorkflow(workflowId, {
      workflowId,
      payload,
      deploymentId: this.config.deploymentId,
      queueName: options?.queueName,
      queueConcurrencyLimit: options?.queueConcurrencyLimit,
      concurrencyKey: options?.concurrencyKey,
      sessionId: options?.sessionId,
      userId: options?.userId,
      initialState: options?.initialState,
      runTimeoutSeconds: options?.runTimeoutSeconds,
      parentExecutionId: options?.parentExecutionId,
      rootExecutionId: options?.rootExecutionId,
      stepKey: options?.stepKey,
      channelContext: options?.channelContext,
    });

    return new ExecutionHandle(
      {
        id: response.execution_id,
        workflowId,
        createdAt: response.created_at,
        parentExecutionId: options?.parentExecutionId,
        rootWorkflowId: options?.rootWorkflowId ?? workflowId,
        rootExecutionId: options?.rootExecutionId ?? response.execution_id,
        sessionId: options?.sessionId,
        userId: options?.userId,
        stepKey: options?.stepKey,
      },
      this.orchestratorClient
    );
  }

  /**
   * Invoke multiple workflows in batch (fire and forget).
   *
   * @param items - Array of workflow invocations
   * @param options - Optional batch-level options
   * @returns Array of ExecutionHandles to track executions
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
    assertNotInExecutionContext('client.batchInvoke()', 'step.batchInvoke()');
    if (items.length === 0) {
      return [];
    }

    const response = await this.orchestratorClient.batchInvokeWorkflows({
      workflows: items.map((item) => ({
        workflowId: resolveWorkflowId(item.workflow),
        payload: item.payload,
        queueName: item.queueName,
        concurrencyKey: item.concurrencyKey,
        queueConcurrencyLimit: item.queueConcurrencyLimit,
        initialState: item.initialState,
        runTimeoutSeconds: item.runTimeoutSeconds,
      })),
      deploymentId: this.config.deploymentId,
      sessionId: options?.sessionId,
      userId: options?.userId,
      parentExecutionId: options?.parentExecutionId,
      rootExecutionId: options?.rootExecutionId,
      stepKey: options?.stepKey,
      waitForSubworkflow: options?.waitForSubworkflow,
    });

    return response.executions.map((exec, i) => {
      const item = items[i];
      if (item === undefined) {
        throw new Error('item is undefined');
      }
      const wfId = resolveWorkflowId(item.workflow);
      return new ExecutionHandle(
        {
          id: exec.execution_id,
          workflowId: wfId,
          createdAt: exec.created_at,
          parentExecutionId: options?.parentExecutionId,
          rootWorkflowId: options?.rootWorkflowId ?? wfId,
          rootExecutionId: options?.rootExecutionId ?? exec.execution_id,
          sessionId: options?.sessionId,
          userId: options?.userId,
          stepKey: options?.stepKey,
        },
        this.orchestratorClient
      );
    });
  }

  /**
   * Resume a suspended execution by publishing a resume event.
   *
   * @param suspendWorkflowId - The workflow ID of the suspended execution
   * @param suspendExecutionId - The execution ID of the suspended execution
   * @param suspendStepKey - The step key that was used in suspend()
   * @param data - Data to pass in the resume event
   */
  async resume(
    suspendWorkflowId: string,
    suspendExecutionId: string,
    suspendStepKey: string,
    data: unknown
  ): Promise<void> {
    const topic = `workflow/${suspendWorkflowId}/${suspendExecutionId}`;

    await this.orchestratorClient.publishEvent({
      topic,
      events: [{ eventType: `resume_${suspendStepKey}`, data }],
    });
  }

  /**
   * Get execution details.
   *
   * @param executionId - The execution ID to look up
   * @returns Execution details
   */
  async getExecution(executionId: string): Promise<GetExecutionResponse> {
    return this.orchestratorClient.getExecution(executionId);
  }

  /**
   * Cancel an execution by its ID.
   *
   * @param executionId - The execution ID to cancel
   * @returns true if cancellation was successful, false on error
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    try {
      await this.orchestratorClient.cancelExecution(executionId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create the events sub-API.
   * Matches Python sdk/python/polos/features/events.py.
   */
  private createEventsApi(): EventsApi {
    const orchestratorClient = this.orchestratorClient;

    return {
      publish: async (
        topic: string,
        eventData: EventData,
        executionId?: string,
        rootExecutionId?: string
      ): Promise<number> => {
        const sequenceIds = await this.events.batchPublish(
          topic,
          [eventData],
          executionId,
          rootExecutionId
        );
        return sequenceIds[0] ?? 0;
      },

      batchPublish: async (
        topic: string,
        events: EventData[],
        executionId?: string,
        rootExecutionId?: string
      ): Promise<number[]> => {
        if (events.length === 0) {
          return [];
        }

        const response = await orchestratorClient.publishEvent({
          topic,
          events: events.map((e) => {
            const entry: { eventType?: string; data: unknown } = { data: e.data };
            if (e.eventType !== undefined) entry.eventType = e.eventType;
            return entry;
          }),
          executionId,
          rootExecutionId,
        });

        return response.sequence_ids;
      },

      streamTopic: (
        topic: string,
        lastSequenceId?: number,
        lastTimestamp?: Date
      ): AsyncIterable<StreamEvent> => {
        return orchestratorClient.streamEvents({
          topic,
          lastSequenceId,
          lastTimestamp: lastTimestamp?.toISOString(),
        });
      },

      streamWorkflow: (
        workflowId: string,
        workflowRunId: string,
        lastSequenceId?: number,
        lastTimestamp?: Date
      ): AsyncIterable<StreamEvent> => {
        // Wrap with finish-event detection matching Python's stream_workflow()
        async function* streamWithFinishCheck() {
          for await (const event of orchestratorClient.streamEvents({
            workflowId,
            workflowRunId,
            lastSequenceId,
            lastTimestamp: lastTimestamp?.toISOString(),
          })) {
            yield event;

            // Check for finish event with matching execution_id
            if (
              event.eventType === 'workflow_finish' ||
              event.eventType === 'agent_finish' ||
              event.eventType === 'tool_finish'
            ) {
              const metadata = event.data['_metadata'];
              if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
                const metadataRecord = metadata as Record<string, unknown>;
                if (metadataRecord['execution_id'] === workflowRunId) {
                  return;
                }
              }
            }
          }
        }

        return streamWithFinishCheck();
      },
    };
  }

  /**
   * Create the schedules sub-API.
   * Matches Python sdk/python/polos/features/schedules.py.
   */
  private createSchedulesApi(): SchedulesApi {
    const orchestratorClient = this.orchestratorClient;

    return {
      create: async (
        workflow: string,
        cron: string,
        timezone = 'UTC',
        key = 'global'
      ): Promise<string> => {
        validateCronGranularity(cron);
        const response = await orchestratorClient.createSchedule({
          workflowId: workflow,
          cron,
          timezone,
          key,
        });
        return response.schedule_id;
      },
    };
  }
}
