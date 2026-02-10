/**
 * Queue configuration for workflow execution.
 *
 * Queues control concurrency and ordering of workflow executions.
 */

/**
 * Options for creating a Queue.
 */
export interface QueueOptions {
  /** Maximum concurrent executions in this queue */
  concurrencyLimit?: number | undefined;
}

/**
 * Queue class for named execution queues.
 *
 * @example
 * ```typescript
 * import { Queue, defineWorkflow } from '@polos/sdk';
 *
 * const dbQueue = new Queue('database-ops', { concurrencyLimit: 5 });
 *
 * const dbWorkflow = defineWorkflow({
 *   id: 'db-operation',
 *   queue: dbQueue,
 * }, async (ctx, payload) => {
 *   // ...
 * });
 * ```
 */
export class Queue {
  /** Queue name */
  readonly name: string;

  /** Maximum concurrent executions (undefined = no limit) */
  readonly concurrencyLimit?: number | undefined;

  constructor(name: string, options?: QueueOptions) {
    this.name = name;
    this.concurrencyLimit = options?.concurrencyLimit;
  }

  /**
   * Convert to queue configuration object.
   */
  toConfig(): QueueConfig {
    const config: QueueConfig = { name: this.name };
    if (this.concurrencyLimit !== undefined) {
      config.concurrencyLimit = this.concurrencyLimit;
    }
    return config;
  }
}

/**
 * Queue configuration object (used in workflow config).
 */
export interface QueueConfig {
  /** Queue name */
  name: string;
  /** Maximum concurrent executions */
  concurrencyLimit?: number | undefined;
}

/**
 * Normalize queue configuration from various input formats.
 */
export function normalizeQueueConfig(
  queue: string | Queue | QueueConfig | undefined
): QueueConfig | undefined {
  if (queue === undefined) {
    return undefined;
  }

  if (typeof queue === 'string') {
    return { name: queue };
  }

  if (queue instanceof Queue) {
    return queue.toConfig();
  }

  return queue;
}

/**
 * Default queue name.
 */
export const DEFAULT_QUEUE = 'default';

/**
 * Get the queue name from various input formats.
 */
export function getQueueName(queue: string | Queue | QueueConfig | undefined): string {
  if (queue === undefined) {
    return DEFAULT_QUEUE;
  }

  if (typeof queue === 'string') {
    return queue;
  }

  if (queue instanceof Queue) {
    return queue.name;
  }

  return queue.name;
}
