/**
 * Event-related type definitions.
 *
 * Types match sdk/python/polos/features/events.py exactly.
 */

/**
 * Event data structure for publishing events.
 * Matches Python EventData.
 */
export interface EventData {
  /** Type of event */
  eventType?: string | undefined;
  /** Event payload */
  data: Record<string, unknown>;
}

/**
 * Event payload received when waiting for events in workflows.
 * Returned by ctx.step.waitForEvent() when an event is received.
 * Matches Python EventPayload.
 */
export interface EventPayload {
  /** Event ID (UUID string) */
  id: string;
  /** Global sequence ID for ordering */
  sequenceId: number;
  /** Event topic */
  topic: string;
  /** Type of event */
  eventType?: string | undefined;
  /** Event payload */
  data: Record<string, unknown>;
  /** Timestamp when event was created */
  createdAt: string;
}

/**
 * Single event item in a batch of events.
 * Used in BatchEventPayload for event-triggered workflows with batching.
 * Matches Python EventItem.
 */
export interface EventItem {
  /** Event ID (UUID string) */
  id: string;
  /** Global sequence ID for ordering */
  sequenceId: number;
  /** Event topic */
  topic: string;
  /** Type of event */
  eventType?: string | undefined;
  /** Event payload */
  data: Record<string, unknown>;
  /** Timestamp when event was created */
  createdAt: string;
}

/**
 * Batch event payload for event-triggered workflows with batching.
 * Matches Python BatchEventPayload.
 */
export interface BatchEventPayload {
  /** List of events in the batch */
  events: EventItem[];
}

/**
 * Event received from an SSE stream.
 * Matches Python StreamEvent.
 */
export interface StreamEvent {
  /** Event ID */
  id: string;
  /** Sequence ID for ordering */
  sequenceId: number;
  /** Event topic */
  topic: string;
  /** Event type (optional categorization) */
  eventType?: string | undefined;
  /** Event data */
  data: Record<string, unknown>;
  /** Creation timestamp (RFC3339 string) */
  createdAt?: string | undefined;
}

/**
 * Represents an event in the event system.
 * Matches Python Event class.
 */
export interface Event {
  /** Unique event identifier */
  id: string;
  /** Global sequence ID for ordering */
  sequenceId: number;
  /** Event topic */
  topic: string;
  /** Event type */
  eventType?: string | undefined;
  /** Event data */
  data?: Record<string, unknown> | undefined;
  /** Event status */
  status: string;
  /** Source workflow execution ID */
  executionId?: string | undefined;
  /** Attempt number */
  attemptNumber: number;
  /** When the event was created */
  createdAt?: string | undefined;
}

/**
 * Options for streaming events from a topic.
 */
export interface StreamTopicOptions {
  /** Topic to stream from */
  topic: string;
  /** Start streaming after this sequence ID */
  lastSequenceId?: number;
  /** Start streaming after this timestamp */
  lastTimestamp?: Date;
}

/**
 * Options for streaming events from a workflow run.
 */
export interface StreamWorkflowOptions {
  /** Workflow ID (name) */
  workflowId: string;
  /** Workflow run ID (execution ID) */
  workflowRunId: string;
  /** Start streaming after this sequence ID */
  lastSequenceId?: number;
  /** Start streaming after this timestamp */
  lastTimestamp?: Date;
}

/**
 * Payload for event-triggered workflows.
 */
export interface EventTriggerPayload {
  /** The events that triggered this execution */
  events: EventItem[];
  /** Batch information */
  batch: {
    /** Batch index (0-based) */
    index: number;
    /** Total events in this batch */
    size: number;
    /** Whether this is the last batch */
    isLast: boolean;
  };
}

/**
 * Internal workflow lifecycle events.
 */
export type WorkflowEvent =
  | WorkflowStartEvent
  | WorkflowFinishEvent
  | StepStartEvent
  | StepFinishEvent
  | TextDeltaEvent
  | ToolCallEvent;

export interface WorkflowStartEvent {
  type: 'workflow_start';
  _metadata: {
    workflowId: string;
    executionId: string;
  };
  timestamp: Date;
  payload: unknown;
}

export interface WorkflowFinishEvent {
  type: 'workflow_finish';
  _metadata: {
    workflowId: string;
    executionId: string;
  };
  timestamp: Date;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface StepStartEvent {
  type: 'step_start';
  _metadata: {
    workflowId: string;
    executionId: string;
  };
  stepKey: string;
  timestamp: Date;
}

export interface StepFinishEvent {
  type: 'step_finish';
  _metadata: {
    workflowId: string;
    executionId: string;
  };
  stepKey: string;
  timestamp: Date;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface TextDeltaEvent {
  type: 'text_delta';
  _metadata: {
    workflowId: string;
    executionId: string;
  };
  step: number;
  chunkIndex: number;
  content?: string;
  timestamp: Date;
}

export interface ToolCallEvent {
  type: 'tool_call';
  _metadata: {
    workflowId: string;
    executionId: string;
  };
  step: number;
  chunkIndex: number;
  toolCall?: {
    id: string;
    callId?: string;
    type: string;
    function: { name: string; arguments: string };
  };
  timestamp: Date;
}
