/**
 * Type definitions for orchestrator API requests and responses.
 */

/**
 * Worker capabilities sent during registration.
 */
export interface WorkerCapabilities {
  runtime: 'typescript' | 'python';
  agentIds: string[];
  toolIds: string[];
  workflowIds: string[];
}

/**
 * Request to register a worker with the orchestrator.
 */
export interface RegisterWorkerRequest {
  deploymentId: string;
  projectId: string;
  mode: 'push' | 'pull';
  capabilities: WorkerCapabilities;
  maxConcurrentExecutions: number;
  pushEndpointUrl?: string | undefined;
}

/**
 * Response from worker registration.
 */
export interface RegisterWorkerResponse {
  worker_id: string;
}

/**
 * Request to register a deployment.
 */
export interface RegisterDeploymentRequest {
  deploymentId: string;
}

/**
 * Workflow registration info.
 */
export interface WorkflowRegistration {
  workflowId: string;
  queueName?: string | undefined;
  isEventTriggered?: boolean | undefined;
  eventTopic?: string | undefined;
  batchSize?: number | undefined;
  isScheduled?: boolean | undefined;
  schedule?: string | undefined;
  scheduleTimezone?: string | undefined;
}

/**
 * Request to register workflows for a deployment.
 */
export interface RegisterWorkflowsRequest {
  workflows: WorkflowRegistration[];
}

/**
 * Queue registration info.
 */
export interface QueueRegistration {
  name: string;
  concurrencyLimit?: number | undefined;
}

/**
 * Request to register queues.
 */
export interface RegisterQueuesRequest {
  deploymentId: string;
  queues: QueueRegistration[];
}

/**
 * Response from heartbeat.
 */
export interface HeartbeatResponse {
  re_register: boolean;
}

/**
 * Execution data received from orchestrator (push mode).
 */
export interface ExecutionData {
  executionId: string;
  workflowId: string;
  payload: unknown;
  context: ExecutionContext;
}

/**
 * Execution context from orchestrator.
 */
export interface ExecutionContext {
  executionId: string;
  deploymentId: string;
  parentExecutionId?: string | undefined;
  rootExecutionId?: string | undefined;
  rootWorkflowId?: string | undefined;
  retryCount: number;
  sessionId?: string | undefined;
  userId?: string | undefined;
  otelTraceparent?: string | undefined;
  otelSpanId?: string | undefined;
  initialState?: Record<string, unknown> | undefined;
  runTimeoutSeconds?: number | undefined;
  createdAt?: string | undefined;
}

/**
 * Request to complete an execution.
 */
export interface CompleteExecutionRequest {
  result: unknown;
  workerId: string;
  outputSchemaName?: string | undefined;
  finalState?: Record<string, unknown> | undefined;
}

/**
 * Request to fail an execution.
 */
export interface FailExecutionRequest {
  error: string;
  workerId: string;
  stack?: string | undefined;
  retryable: boolean;
  finalState?: Record<string, unknown> | undefined;
}

/**
 * Request to confirm cancellation.
 */
export interface ConfirmCancellationRequest {
  workerId: string;
}

/**
 * Request to store a step output.
 */
export interface StoreStepOutputRequest {
  stepKey: string;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  outputs?: unknown | undefined;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  error?: unknown | undefined;
  success?: boolean | undefined;
  sourceExecutionId?: string | undefined;
  outputSchemaName?: string | undefined;
}

/**
 * Step output from orchestrator.
 */
export interface StepOutput {
  stepKey: string;
  outputs: unknown;
  completedAt: string;
  success?: boolean | undefined;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  error?: unknown | undefined;
  outputSchemaName?: string | undefined;
  sourceExecutionId?: string | undefined;
}

/**
 * Request body for /execute endpoint (push mode).
 * Matches the flat PushWorkRequest struct from the orchestrator.
 */
export interface ExecuteRequest {
  worker_id: string;
  execution_id: string;
  workflow_id: string;
  deployment_id?: string | null;
  payload: unknown;
  parent_execution_id?: string | null;
  root_execution_id?: string | null;
  root_workflow_id?: string | null;
  step_key?: string | null;
  retry_count: number;
  created_at?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  otel_traceparent?: string | null;
  otel_span_id?: string | null;
  initial_state?: Record<string, unknown> | null;
  run_timeout_seconds?: number | null;
}

/**
 * Request body for /cancel endpoint (push mode).
 */
export interface CancelRequest {
  worker_id?: string | undefined;
  execution_id: string;
}

/**
 * Error response from orchestrator.
 */
export interface OrchestratorError {
  error: string;
  code?: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  details?: unknown | undefined;
}

/**
 * Request to register an agent definition with the orchestrator.
 * Matches Python _register_agents() payload.
 */
