import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  resetCircuitBreakers,
  getCircuitBreaker,
} from "./circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => resetCircuitBreakers());

  it("starts in closed state", () => {
    const cb = new CircuitBreaker({ name: "test" });
    assert.equal(cb.state, "closed");
  });

  it("passes through calls when closed", async () => {
    const cb = new CircuitBreaker({ name: "test" });
    const result = await cb.execute(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  it("opens after N consecutive failures", async () => {
    const cb = new CircuitBreaker({ name: "test", failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    }

    assert.equal(cb.state, "open");
  });

  it("throws CircuitBreakerOpenError when open", async () => {
    const cb = new CircuitBreaker({ name: "test", failureThreshold: 1 });

    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    assert.equal(cb.state, "open");

    await assert.rejects(
      () => cb.execute(() => Promise.resolve("should not reach")),
      (err: unknown) => {
        assert.ok(err instanceof CircuitBreakerOpenError);
        assert.match(err.message, /circuit breaker "test" is open/i);
        return true;
      },
    );
  });

  it("does not open if failures are not consecutive", async () => {
    const cb = new CircuitBreaker({ name: "test", failureThreshold: 3 });

    // 2 failures
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));

    // 1 success resets the count
    await cb.execute(() => Promise.resolve("ok"));

    // 2 more failures (total non-consecutive: 4, but consecutive: 2)
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));

    assert.equal(cb.state, "closed"); // still closed, only 2 consecutive
  });

  it("transitions to half-open after cooldown", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      cooldownMs: 10,
    });

    // Open the circuit
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    assert.equal(cb.state, "open");

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(cb.state, "half-open");
  });

  it("closes on successful half-open probe", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      cooldownMs: 10,
    });

    // Open the circuit
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cb.state, "half-open");

    // Successful probe closes the circuit
    const result = await cb.execute(() => Promise.resolve("recovered"));
    assert.equal(result, "recovered");
    assert.equal(cb.state, "closed");
  });

  it("re-opens on failed half-open probe", async () => {
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      cooldownMs: 10,
    });

    // Open the circuit
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cb.state, "half-open");

    // Failed probe re-opens
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("still failing"))));
    assert.equal(cb.state, "open");
  });

  it("calls onStateChange callback on transitions", async () => {
    const transitions: Array<{ from: string; to: string }> = [];
    const cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      cooldownMs: 10,
      onStateChange: (from, to) => transitions.push({ from, to }),
    });

    // Open: closed -> open
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    assert.equal(transitions.length, 1);
    assert.deepEqual(transitions[0], { from: "closed", to: "open" });

    // Wait for cooldown: open -> half-open
    await new Promise((resolve) => setTimeout(resolve, 20));
    cb.state; // trigger cooldown check
    assert.equal(transitions.length, 2);
    assert.deepEqual(transitions[1], { from: "open", to: "half-open" });

    // Success: half-open -> closed
    await cb.execute(() => Promise.resolve("ok"));
    assert.equal(transitions.length, 3);
    assert.deepEqual(transitions[2], { from: "half-open", to: "closed" });
  });

  it("can be manually reset", async () => {
    const cb = new CircuitBreaker({ name: "test", failureThreshold: 1 });

    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("fail"))));
    assert.equal(cb.state, "open");

    cb.reset();
    assert.equal(cb.state, "closed");
    assert.equal(cb.failures, 0);

    // Should work again
    const result = await cb.execute(() => Promise.resolve("ok"));
    assert.equal(result, "ok");
  });

  describe("getCircuitBreaker registry", () => {
    it("returns same instance for same name", () => {
      const cb1 = getCircuitBreaker({ name: "github" });
      const cb2 = getCircuitBreaker({ name: "github" });
      assert.equal(cb1, cb2);
    });

    it("returns different instances for different names", () => {
      const cb1 = getCircuitBreaker({ name: "github" });
      const cb2 = getCircuitBreaker({ name: "jira" });
      assert.notEqual(cb1, cb2);
    });
  });
});
