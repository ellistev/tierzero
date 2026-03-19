/**
 * E2E tests for the resilience stack: retry + circuit breaker + dead letter queue.
 *
 * Simulates API failures at each stage and verifies retry → eventual success
 * or graceful failure with dead letter capture.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withRetry } from "./retry";
import { CircuitBreaker, CircuitBreakerOpenError } from "./circuit-breaker";
import { DeadLetterQueue } from "./dead-letter";
import { classifyError } from "./error-classification";

describe("resilience e2e", () => {
  let dir: string;
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "resilience-e2e-"));
    dlq = new DeadLetterQueue({ directory: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("retry succeeds after transient failures", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls <= 2) throw new Error("Connection timeout");
        return "data from API";
      },
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 },
    );

    assert.equal(result, "data from API");
    assert.equal(calls, 3);
  });

  it("retry + circuit breaker + dead letter on persistent failure", async () => {
    const cb = new CircuitBreaker({ name: "e2e-github", failureThreshold: 3, cooldownMs: 50 });
    const operation = "github.createPR";
    let totalAttempts = 0;

    // Simulate an operation that always fails with a transient error
    async function createPR(): Promise<string> {
      return cb.execute(async () => {
        totalAttempts++;
        throw new Error("GitHub 503 Service Unavailable");
      });
    }

    // Retry wrapping the circuit-breaker-protected operation
    try {
      await withRetry(createPR, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err instanceof Error);

      // After enough failures, circuit breaker should be open
      // (3 retries + 1 initial = 4 attempts, threshold is 3)
      // The CB may have opened during retries
      const classified = classifyError(err);
      assert.ok(
        classified.category === "transient" || err instanceof CircuitBreakerOpenError,
        `Expected transient or circuit breaker error, got: ${err.message}`,
      );

      // Send to dead letter queue
      dlq.add({
        taskId: "issue-42",
        operation,
        error: err,
        retries: 3,
        payload: { owner: "test", repo: "repo", branch: "fix/42" },
      });
    }

    // Verify dead letter was created
    const letters = dlq.list();
    assert.equal(letters.length, 1);
    assert.equal(letters[0].operation, operation);
    assert.equal(letters[0].taskId, "issue-42");
    assert.equal(letters[0].status, "pending");
    assert.ok(totalAttempts >= 3);
  });

  it("circuit breaker prevents further calls when service is down", async () => {
    const cb = new CircuitBreaker({ name: "e2e-jira", failureThreshold: 2, cooldownMs: 1000 });
    let callCount = 0;

    // Exhaust the circuit breaker
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() =>
        cb.execute(async () => {
          callCount++;
          throw new Error("Jira 503");
        }),
      );
    }

    assert.equal(cb.state, "open");
    assert.equal(callCount, 2);

    // Further calls should fail immediately without calling the function
    await assert.rejects(
      () =>
        cb.execute(async () => {
          callCount++;
          return "should not reach";
        }),
      (err: unknown) => err instanceof CircuitBreakerOpenError,
    );

    // The function was NOT called
    assert.equal(callCount, 2);
  });

  it("graceful degradation: pipeline continues when non-critical subsystem fails", async () => {
    const results: string[] = [];

    // Critical operation (must succeed)
    results.push(await withRetry(() => Promise.resolve("code-generated"), { baseDelayMs: 1 }));

    // Non-critical: notification (fails but pipeline continues)
    try {
      await withRetry(
        () => { throw new Error("Slack 503 Service Unavailable"); },
        { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5 },
      );
    } catch {
      results.push("notification-skipped");
    }

    // Non-critical: knowledge store (fails but pipeline continues)
    try {
      await withRetry(
        () => { throw new Error("ChromaDB connection refused"); },
        { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5 },
      );
    } catch {
      results.push("knowledge-skipped");
    }

    // Critical operation continues
    results.push(await withRetry(() => Promise.resolve("pr-created"), { baseDelayMs: 1 }));

    assert.deepEqual(results, [
      "code-generated",
      "notification-skipped",
      "knowledge-skipped",
      "pr-created",
    ]);
  });

  it("dead letter queue captures failed tasks and supports manual retry", () => {
    const letter = dlq.add({
      taskId: "task-99",
      operation: "deploy.ssh",
      error: new Error("SSH connection refused"),
      retries: 3,
      payload: { environment: "staging", host: "10.0.0.1" },
    });

    // Verify it's queryable
    const pending = dlq.list("pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].taskId, "task-99");

    // Manual retry
    const retried = dlq.markRetried(letter.id);
    assert.ok(retried);
    assert.equal(retried.status, "retried");
    assert.ok(retried.retriedAt);

    // No more pending
    assert.equal(dlq.list("pending").length, 0);
    assert.equal(dlq.list("retried").length, 1);
  });

  it("circuit breaker recovers after cooldown", async () => {
    const cb = new CircuitBreaker({ name: "e2e-recover", failureThreshold: 1, cooldownMs: 10 });

    // Trip the breaker
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    assert.equal(cb.state, "open");

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Should transition to half-open and allow a probe
    const result = await cb.execute(() => Promise.resolve("recovered"));
    assert.equal(result, "recovered");
    assert.equal(cb.state, "closed");
  });
});
