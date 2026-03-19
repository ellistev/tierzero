/**
 * Error Classification.
 *
 * Classifies errors as transient, permanent, or fatal to determine
 * appropriate handling strategy (retry, fail immediately, or shutdown).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorCategory = "transient" | "permanent" | "fatal";

export interface ClassifiedError {
  category: ErrorCategory;
  original: Error;
  code?: string;
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Status code classification
// ---------------------------------------------------------------------------

/** HTTP status codes that indicate a transient error (worth retrying) */
const TRANSIENT_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/** HTTP status codes that indicate a permanent error (do not retry) */
const PERMANENT_STATUS_CODES = new Set([
  400, // Bad Request
  401, // Unauthorized
  403, // Forbidden
  404, // Not Found
  405, // Method Not Allowed
  409, // Conflict
  410, // Gone
  422, // Unprocessable Entity
]);

// ---------------------------------------------------------------------------
// Error message patterns
// ---------------------------------------------------------------------------

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ENETUNREACH/,
  /socket hang up/i,
  /network/i,
  /rate limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /EPIPE/,
  /EHOSTUNREACH/,
];

const FATAL_PATTERNS = [
  /ENOSPC/,          // Disk full
  /ENOMEM/,          // Out of memory
  /corrupt/i,
  /out of memory/i,
  /disk full/i,
  /EMFILE/,          // Too many open files
];

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

function extractStatusCode(error: Error): number | undefined {
  const msg = error.message;
  // Match patterns like "GitHub 404 Not Found" or "HTTP 503"
  const match = msg.match(/\b([1-5]\d{2})\b/);
  if (match) return Number(match[1]);

  // Check for statusCode property (common in HTTP error objects)
  const anyErr = error as Record<string, unknown>;
  if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
  if (typeof anyErr.status === "number") return anyErr.status;

  return undefined;
}

function extractCode(error: Error): string | undefined {
  const anyErr = error as Record<string, unknown>;
  if (typeof anyErr.code === "string") return anyErr.code;
  return undefined;
}

/**
 * Classify an error to determine the appropriate handling strategy.
 *
 * - **transient**: Network timeouts, rate limits, 5xx errors → retry with backoff
 * - **permanent**: 4xx errors, validation errors → fail immediately
 * - **fatal**: Disk full, out of memory, corrupt state → shutdown gracefully
 */
export function classifyError(error: Error): ClassifiedError {
  const statusCode = extractStatusCode(error);
  const code = extractCode(error);
  const msg = error.message;

  // Check fatal patterns first (most critical)
  for (const pattern of FATAL_PATTERNS) {
    if (pattern.test(msg) || (code && pattern.test(code))) {
      return { category: "fatal", original: error, code, statusCode };
    }
  }

  // Check status codes
  if (statusCode !== undefined) {
    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      return { category: "transient", original: error, code, statusCode };
    }
    if (PERMANENT_STATUS_CODES.has(statusCode)) {
      return { category: "permanent", original: error, code, statusCode };
    }
  }

  // Check transient message patterns
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(msg) || (code && pattern.test(code))) {
      return { category: "transient", original: error, code, statusCode };
    }
  }

  // Default: treat unknown errors as permanent (don't retry blindly)
  return { category: "permanent", original: error, code, statusCode };
}

/** Quick check: is this error worth retrying? */
export function isTransient(error: Error): boolean {
  return classifyError(error).category === "transient";
}

/** Quick check: is this error fatal (should trigger shutdown)? */
export function isFatal(error: Error): boolean {
  return classifyError(error).category === "fatal";
}
