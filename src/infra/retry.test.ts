import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "./retry";
import { resetRootLogger } from "./logger";

// Suppress log output during tests
beforeEach(() => resetRootLogger());

describe("withRetry", () => {
  it("returns result on first attempt if no error", async () => {
    const result = await withRetry(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  it("retries on transient error and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error("Connection timeout");
        return Promise.resolve("success");
      },
      { baseDelayMs: 1, maxDelayMs: 5 },
    );
    assert.equal(result, "success");
    assert.equal(attempts, 3);
  });

  it("respects maxRetries and throws after exhausting retries", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            throw new Error("ECONNREFUSED");
          },
          { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 },
        ),
      { message: "ECONNREFUSED" },
    );
    // 1 initial + 2 retries = 3 total attempts
    assert.equal(attempts, 3);
  });

  it("does not retry permanent errors", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            throw new Error("GitHub 404 Not Found: issue does not exist");
          },
          { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 },
        ),
      { message: /404 Not Found/ },
    );
    assert.equal(attempts, 1);
  });

  it("does not retry fatal errors", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            throw new Error("ENOSPC: no space left on device");
          },
          { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 },
        ),
    );
    assert.equal(attempts, 1);
  });

  it("calls onRetry callback for each retry", async () => {
    const retries: Array<{ attempt: number; error: string; delayMs: number }> = [];
    let attempts = 0;

    await assert.rejects(() =>
      withRetry(
        () => {
          attempts++;
          throw new Error("socket hang up");
        },
        {
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 5,
          onRetry: (attempt, error, delayMs) => {
            retries.push({ attempt, error: error.message, delayMs });
          },
        },
      ),
    );

    assert.equal(retries.length, 2);
    assert.equal(retries[0].attempt, 1);
    assert.equal(retries[1].attempt, 2);
    assert.equal(retries[0].error, "socket hang up");
  });

  it("uses custom retryableErrors list", async () => {
    let attempts = 0;
    await assert.rejects(() =>
      withRetry(
        () => {
          attempts++;
          throw new Error("Custom error: RATE_LIMITED");
        },
        {
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 5,
          retryableErrors: ["RATE_LIMITED"],
        },
      ),
    );
    // Should retry because RATE_LIMITED is in the list
    assert.equal(attempts, 3);
  });

  it("does not retry errors not in retryableErrors list", async () => {
    let attempts = 0;
    await assert.rejects(() =>
      withRetry(
        () => {
          attempts++;
          throw new Error("Some random error");
        },
        {
          maxRetries: 3,
          baseDelayMs: 1,
          maxDelayMs: 5,
          retryableErrors: ["RATE_LIMITED", "TIMEOUT"],
        },
      ),
    );
    assert.equal(attempts, 1);
  });

  it("applies exponential backoff with increasing delays", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await assert.rejects(() =>
      withRetry(
        () => {
          attempts++;
          throw new Error("ECONNRESET");
        },
        {
          maxRetries: 3,
          baseDelayMs: 100,
          maxDelayMs: 10000,
          backoffMultiplier: 2,
          onRetry: (_attempt, _error, delayMs) => {
            delays.push(delayMs);
          },
        },
      ),
    );

    assert.equal(delays.length, 3);
    // Delays should generally increase (with jitter they may not be exact)
    // Base: 100, 200, 400 (±25% jitter)
    assert.ok(delays[0] >= 75 && delays[0] <= 125, `First delay ${delays[0]} not in range [75, 125]`);
    assert.ok(delays[1] >= 150 && delays[1] <= 250, `Second delay ${delays[1]} not in range [150, 250]`);
    assert.ok(delays[2] >= 300 && delays[2] <= 500, `Third delay ${delays[2]} not in range [300, 500]`);
  });

  it("caps delay at maxDelayMs", async () => {
    const delays: number[] = [];

    await assert.rejects(() =>
      withRetry(
        () => {
          throw new Error("ECONNRESET");
        },
        {
          maxRetries: 5,
          baseDelayMs: 1000,
          maxDelayMs: 50,
          backoffMultiplier: 10,
          onRetry: (_attempt, _error, delayMs) => {
            delays.push(delayMs);
          },
        },
      ),
    );

    // All delays should be capped at maxDelayMs (50) ± 25% jitter
    for (const delay of delays) {
      assert.ok(delay <= 63, `Delay ${delay} exceeds max with jitter`);
    }
  });
});
