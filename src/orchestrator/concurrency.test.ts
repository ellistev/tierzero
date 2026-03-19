import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyManager } from "./concurrency";

describe("ConcurrencyManager", () => {
  it("should acquire and release slots", () => {
    const cm = new ConcurrencyManager(5);
    cm.setLimit("code", 2);

    assert.equal(cm.acquire("code"), true);
    assert.equal(cm.acquire("code"), true);
    assert.equal(cm.acquire("code"), false); // at per-type limit

    cm.release("code");
    assert.equal(cm.acquire("code"), true);
  });

  it("should respect global total limit", () => {
    const cm = new ConcurrencyManager(2);
    cm.setLimit("code", 5);
    cm.setLimit("research", 5);

    assert.equal(cm.acquire("code"), true);
    assert.equal(cm.acquire("research"), true);
    assert.equal(cm.acquire("code"), false); // global limit hit
    assert.equal(cm.acquire("research"), false);

    cm.release("code");
    assert.equal(cm.acquire("research"), true);
  });

  it("should check availability without acquiring", () => {
    const cm = new ConcurrencyManager(3);
    cm.setLimit("code", 1);

    assert.equal(cm.available("code"), true);
    cm.acquire("code");
    assert.equal(cm.available("code"), false);
    cm.release("code");
    assert.equal(cm.available("code"), true);
  });

  it("should allow unlimited per-type when no limit set", () => {
    const cm = new ConcurrencyManager(3);
    // No setLimit for "code" - only global limit applies
    assert.equal(cm.acquire("code"), true);
    assert.equal(cm.acquire("code"), true);
    assert.equal(cm.acquire("code"), true);
    assert.equal(cm.acquire("code"), false); // global limit
  });

  it("should report utilization", () => {
    const cm = new ConcurrencyManager(5);
    cm.setLimit("code", 3);
    cm.setLimit("research", 2);

    cm.acquire("code");
    cm.acquire("code");
    cm.acquire("research");

    const util = cm.utilization();
    assert.equal(util.total, 3);
    assert.equal(util.max, 5);
    assert.equal(util.byType.code.running, 2);
    assert.equal(util.byType.code.max, 3);
    assert.equal(util.byType.research.running, 1);
    assert.equal(util.byType.research.max, 2);
  });

  it("should not go below zero on release", () => {
    const cm = new ConcurrencyManager(5);
    cm.setLimit("code", 2);

    cm.release("code"); // release without acquire
    const util = cm.utilization();
    assert.equal(util.total, 0);
    assert.equal(util.byType.code.running, 0);
  });
});
