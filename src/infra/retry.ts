/**
 * Retry Strategy with Exponential Backoff.
 *
 * Wraps async operations with configurable retry logic including:
 * - Exponential backoff with jitter
 * - Configurable max retries and delays
 * - Error classification (only retries transient errors by default)
 * - Callback hook for retry events
 */

import { classifyError, isTransient } from "./error-classification";
import { createLogger } from "./logger";

const log = createLogger("retry");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in ms before first retry (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Error codes/messages that should be retried. If unset, uses error classification. */
  retryableErrors?: string[];
  /** Callback invoked on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calculate delay with exponential backoff and jitter */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const capped = Math.min(exponentialDelay, config.maxDelayMs);
  // Add jitter: ±25% randomization to prevent thundering herd
  const jitter = capped * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/** Determine if an error should be retried based on config */
function shouldRetry(error: Error, config: RetryConfig): boolean {
  // If specific retryable errors are configured, check against those
  if (config.retryableErrors && config.retryableErrors.length > 0) {
    const msg = error.message.toLowerCase();
    const code = (error as Record<string, unknown>).code as string | undefined;
    return config.retryableErrors.some(
      (pattern) => msg.includes(pattern.toLowerCase()) || code === pattern
    );
  }

  // Default: use error classification
  return isTransient(error);
}

// ---------------------------------------------------------------------------
// Main retry function
// ---------------------------------------------------------------------------

/**
 * Execute an async function with retry logic and exponential backoff.
 *
 * Only retries transient errors by default (network timeouts, rate limits, 5xx).
 * Permanent errors (4xx, validation) fail immediately.
 * Fatal errors (disk full, OOM) fail immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const cfg: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Don't retry on last attempt
      if (attempt === cfg.maxRetries) break;

      // Don't retry permanent/fatal errors
      if (!shouldRetry(error, cfg)) {
        const classified = classifyError(error);
        log.debug("Non-retryable error, failing immediately", {
          category: classified.category,
          error: error.message,
        });
        break;
      }

      const delayMs = calculateDelay(attempt, cfg);

      // Notify callback
      if (cfg.onRetry) {
        cfg.onRetry(attempt + 1, error, delayMs);
      }

      log.warn("Retrying after transient error", {
        attempt: attempt + 1,
        maxRetries: cfg.maxRetries,
        delayMs,
        error: error.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError!;
}
