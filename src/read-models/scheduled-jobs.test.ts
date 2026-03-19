import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ScheduledJobStore } from "./scheduled-jobs";
import { JobRegistered, JobTriggered, JobRunCompleted, JobRunFailed, JobDisabled, JobEnabled } from "../domain/scheduled-job/events";

function makeStore(): ScheduledJobStore {
  const store = new ScheduledJobStore();
  store.apply(new JobRegistered(
    "job-1", "Test Job", "*/5 * * * *",
    { title: "Test", description: "Test task", category: "monitoring", priority: "normal" },
    "A test job", "UTC", true, 1, false, 5, "2026-03-18T00:00:00Z"
  ));
  return store;
}

describe("ScheduledJobStore", () => {
  it("should apply JobRegistered event", () => {
    const store = makeStore();
    const job = store.get("job-1");
    assert.ok(job);
    assert.equal(job.name, "Test Job");
    assert.equal(job.enabled, true);
    assert.equal(job.runCount, 0);
    assert.equal(job.failCount, 0);
    assert.equal(job.consecutiveFailures, 0);
    assert.ok(job.nextRunAt);
  });

  it("should apply JobTriggered event", () => {
    const store = makeStore();
    store.apply(new JobTriggered("job-1", "2026-03-18T00:05:00Z", "run-1"));
    const job = store.get("job-1")!;
    assert.equal(job.lastRunAt, "2026-03-18T00:05:00Z");
    assert.equal(job.runHistory.length, 1);
    assert.equal(job.runHistory[0].runId, "run-1");
    assert.equal(job.runHistory[0].status, "running");
  });

  it("should apply JobRunCompleted event", () => {
    const store = makeStore();
    store.apply(new JobTriggered("job-1", "2026-03-18T00:05:00Z", "run-1"));
    store.apply(new JobRunCompleted("job-1", "run-1", { ok: true }, "2026-03-18T00:05:30Z"));
    const job = store.get("job-1")!;
    assert.equal(job.runCount, 1);
    assert.equal(job.consecutiveFailures, 0);
    assert.equal(job.runHistory[0].status, "completed");
    assert.ok(job.runHistory[0].durationMs! > 0);
  });

  it("should apply JobRunFailed event", () => {
    const store = makeStore();
    store.apply(new JobTriggered("job-1", "2026-03-18T00:05:00Z", "run-1"));
    store.apply(new JobRunFailed("job-1", "run-1", "timeout", "2026-03-18T00:06:00Z"));
    const job = store.get("job-1")!;
    assert.equal(job.runCount, 1);
    assert.equal(job.failCount, 1);
    assert.equal(job.consecutiveFailures, 1);
    assert.equal(job.runHistory[0].status, "failed");
    assert.equal(job.runHistory[0].error, "timeout");
  });

  it("should apply JobDisabled event", () => {
    const store = makeStore();
    store.apply(new JobDisabled("job-1", "test", "2026-03-18T01:00:00Z"));
    const job = store.get("job-1")!;
    assert.equal(job.enabled, false);
    assert.equal(job.nextRunAt, null);
  });

  it("should apply JobEnabled event", () => {
    const store = makeStore();
    store.apply(new JobDisabled("job-1", "test", "2026-03-18T01:00:00Z"));
    store.apply(new JobEnabled("job-1", "2026-03-18T02:00:00Z"));
    const job = store.get("job-1")!;
    assert.equal(job.enabled, true);
    assert.ok(job.nextRunAt);
    assert.equal(job.consecutiveFailures, 0);
  });

  it("should keep only last 10 runs in history", () => {
    const store = makeStore();
    for (let i = 0; i < 12; i++) {
      store.apply(new JobTriggered("job-1", `2026-03-18T00:${String(i).padStart(2, "0")}:00Z`, `run-${i}`));
    }
    const job = store.get("job-1")!;
    assert.equal(job.runHistory.length, 10);
  });

  it("should filter by enabled status", () => {
    const store = new ScheduledJobStore();
    store.apply(new JobRegistered(
      "j1", "Enabled", "* * * * *",
      { title: "T", description: "", category: "monitoring", priority: "normal" },
      "", "UTC", true, 1, false, 5, "2026-03-18T00:00:00Z"
    ));
    store.apply(new JobRegistered(
      "j2", "Disabled", "* * * * *",
      { title: "T", description: "", category: "code", priority: "normal" },
      "", "UTC", false, 1, false, 5, "2026-03-18T00:00:00Z"
    ));

    const enabled = store.list({ enabled: true });
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].jobId, "j1");

    const disabled = store.list({ enabled: false });
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].jobId, "j2");
  });

  it("should filter by category", () => {
    const store = new ScheduledJobStore();
    store.apply(new JobRegistered(
      "j1", "Mon", "* * * * *",
      { title: "T", description: "", category: "monitoring", priority: "normal" },
      "", "UTC", true, 1, false, 5, "2026-03-18T00:00:00Z"
    ));
    store.apply(new JobRegistered(
      "j2", "Code", "* * * * *",
      { title: "T", description: "", category: "code", priority: "normal" },
      "", "UTC", true, 1, false, 5, "2026-03-18T00:00:00Z"
    ));

    const monitoring = store.list({ category: "monitoring" });
    assert.equal(monitoring.length, 1);
    assert.equal(monitoring[0].jobId, "j1");
  });

  it("should return all jobs via getAll()", () => {
    const store = makeStore();
    const all = store.getAll();
    assert.equal(all.length, 1);
  });
});
