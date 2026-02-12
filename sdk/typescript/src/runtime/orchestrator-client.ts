/**
 * HTTP client for orchestrator API communication.
 */

import type {
  RegisterWorkerRequest,
  RegisterWorkerResponse,
  RegisterDeploymentRequest,
  RegisterWorkflowsRequest,
  RegisterQueuesRequest,
  RegisterAgentRequest,
  RegisterDeploymentWorkflowRequest,
  RegisterToolRequest,
  HeartbeatResponse,
  CompleteExecutionRequest,
  FailExecutionRequest,
  ConfirmCancellationRequest,
  StoreStepOutputRequest,
  StepOutput,
  SetWaitingRequest,
  PublishEventRequest,
  PublishEventResponse,
  StreamEventsParams,
  InvokeWorkflowRequest,
  InvokeWorkflowResponse,
  GetExecutionResponse,
  BatchInvokeWorkflowsRequest,
  BatchInvokeWorkflowsResponse,
  CreateScheduleRequest,
  CreateScheduleResponse,
  AddConversationHistoryRequest,
  GetConversationHistoryParams,
  ConversationMessage,
} from './orchestrator-types.js';

import type { StreamEvent } from '../types/events.js';

/**
 * Configuration for OrchestratorClient.
 */
export interface OrchestratorClientConfig {
  /** Orchestrator API URL */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Project ID */
  projectId: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number | undefined;
  /** Max retries for failed requests (default: 3) */
  maxRetries?: number | undefined;
}

/**
 * Error thrown when orchestrator API request fails.
 */
export class OrchestratorApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'OrchestratorApiError';
  }
}

/**
 * HTTP client for communicating with the Polos orchestrator.
 */
