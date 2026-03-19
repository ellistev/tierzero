/**
 * Circuit Breaker.
 *
 * Prevents cascading failures by tracking consecutive errors and
 * short-circuiting calls to unhealthy services.
 *
 * States:
 * - **closed**: Normal operation, requests pass through
 * - **open**: Service is down, requests fail immediately
 * - **half-open**: After cooldown, one probe request is allowed through
 */

import { createLogger } from "./logger";

const log = createLogger("circuit-breaker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Cooldown period in ms before transitioning to half-open (default: 30000) */
  cooldownMs: number;
  /** Name for logging/identification */
  name: string;
  /** Callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — service unavailable`);
    this.name = "CircuitBreakerOpenError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private _state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = {
      failureThreshold: 5,
      cooldownMs: 30_000,
      ...config,
    };
  }

  get state(): CircuitState {
    // Check if cooldown has elapsed while in open state
    if (this._state === "open" && this.cooldownElapsed()) {
      this.transition("half-open");
    }
    return this._state;
  }

  get failures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * - **closed**: Execute normally; track failures
   * - **open**: Fail immediately with CircuitBreakerOpenError
   * - **half-open**: Allow one probe; success closes, failure re-opens
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // triggers cooldown check

    if (currentState === "open") {
      throw new CircuitBreakerOpenError(this.config.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Manually reset the circuit breaker to closed state */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    if (this._state !== "closed") {
      this.transition("closed");
    }
  }

  private onSuccess(): void {
    if (this._state === "half-open") {
      log.info("Half-open probe succeeded, closing circuit", { name: this.config.name });
      this.consecutiveFailures = 0;
      this.transition("closed");
    } else {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this._state === "half-open") {
      log.warn("Half-open probe failed, re-opening circuit", { name: this.config.name });
      this.transition("open");
    } else if (this.consecutiveFailures >= this.config.failureThreshold) {
      log.warn("Failure threshold reached, opening circuit", {
        name: this.config.name,
        failures: this.consecutiveFailures,
        threshold: this.config.failureThreshold,
      });
      this.transition("open");
    }
  }

  private cooldownElapsed(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.cooldownMs;
  }

  private transition(to: CircuitState): void {
    const from = this._state;
    this._state = to;
    log.debug("Circuit state change", { name: this.config.name, from, to });
    if (this.config.onStateChange) {
      this.config.onStateChange(from, to, this.config.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Registry for managing circuit breakers across the application
// ---------------------------------------------------------------------------

const registry = new Map<string, CircuitBreaker>();

/** Get or create a circuit breaker by name */
export function getCircuitBreaker(config: Partial<CircuitBreakerConfig> & { name: string }): CircuitBreaker {
  let cb = registry.get(config.name);
  if (!cb) {
    cb = new CircuitBreaker(config);
    registry.set(config.name, cb);
  }
  return cb;
}

/** Get all circuit breakers (for monitoring/dashboard) */
export function getAllCircuitBreakers(): Map<string, CircuitBreaker> {
  return new Map(registry);
}

/** Clear the registry (for testing) */
export function resetCircuitBreakers(): void {
  registry.clear();
}
