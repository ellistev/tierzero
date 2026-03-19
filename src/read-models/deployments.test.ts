import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeploymentStore } from "./deployments";
import {
  DeployInitiated,
  DeploySucceeded,
  DeployFailed,
  RollbackInitiated,
  RollbackCompleted,
} from "../domain/deployment/events";

describe("DeploymentStore", () => {
  it("creates record on DeployInitiated", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z"));

    const record = store.get("d1");
    assert.ok(record);
    assert.equal(record.deployId, "d1");
    assert.equal(record.environment, "staging");
    assert.equal(record.version, "abc123");
    assert.equal(record.strategy, "direct");
    assert.equal(record.status, "initiated");
    assert.equal(record.healthCheckPassed, false);
    assert.equal(record.error, null);
    assert.equal(record.completedAt, null);
  });

  it("updates record on DeploySucceeded", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeploySucceeded("d1", true, "2024-01-01T00:01:00Z"));

    const record = store.get("d1");
    assert.ok(record);
    assert.equal(record.status, "succeeded");
    assert.equal(record.healthCheckPassed, true);
    assert.equal(record.completedAt, "2024-01-01T00:01:00Z");
    assert.equal(record.durationMs, 60000);
  });

  it("updates record on DeployFailed", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeployFailed("d1", "Health check failed", "2024-01-01T00:00:30Z"));

    const record = store.get("d1");
    assert.ok(record);
    assert.equal(record.status, "failed");
    assert.equal(record.error, "Health check failed");
    assert.equal(record.durationMs, 30000);
  });

  it("tracks rollback lifecycle", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "production", "abc123", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeployFailed("d1", "crash", "2024-01-01T00:00:30Z"));
    store.apply(new RollbackInitiated("d1", "Health check failed", "2024-01-01T00:00:31Z"));

    let record = store.get("d1");
    assert.ok(record);
    assert.equal(record.status, "rolling_back");

    store.apply(new RollbackCompleted("d1", "prev-abc", "2024-01-01T00:01:00Z"));
    record = store.get("d1");
    assert.ok(record);
    assert.equal(record.status, "rolled_back");
    assert.equal(record.restoredVersion, "prev-abc");
    assert.equal(record.durationMs, 60000);
  });

  it("filters by environment", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "v1", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeployInitiated("d2", "production", "v1", "direct", "2024-01-01T00:01:00Z"));
    store.apply(new DeployInitiated("d3", "staging", "v2", "direct", "2024-01-01T00:02:00Z"));

    const staging = store.list({ environment: "staging" });
    assert.equal(staging.length, 2);
    assert.ok(staging.every(r => r.environment === "staging"));
  });

  it("filters by status", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "v1", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeploySucceeded("d1", true, "2024-01-01T00:01:00Z"));
    store.apply(new DeployInitiated("d2", "staging", "v2", "direct", "2024-01-01T00:02:00Z"));
    store.apply(new DeployFailed("d2", "error", "2024-01-01T00:03:00Z"));

    const succeeded = store.list({ status: "succeeded" });
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0].deployId, "d1");

    const failed = store.list({ status: "failed" });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].deployId, "d2");
  });

  it("filters by version", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "v1", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeployInitiated("d2", "staging", "v2", "direct", "2024-01-01T00:01:00Z"));

    const v1 = store.list({ version: "v1" });
    assert.equal(v1.length, 1);
    assert.equal(v1[0].version, "v1");
  });

  it("supports pagination", () => {
    const store = new DeploymentStore();
    for (let i = 0; i < 5; i++) {
      store.apply(new DeployInitiated(`d${i}`, "staging", `v${i}`, "direct", `2024-01-0${i + 1}T00:00:00Z`));
    }

    const page1 = store.list({ limit: 2, offset: 0 });
    assert.equal(page1.length, 2);

    const page2 = store.list({ limit: 2, offset: 2 });
    assert.equal(page2.length, 2);

    const page3 = store.list({ limit: 2, offset: 4 });
    assert.equal(page3.length, 1);
  });

  it("getByEnvironment returns records for specific env", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "v1", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeployInitiated("d2", "production", "v1", "direct", "2024-01-01T00:01:00Z"));

    const staging = store.getByEnvironment("staging");
    assert.equal(staging.length, 1);
    assert.equal(staging[0].environment, "staging");
  });

  it("returns undefined for unknown deployId", () => {
    const store = new DeploymentStore();
    assert.equal(store.get("nonexistent"), undefined);
  });

  it("returns copies to prevent mutation", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "v1", "direct", "2024-01-01T00:00:00Z"));

    const record1 = store.get("d1");
    const record2 = store.get("d1");
    assert.ok(record1);
    assert.ok(record2);
    assert.notEqual(record1, record2);
    assert.deepEqual(record1, record2);
  });

  it("computes stats", () => {
    const store = new DeploymentStore();
    store.apply(new DeployInitiated("d1", "staging", "v1", "direct", "2024-01-01T00:00:00Z"));
    store.apply(new DeploySucceeded("d1", true, "2024-01-01T00:01:00Z"));
    store.apply(new DeployInitiated("d2", "staging", "v2", "direct", "2024-01-01T00:02:00Z"));
    store.apply(new DeployFailed("d2", "error", "2024-01-01T00:02:30Z"));
    store.apply(new DeployInitiated("d3", "production", "v1", "direct", "2024-01-01T00:03:00Z"));
    store.apply(new DeploySucceeded("d3", true, "2024-01-01T00:04:00Z"));

    const allStats = store.stats();
    assert.equal(allStats.total, 3);
    assert.equal(allStats.succeeded, 2);
    assert.equal(allStats.failed, 1);

    const stagingStats = store.stats("staging");
    assert.equal(stagingStats.total, 2);
    assert.equal(stagingStats.succeeded, 1);
    assert.equal(stagingStats.failed, 1);
    assert.ok(stagingStats.avgDurationMs > 0);
  });

  it("ignores events for unknown deployIds", () => {
    const store = new DeploymentStore();
    store.apply(new DeploySucceeded("unknown", true, "2024-01-01T00:00:00Z"));
    assert.equal(store.getAll().length, 0);
  });
});
