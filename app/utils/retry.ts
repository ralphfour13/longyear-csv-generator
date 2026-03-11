/**
 * Retry utility for handling transient API failures
 */

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
  onRetry: () => {},
};

/**
 * Retry a function with exponential backoff
 *
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Result of the function
 * @throws Last error if all attempts fail
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.delayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === opts.maxAttempts) {
        // Last attempt failed, throw error
        throw lastError;
      }

      // Call retry callback
      opts.onRetry(attempt, lastError);

      // Wait before retrying
      await sleep(delay);

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with specific error handling
 *
 * @param fn - Async function to retry
 * @param shouldRetry - Function to determine if error is retryable
 * @param options - Retry options
 */
export async function retryWithCondition<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: Error) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.delayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      if (attempt === opts.maxAttempts) {
        throw lastError;
      }

      opts.onRetry(attempt, lastError);
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Check if error is a network/transient error that should be retried
 */
export function isRetryableError(error: Error): boolean {
  const retryablePatterns = [
    /network/i,
    /timeout/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /rate limit/i,
    /429/,
    /500/,
    /502/,
    /503/,
    /504/,
  ];

  const errorMessage = error.message || error.toString();

  return retryablePatterns.some((pattern) => pattern.test(errorMessage));
}

/**
 * Retry Shopify API calls with rate limit handling
 */
export async function retryShopifyAPI<T>(
  fn: () => Promise<T>,
  context: string = 'Shopify API'
): Promise<T> {
  const startTime = Date.now();
  console.log(`[Retry] ${context} - Starting API call`);

  try {
    const result = await retryWithCondition(
      fn,
      isRetryableError,
      {
        maxAttempts: 5,
        delayMs: 2000,
        backoffMultiplier: 2,
        maxDelayMs: 30000,
        onRetry: (attempt, error) => {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          console.warn(
            `[Retry] ${context} - Attempt ${attempt}/5 failed: ${error.message}. Retrying in ${delay}ms...`
          );
        },
      }
    );

    const duration = Date.now() - startTime;
    console.log(`[Retry] ${context} - Success after ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[Retry] ${context} - Failed after ${duration}ms and 5 attempts:`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