export class OrchestratorClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: OrchestratorClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Get the API URL.
   */
  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Get the project ID.
   */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Get default headers for API requests.
   */
  private getHeaders(workerId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'X-Project-ID': this.projectId,
    };
    if (workerId) {
      headers['X-Worker-ID'] = workerId;
    }
    return headers;
  }

  /**
   * Make an HTTP request with retry logic.
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      workerId?: string;
      retries?: number;
    }
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const retries = options?.retries ?? this.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, this.timeout);

        const fetchOptions: RequestInit = {
          method,
          headers: this.getHeaders(options?.workerId),
          signal: controller.signal,
        };
        if (options?.body) {
          fetchOptions.body = JSON.stringify(options.body);
        }
        const response = await fetch(url, fetchOptions);

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          let errorData: unknown;
          try {
            errorData = JSON.parse(errorBody);
          } catch {
            errorData = errorBody;
          }

          // Don't retry on 4xx errors (except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw new OrchestratorApiError(
              `Request failed: ${String(response.status)} ${response.statusText}`,
              response.status,
              errorData
            );
          }

          throw new OrchestratorApiError(
            `Request failed: ${String(response.status)} ${response.statusText}`,
            response.status,
            errorData
          );
        }

        // Handle empty responses
        const text = await response.text();
        if (!text) {
          return undefined as T;
        }

        return JSON.parse(text) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on non-retryable errors
        if (
          error instanceof OrchestratorApiError &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          throw error;
        }

        // Wait before retry with exponential backoff
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  // ==================== Worker Lifecycle ====================

  /**
   * Register a worker with the orchestrator.
   */
  async registerWorker(request: RegisterWorkerRequest): Promise<RegisterWorkerResponse> {
    return this.request<RegisterWorkerResponse>('POST', '/api/v1/workers/register', {
      body: {
        deployment_id: request.deploymentId,
        project_id: request.projectId,
        mode: request.mode,
        capabilities: {
          runtime: request.capabilities.runtime,
          agent_ids: request.capabilities.agentIds,
          tool_ids: request.capabilities.toolIds,
          workflow_ids: request.capabilities.workflowIds,
        },
        max_concurrent_executions: request.maxConcurrentExecutions,
        push_endpoint_url: request.pushEndpointUrl,
      },
    });
  }

  /**
   * Register a deployment.
   */
  async registerDeployment(request: RegisterDeploymentRequest): Promise<void> {
    await this.request<undefined>('POST', '/api/v1/workers/deployments', {
      body: {
        deployment_id: request.deploymentId,
      },
    });
  }

  /**
   * Register workflows for a deployment.
   */
  async registerWorkflows(deploymentId: string, request: RegisterWorkflowsRequest): Promise<void> {
    await this.request<undefined>('POST', `/api/v1/workers/deployments/${deploymentId}/workflows`, {
      body: {
        workflows: request.workflows.map((w) => ({
          workflow_id: w.workflowId,
          queue_name: w.queueName,
          is_event_triggered: w.isEventTriggered,
          event_topic: w.eventTopic,
          batch_size: w.batchSize,
          is_scheduled: w.isScheduled,
          schedule: w.schedule,
          schedule_timezone: w.scheduleTimezone,
        })),
      },
    });
  }

  /**
   * Register queues.
   */
  async registerQueues(request: RegisterQueuesRequest): Promise<void> {
    await this.request<undefined>('POST', '/api/v1/workers/queues', {
      body: {
        deployment_id: request.deploymentId,
        queues: request.queues.map((q) => ({
          name: q.name,
          concurrency_limit: q.concurrencyLimit,
        })),
      },
    });
  }

  /**
   * Register a tool definition with the orchestrator.
   */
  async registerTool(request: RegisterToolRequest): Promise<void> {
    const body: Record<string, unknown> = {
      id: request.id,
      deployment_id: request.deploymentId,
      tool_type: request.toolType,
      description: request.description,
      parameters: request.parameters,
    };
    if (request.metadata !== undefined) {
      body['metadata'] = request.metadata;
    }

    await this.request<undefined>('POST', '/api/v1/tools/register', { body });
  }

  /**
   * Register an agent definition with the orchestrator.
   * Matches Python _register_agents() POST to /api/v1/agents/register.
   */
  async registerAgent(request: RegisterAgentRequest): Promise<void> {
    const body: Record<string, unknown> = {
      id: request.id,
      deployment_id: request.deploymentId,
      provider: request.provider,
      model: request.model,
    };
    if (request.systemPrompt !== undefined) body['system_prompt'] = request.systemPrompt;
    if (request.tools !== undefined) body['tools'] = request.tools;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.maxOutputTokens !== undefined) body['max_output_tokens'] = request.maxOutputTokens;
    if (request.metadata !== undefined) body['metadata'] = request.metadata;

    await this.request<undefined>('POST', '/api/v1/agents/register', { body });
  }

  /**
   * Register a single workflow/agent/tool in deployment_workflows table.
   * Matches Python _register_deployment_workflow().
   */
  async registerDeploymentWorkflow(
    deploymentId: string,
    request: RegisterDeploymentWorkflowRequest
  ): Promise<void> {
    await this.request<undefined>('POST', `/api/v1/workers/deployments/${deploymentId}/workflows`, {
      body: {
        workflow_id: request.workflowId,
        workflow_type: request.workflowType,
        trigger_on_event: request.triggerOnEvent ?? false,
        scheduled: request.scheduled ?? false,
      },
    });
  }

  /**
   * Mark worker as online.
   */
  async markOnline(workerId: string): Promise<void> {
    await this.request<undefined>('POST', `/api/v1/workers/${workerId}/online`, {
      workerId,
    });
  }

  /**
   * Send heartbeat.
   */
  async sendHeartbeat(workerId: string): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>('POST', `/api/v1/workers/${workerId}/heartbeat`, {
      workerId,
      body: {},
    });
  }

  // ==================== Execution Reporting ====================

  /**
   * Complete an execution successfully.
   */
  async completeExecution(executionId: string, request: CompleteExecutionRequest): Promise<void> {
    await this.request<undefined>('POST', `/internal/executions/${executionId}/complete`, {
      workerId: request.workerId,
      body: {
        result: request.result,
        worker_id: request.workerId,
        output_schema_name: request.outputSchemaName,
        final_state: request.finalState,
      },
    });
  }

  /**
   * Fail an execution.
   */
  async failExecution(executionId: string, request: FailExecutionRequest): Promise<void> {
    await this.request<undefined>('POST', `/internal/executions/${executionId}/fail`, {
      workerId: request.workerId,
      body: {
        error: request.error,
        worker_id: request.workerId,
        stack: request.stack,
        retryable: request.retryable,
        final_state: request.finalState,
      },
    });
  }

  /**
   * Confirm cancellation of an execution.
   */
  async confirmCancellation(
    executionId: string,
    request: ConfirmCancellationRequest
  ): Promise<void> {
    await this.request<undefined>(
      'POST',
      `/internal/executions/${executionId}/confirm-cancellation`,
      {
        workerId: request.workerId,
        body: {
          worker_id: request.workerId,
        },
      }
    );
  }

  // ==================== Step Persistence ====================

  /**
   * Store a step output.
   */
  async storeStepOutput(
    executionId: string,
    request: StoreStepOutputRequest,
    workerId?: string
  ): Promise<void> {
    const body: Record<string, unknown> = {
      step_key: request.stepKey,
    };
    if (request.outputs !== undefined) body['outputs'] = request.outputs;
    if (request.error !== undefined) body['error'] = request.error;
    if (request.success !== undefined) body['success'] = request.success;
    if (request.sourceExecutionId !== undefined)
      body['source_execution_id'] = request.sourceExecutionId;
    if (request.outputSchemaName !== undefined)
      body['output_schema_name'] = request.outputSchemaName;

    const options: { body: unknown; workerId?: string } = { body };
    if (workerId !== undefined) options.workerId = workerId;

    await this.request<undefined>('POST', `/internal/executions/${executionId}/steps`, options);
  }

  /**
   * Get a specific step output.
   */
  async getStepOutput(
    executionId: string,
    stepKey: string,
    workerId: string
  ): Promise<StepOutput | null> {
    try {
      const response = await this.request<{
        step_key: string;
        outputs: unknown;
        completed_at: string;
        success?: boolean;
        error?: unknown;
        output_schema_name?: string;
        source_execution_id?: string;
      }>('GET', `/internal/executions/${executionId}/steps/${encodeURIComponent(stepKey)}`, {
        workerId,
      });
      return {
        stepKey: response.step_key,
        outputs: response.outputs,
        completedAt: response.completed_at,
        success: response.success,
        error: response.error,
        outputSchemaName: response.output_schema_name,
        sourceExecutionId: response.source_execution_id,
      };
    } catch (error) {
      if (error instanceof OrchestratorApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all step outputs for an execution.
   */
  async getAllStepOutputs(executionId: string, workerId: string): Promise<StepOutput[]> {
    const response = await this.request<{
      steps: {
        step_key: string;
        outputs: unknown;
        completed_at: string;
        success?: boolean;
        error?: unknown;
        output_schema_name?: string;
        source_execution_id?: string;
      }[];
    }>('GET', `/internal/executions/${executionId}/steps`, { workerId });
    return response.steps.map((s) => ({
      stepKey: s.step_key,
      outputs: s.outputs,
      completedAt: s.completed_at,
      success: s.success,
      error: s.error,
      outputSchemaName: s.output_schema_name,
      sourceExecutionId: s.source_execution_id,
    }));
  }

  // ==================== Wait/Suspend ====================

  /**
   * Set execution to waiting state.
   */
  async setWaiting(
    executionId: string,
    request: SetWaitingRequest,
    workerId?: string
  ): Promise<void> {
    const options: { body: unknown; workerId?: string } = {
      body: {
        step_key: request.stepKey,
        wait_type: request.waitType,
        wait_until: request.waitUntil,
        wait_topic: request.waitTopic,
        expires_at: request.expiresAt,
      },
    };
    if (workerId !== undefined) options.workerId = workerId;

    await this.request<undefined>('POST', `/internal/executions/${executionId}/wait`, options);
  }

  // ==================== Events ====================

  /**
   * Publish events. Returns sequence IDs.
   */
  async publishEvent(request: PublishEventRequest): Promise<PublishEventResponse> {
    const body: Record<string, unknown> = {
      topic: request.topic,
      events: request.events.map((e) => {
        const entry: Record<string, unknown> = { data: e.data };
        if (e.eventType !== undefined) entry['event_type'] = e.eventType;
        return entry;
      }),
    };
    if (request.executionId !== undefined) body['execution_id'] = request.executionId;
    if (request.rootExecutionId !== undefined) body['root_execution_id'] = request.rootExecutionId;

    return this.request<PublishEventResponse>('POST', '/api/v1/events/publish', {
      body,
    });
  }

  /**
   * Stream events via SSE. Matching Python's _stream().
   */
  async *streamEvents(params: StreamEventsParams): AsyncGenerator<StreamEvent> {
    const queryParams = new URLSearchParams();
    queryParams.set('project_id', this.projectId);

    if (params.workflowRunId) {
      if (!params.workflowId) {
        throw new Error('workflowId must be provided when workflowRunId is provided');
      }
      queryParams.set('workflow_id', params.workflowId);
      queryParams.set('workflow_run_id', params.workflowRunId);
    } else if (params.topic) {
      queryParams.set('topic', params.topic);
    } else {
      throw new Error('Either topic or workflowRunId must be provided');
    }

    if (params.lastSequenceId !== undefined) {
      queryParams.set('last_sequence_id', String(params.lastSequenceId));
    } else if (params.lastTimestamp !== undefined) {
      queryParams.set('last_timestamp', params.lastTimestamp);
    } else {
      queryParams.set('last_timestamp', new Date().toISOString());
    }

    const url = `${this.apiUrl}/api/v1/events/stream?${queryParams.toString()}`;
    const headers = this.getHeaders();

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new OrchestratorApiError(
        `Stream request failed: ${String(response.status)} ${response.statusText}`,
        response.status
      );
    }

    if (!response.body) {
      return;
    }

    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventData: string | null = null;

    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');

          // Empty line indicates end of event
          if (!line) {
            if (currentEventData) {
              try {
                const eventDict = JSON.parse(currentEventData) as Record<string, unknown>;
                const data = eventDict['data'];
                const streamEvent: StreamEvent = {
                  id: eventDict['id'] as string,
                  sequenceId: eventDict['sequence_id'] as number,
                  topic: eventDict['topic'] as string,
                  eventType: eventDict['event_type'] as string | undefined,
                  data: (typeof data === 'object' && data !== null ? data : {}) as Record<
                    string,
                    unknown
                  >,
                  createdAt: eventDict['created_at'] as string | undefined,
                };
                yield streamEvent;
              } catch {
                // Skip invalid events
              }
              currentEventData = null;
            }
            continue;
          }

          // SSE format: data: {...}
          if (line.startsWith('data: ')) {
            currentEventData = line.slice(6);
          }
          // Skip keepalive messages and comments
        }
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }

  // ==================== Workflow Invocation ====================

  /**
   * Invoke a workflow.
   */
  async invokeWorkflow(
    workflowId: string,
    request: InvokeWorkflowRequest
  ): Promise<InvokeWorkflowResponse> {
    const body: Record<string, unknown> = {
      payload: request.payload,
    };
    if (request.stepKey !== undefined) body['step_key'] = request.stepKey;
    if (request.deploymentId !== undefined) body['deployment_id'] = request.deploymentId;
    if (request.parentExecutionId !== undefined)
      body['parent_execution_id'] = request.parentExecutionId;
    if (request.rootExecutionId !== undefined) body['root_execution_id'] = request.rootExecutionId;
    if (request.rootWorkflowId !== undefined) body['root_workflow_id'] = request.rootWorkflowId;
    if (request.queueName !== undefined) body['queue_name'] = request.queueName;
    if (request.queueConcurrencyLimit !== undefined)
      body['queue_concurrency_limit'] = request.queueConcurrencyLimit;
    if (request.concurrencyKey !== undefined) body['concurrency_key'] = request.concurrencyKey;
    if (request.waitForSubworkflow !== undefined)
      body['wait_for_subworkflow'] = request.waitForSubworkflow;
    if (request.batchId !== undefined) body['batch_id'] = request.batchId;
    if (request.sessionId !== undefined) body['session_id'] = request.sessionId;
    if (request.userId !== undefined) body['user_id'] = request.userId;
    if (request.otelTraceparent !== undefined) body['otel_traceparent'] = request.otelTraceparent;
    if (request.initialState !== undefined) body['initial_state'] = request.initialState;
    if (request.runTimeoutSeconds !== undefined)
      body['run_timeout_seconds'] = request.runTimeoutSeconds;

    return this.request<InvokeWorkflowResponse>('POST', `/api/v1/workflows/${workflowId}/run`, {
      body,
    });
  }

  /**
   * Invoke multiple workflows in a single batch.
   */
  async batchInvokeWorkflows(
    request: BatchInvokeWorkflowsRequest
  ): Promise<BatchInvokeWorkflowsResponse> {
    const body: Record<string, unknown> = {
      workflows: request.workflows.map((w) => {
        const entry: Record<string, unknown> = {
          workflow_id: w.workflowId,
          payload: w.payload,
        };
        if (w.queueName !== undefined) entry['queue_name'] = w.queueName;
        if (w.concurrencyKey !== undefined) entry['concurrency_key'] = w.concurrencyKey;
        if (w.queueConcurrencyLimit !== undefined)
          entry['queue_concurrency_limit'] = w.queueConcurrencyLimit;
        if (w.initialState !== undefined) entry['initial_state'] = w.initialState;
        if (w.runTimeoutSeconds !== undefined) entry['run_timeout_seconds'] = w.runTimeoutSeconds;
        return entry;
      }),
    };
    if (request.deploymentId !== undefined) body['deployment_id'] = request.deploymentId;
    if (request.sessionId !== undefined) body['session_id'] = request.sessionId;
    if (request.userId !== undefined) body['user_id'] = request.userId;
    if (request.stepKey !== undefined) body['step_key'] = request.stepKey;
    if (request.parentExecutionId !== undefined)
      body['parent_execution_id'] = request.parentExecutionId;
    if (request.rootExecutionId !== undefined) body['root_execution_id'] = request.rootExecutionId;
    if (request.rootWorkflowId !== undefined) body['root_workflow_id'] = request.rootWorkflowId;
    if (request.waitForSubworkflow !== undefined)
      body['wait_for_subworkflow'] = request.waitForSubworkflow;
    if (request.otelTraceparent !== undefined) body['otel_traceparent'] = request.otelTraceparent;

    return this.request<BatchInvokeWorkflowsResponse>('POST', '/api/v1/workflows/batch_run', {
      body,
    });
  }

  /**
   * Get execution status.
   */
  async getExecution(executionId: string): Promise<GetExecutionResponse> {
    return this.request<GetExecutionResponse>('GET', `/api/v1/executions/${executionId}`);
  }

  /**
   * Poll for execution result.
   */
  async waitForExecution(
    executionId: string,
    options?: { timeout?: number; pollInterval?: number }
  ): Promise<GetExecutionResponse> {
    const timeout = options?.timeout ?? 300000; // 5 minutes default
    const pollInterval = options?.pollInterval ?? 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const execution = await this.getExecution(executionId);

      if (
        execution.status === 'completed' ||
        execution.status === 'failed' ||
        execution.status === 'cancelled'
      ) {
        return execution;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Execution ${executionId} timed out after ${String(timeout)}ms`);
  }

  /**
   * Cancel an execution.
   */
  async cancelExecution(executionId: string): Promise<void> {
    await this.request<undefined>('POST', `/api/v1/executions/${executionId}/cancel`);
  }

  /**
   * Update execution's otel_span_id (used when workflow is paused via WaitException).
   */
  async updateExecutionOtelSpanId(
    executionId: string,
    otelSpanId: string | undefined
  ): Promise<void> {
    await this.request<undefined>('PUT', `/internal/executions/${executionId}/otel-span-id`, {
      body: { otel_span_id: otelSpanId ?? null },
    });
  }

  // ==================== Conversation History ====================

  /**
   * Add a message to conversation history.
   * POST /internal/conversation/{conversationId}/add
   */
  async addConversationHistory(
    conversationId: string,
    request: AddConversationHistoryRequest
  ): Promise<void> {
    const encoded = encodeURIComponent(conversationId);
    const body: Record<string, unknown> = {
      agent_id: request.agentId,
      role: request.role,
      content: request.content,
      conversation_history_limit: request.conversationHistoryLimit ?? 10,
    };
    if (request.agentRunId !== undefined) body['agent_run_id'] = request.agentRunId;

    await this.request<undefined>('POST', `/internal/conversation/${encoded}/add`, {
      body,
    });
  }

  /**
   * Get conversation history for a conversation.
   * GET /api/v1/conversation/{conversationId}/get
   */
  async getConversationHistory(
    conversationId: string,
    params: GetConversationHistoryParams
  ): Promise<ConversationMessage[]> {
    const encoded = encodeURIComponent(conversationId);
    const queryParams = new URLSearchParams();
    queryParams.set('agent_id', params.agentId);
    if (params.deploymentId !== undefined) queryParams.set('deployment_id', params.deploymentId);
    if (params.limit !== undefined) queryParams.set('limit', String(params.limit));

    const response = await this.request<{ messages?: ConversationMessage[] }>(
      'GET',
      `/api/v1/conversation/${encoded}/get?${queryParams.toString()}`
    );
    return response.messages ?? [];
  }

  // ==================== Schedules ====================

  /**
   * Create or update a schedule. Returns schedule_id.
   */
  async createSchedule(request: CreateScheduleRequest): Promise<CreateScheduleResponse> {
    return this.request<CreateScheduleResponse>('POST', '/api/v1/schedules', {
      body: {
        workflow_id: request.workflowId,
        cron: request.cron,
        timezone: request.timezone,
        key: request.key,
      },
    });
  }
}