export interface RegisterAgentRequest {
  id: string;
  deploymentId: string;
  provider: string;
  model: string;
  systemPrompt?: string | undefined;
  tools?: unknown[] | undefined;
  temperature?: number | undefined;
  maxOutputTokens?: number | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

/**
 * Request to register a single workflow/agent/tool in deployment_workflows.
 * Matches Python _register_deployment_workflow().
 */
export interface RegisterDeploymentWorkflowRequest {
  workflowId: string;
  workflowType: string;
  triggerOnEvent?: boolean | undefined;
  scheduled?: boolean | undefined;
}

/**
 * Request to register a tool definition with the orchestrator.
 */
export interface RegisterToolRequest {
  id: string;
  deploymentId: string;
  toolType: string;
  description: string;
  parameters: Record<string, unknown>;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Request to set execution waiting.
 */
export interface SetWaitingRequest {
  stepKey: string;
  waitType: 'time' | 'event' | 'suspend';
  waitUntil?: string | undefined;
  waitTopic?: string | undefined;
  expiresAt?: string | undefined;
}

/**
 * Event publish request.
 */
/**
 * Single event within a publish batch.
 */
export interface EventEntry {
  eventType?: string | undefined;
  data: unknown;
}

/**
 * Event publish request (batch format matching Python batch_publish).
 */
export interface PublishEventRequest {
  topic: string;
  events: EventEntry[];
  executionId?: string | undefined;
  rootExecutionId?: string | undefined;
}

/**
 * Response from event publish.
 */
export interface PublishEventResponse {
  sequence_ids: number[];
}

/**
 * Parameters for streaming events via SSE.
 */
export interface StreamEventsParams {
  topic?: string | undefined;
  workflowId?: string | undefined;
  workflowRunId?: string | undefined;
  lastSequenceId?: number | undefined;
  lastTimestamp?: string | undefined;
}

/**
 * Invoke workflow request (from step.invoke).
 */
export interface InvokeWorkflowRequest {
  workflowId: string;
  payload: unknown;
  stepKey?: string | undefined;
  deploymentId?: string | undefined;
  parentExecutionId?: string | undefined;
  rootExecutionId?: string | undefined;
  rootWorkflowId?: string | undefined;
  queueName?: string | undefined;
  queueConcurrencyLimit?: number | undefined;
  concurrencyKey?: string | undefined;
  waitForSubworkflow?: boolean | undefined;
  batchId?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  otelTraceparent?: string | undefined;
  initialState?: Record<string, unknown> | undefined;
  runTimeoutSeconds?: number | undefined;
}

/**
 * Invoke workflow response.
 */
export interface InvokeWorkflowResponse {
  execution_id: string;
  created_at?: string;
}

/**
 * Get execution response.
 */
export interface GetExecutionResponse {
  execution_id: string;
  workflow_id: string;
  status:
    | 'queued'
    | 'claimed'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'pending_cancel';
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  result?: unknown | undefined;
  error?: string | undefined;
  created_at: string;
  completed_at?: string | undefined;
}

/**
 * Single workflow entry for batch invocation.
 */
export interface BatchWorkflowEntry {
  workflowId: string;
  payload: unknown;
  queueName?: string | undefined;
  concurrencyKey?: string | undefined;
  queueConcurrencyLimit?: number | undefined;
  initialState?: Record<string, unknown> | undefined;
  runTimeoutSeconds?: number | undefined;
}

/**
 * Request body for batch workflow invocation.
 */
export interface BatchInvokeWorkflowsRequest {
  workflows: BatchWorkflowEntry[];
  deploymentId?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  stepKey?: string | undefined;
  parentExecutionId?: string | undefined;
  rootExecutionId?: string | undefined;
  rootWorkflowId?: string | undefined;
  waitForSubworkflow?: boolean | undefined;
  otelTraceparent?: string | undefined;
}

/**
 * Response from batch workflow invocation.
 */
export interface BatchInvokeWorkflowsResponse {
  executions: { execution_id: string; created_at?: string }[];
}

/**
 * Request to create or update a schedule.
 */
export interface CreateScheduleRequest {
  workflowId: string;
  cron: string;
  timezone: string;
  key: string;
}

/**
 * Response from schedule creation.
 */
export interface CreateScheduleResponse {
  schedule_id: string;
}

/**
 * Request to add a message to conversation history.
 */
export interface AddConversationHistoryRequest {
  agentId: string;
  role: string;
  content: unknown;
  conversationHistoryLimit?: number | undefined;
  agentRunId?: string | undefined;
}

/**
 * Parameters for getting conversation history.
 */
export interface GetConversationHistoryParams {
  agentId: string;
  deploymentId?: string | undefined;
  limit?: number | undefined;
}

/**
 * Response from getting conversation history.
 */
export interface GetConversationHistoryResponse {
  messages: ConversationMessage[];
}

/**
 * A single message in conversation history.
 */
export interface ConversationMessage {
  role: string;
  content: unknown;
}

/**
 * Response from GET /internal/session/{sessionId}/memory.
 */
export interface SessionMemoryResponse {
  summary: string | null;
  messages: ConversationMessage[];
}

/**
 * Request body for PUT /internal/session/{sessionId}/memory.
 */
export interface PutSessionMemoryRequest {
  summary: string | null;
  messages: ConversationMessage[];
}

/**
 * Response from GET /api/v1/workers/active.
 * Returns the IDs of all active workers in the current project.
 */
export interface GetActiveWorkersResponse {
  worker_ids: string[];
}
