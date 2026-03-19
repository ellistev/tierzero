import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetricsCollector } from "./metrics";

describe("MetricsCollector", () => {
  it("should record and retrieve a data point", () => {
    const mc = new MetricsCollector();
    mc.record("tasks.queued", 5);

    const points = mc.query("tasks.queued");
    assert.equal(points.length, 1);
    assert.equal(points[0].value, 5);
    assert.ok(points[0].timestamp);
  });

  it("should record with tags", () => {
    const mc = new MetricsCollector();
    mc.record("tasks.completed", 1, { category: "code" });

    const points = mc.query("tasks.completed");
    assert.equal(points.length, 1);
    assert.deepEqual(points[0].tags, { category: "code" });
  });

  it("should track gauge as latest value", () => {
    const mc = new MetricsCollector();
    mc.record("agents.active", 3);
    mc.record("agents.active", 5);
    mc.record("agents.active", 2);

    assert.equal(mc.gauge("agents.active"), 2);
  });

  it("should return null for unknown gauge", () => {
    const mc = new MetricsCollector();
    assert.equal(mc.gauge("nonexistent"), null);
  });

  it("should return empty array for unknown metric query", () => {
    const mc = new MetricsCollector();
    assert.deepEqual(mc.query("nonexistent"), []);
  });

  it("should filter by time range", () => {
    const mc = new MetricsCollector();

    // Record points at known times
    mc.record("test.metric", 10);
    const points = mc.query("test.metric");
    const ts = points[0].timestamp;

    // Query with startTime in the future should return empty
    const future = new Date(Date.now() + 60000).toISOString();
    const result = mc.query("test.metric", { startTime: future });
    assert.equal(result.length, 0);

    // Query with startTime in the past should return the point
    const past = new Date(Date.now() - 60000).toISOString();
    const result2 = mc.query("test.metric", { startTime: past });
    assert.equal(result2.length, 1);
  });

  it("should filter by endTime", () => {
    const mc = new MetricsCollector();
    mc.record("test.metric", 10);

    const past = new Date(Date.now() - 60000).toISOString();
    const result = mc.query("test.metric", { endTime: past });
    assert.equal(result.length, 0);

    const future = new Date(Date.now() + 60000).toISOString();
    const result2 = mc.query("test.metric", { endTime: future });
    assert.equal(result2.length, 1);
  });

  it("should aggregate with sum", () => {
    const mc = new MetricsCollector();
    mc.record("test.sum", 10);
    mc.record("test.sum", 20);
    mc.record("test.sum", 30);

    const result = mc.query("test.sum", {
      intervalMs: 60000, // 1 minute bucket - all should be in same bucket
      aggregation: "sum",
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].value, 60);
  });

  it("should aggregate with avg", () => {
    const mc = new MetricsCollector();
    mc.record("test.avg", 10);
    mc.record("test.avg", 20);
    mc.record("test.avg", 30);

    const result = mc.query("test.avg", {
      intervalMs: 60000,
      aggregation: "avg",
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].value, 20);
  });

  it("should aggregate with min and max", () => {
    const mc = new MetricsCollector();
    mc.record("test.minmax", 10);
    mc.record("test.minmax", 50);
    mc.record("test.minmax", 30);

    const minResult = mc.query("test.minmax", { intervalMs: 60000, aggregation: "min" });
    assert.equal(minResult[0].value, 10);

    const maxResult = mc.query("test.minmax", { intervalMs: 60000, aggregation: "max" });
    assert.equal(maxResult[0].value, 50);
  });

  it("should aggregate with count", () => {
    const mc = new MetricsCollector();
    mc.record("test.count", 1);
    mc.record("test.count", 2);
    mc.record("test.count", 3);

    const result = mc.query("test.count", { intervalMs: 60000, aggregation: "count" });
    assert.equal(result[0].value, 3);
  });

  it("should enforce ring buffer limit", () => {
    const mc = new MetricsCollector();
    // Record more than 1440 points
    for (let i = 0; i < 1500; i++) {
      mc.record("test.ring", i);
    }

    const points = mc.query("test.ring");
    assert.equal(points.length, 1440);
    // Oldest should have been evicted, so first value should be 60
    assert.equal(points[0].value, 60);
  });

  it("should store multiple metrics independently", () => {
    const mc = new MetricsCollector();
    mc.record("metric.a", 1);
    mc.record("metric.b", 2);

    assert.equal(mc.query("metric.a").length, 1);
    assert.equal(mc.query("metric.b").length, 1);
    assert.equal(mc.gauge("metric.a"), 1);
    assert.equal(mc.gauge("metric.b"), 2);
  });
});
