/**
 * Exponential backoff retry utilities.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Add random jitter to delays (default: true) */
  jitter?: boolean;
  /** Function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: unknown) => boolean;
  /** Callback called before each retry */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate delay for a given attempt with exponential backoff.
 */
export function calculateDelay(
  attempt: number,
  options: Pick<RetryOptions, 'baseDelay' | 'maxDelay' | 'backoffMultiplier' | 'jitter'>
): number {
  const { baseDelay = 1000, maxDelay = 30000, backoffMultiplier = 2, jitter = true } = options;

  // Exponential backoff: baseDelay * (multiplier ^ attempt)
  let delay = baseDelay * Math.pow(backoffMultiplier, attempt);

  // Cap at maxDelay
  delay = Math.min(delay, maxDelay);

  // Add jitter (±25%)
  if (jitter) {
    const jitterRange = delay * 0.25;
    delay = delay - jitterRange + Math.random() * jitterRange * 2;
  }

  return Math.round(delay);
}

/**
 * Sleep for a given duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff retry.
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => fetchData(),
 *   {
 *     maxRetries: 3,
 *     baseDelay: 1000,
 *     isRetryable: (err) => err instanceof NetworkError,
 *   }
 * );
 * ```
 */
export async function retry<T>(fn: () => T | Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Check if error is retryable
      if (opts.isRetryable && !opts.isRetryable(error)) {
        break;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts);

      // Call onRetry callback
      opts.onRetry?.(error, attempt + 1, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper with preset options.
 *
 * @example
 * ```typescript
 * const retryWithBackoff = createRetry({ maxRetries: 5 });
 * const result = await retryWithBackoff(() => fetchData());
 * ```
 */
export function createRetry(defaultOptions: RetryOptions) {
  return <T>(fn: () => T | Promise<T>, options?: RetryOptions): Promise<T> => {
    return retry(fn, { ...defaultOptions, ...options });
  };
}
