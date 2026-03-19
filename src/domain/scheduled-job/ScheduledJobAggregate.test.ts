import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ScheduledJobAggregate } from "./ScheduledJobAggregate";
import { RegisterJob, TriggerJob, CompleteJobRun, FailJobRun, DisableJob, EnableJob } from "./commands";
import { JobRegistered, JobTriggered, JobRunCompleted, JobRunFailed, JobDisabled, JobEnabled } from "./events";

function registerJob(agg: ScheduledJobAggregate, overrides?: Partial<{ jobId: string; enabled: boolean; maxConsecutiveFailures: number }>): void {
  const events = agg.execute(new RegisterJob(
    overrides?.jobId ?? "job-1",
    "Test Job",
    "*/5 * * * *",
    { title: "Test", description: "Test task", category: "monitoring", priority: "normal" },
    "A test job",
    "UTC",
    overrides?.enabled ?? true,
    1,
    false,
    overrides?.maxConsecutiveFailures ?? 5,
    "2026-03-18T00:00:00Z"
  ));
  for (const e of events) agg.hydrate(e);
}

describe("ScheduledJobAggregate", () => {
  it("should register a job", () => {
    const agg = new ScheduledJobAggregate();
    const events = agg.execute(new RegisterJob(
      "job-1", "Test Job", "*/5 * * * *",
      { title: "Test", description: "Test task", category: "monitoring", priority: "normal" },
      "A test job", "UTC", true, 1, false, 5, "2026-03-18T00:00:00Z"
    ));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof JobRegistered);
  });

  it("should trigger a job", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg);
    const events = agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:00Z", "run-1"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof JobTriggered);
  });

  it("should reject trigger on disabled job", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg, { enabled: false });
    assert.throws(() => {
      agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:00Z", "run-1"));
    }, /Job is disabled/);
  });

  it("should reject trigger when maxConcurrent reached", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg);
    // Trigger once (maxConcurrent=1)
    const events = agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:00Z", "run-1"));
    for (const e of events) agg.hydrate(e);

    assert.throws(() => {
      agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:01Z", "run-2"));
    }, /Max concurrent runs reached/);
  });

  it("should complete a job run", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg);
    let events = agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:00Z", "run-1"));
    for (const e of events) agg.hydrate(e);

    events = agg.execute(new CompleteJobRun("job-1", "run-1", { ok: true }, "2026-03-18T00:05:30Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof JobRunCompleted);
  });

  it("should fail a job run", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg);
    let events = agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:00Z", "run-1"));
    for (const e of events) agg.hydrate(e);

    events = agg.execute(new FailJobRun("job-1", "run-1", "timeout", "2026-03-18T00:06:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof JobRunFailed);
  });

  it("should auto-disable after maxConsecutiveFailures", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg, { maxConsecutiveFailures: 2 });

    // First failure
    let events = agg.execute(new TriggerJob("job-1", "2026-03-18T00:05:00Z", "run-1"));
    for (const e of events) agg.hydrate(e);
    events = agg.execute(new FailJobRun("job-1", "run-1", "err", "2026-03-18T00:05:30Z"));
    for (const e of events) agg.hydrate(e);
    assert.equal(events.length, 1); // just the failure

    // Second failure → auto-disable
    events = agg.execute(new TriggerJob("job-1", "2026-03-18T00:10:00Z", "run-2"));
    for (const e of events) agg.hydrate(e);
    events = agg.execute(new FailJobRun("job-1", "run-2", "err", "2026-03-18T00:10:30Z"));
    assert.equal(events.length, 2);
    assert.ok(events[0] instanceof JobRunFailed);
    assert.ok(events[1] instanceof JobDisabled);
  });

  it("should disable and enable a job", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg);

    let events = agg.execute(new DisableJob("job-1", "maintenance", "2026-03-18T01:00:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof JobDisabled);
    for (const e of events) agg.hydrate(e);

    events = agg.execute(new EnableJob("job-1", "2026-03-18T02:00:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof JobEnabled);
  });

  it("should reject disabling an already disabled job", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg, { enabled: false });
    assert.throws(() => {
      agg.execute(new DisableJob("job-1", "test", "2026-03-18T01:00:00Z"));
    }, /already disabled/);
  });

  it("should reject enabling an already enabled job", () => {
    const agg = new ScheduledJobAggregate();
    registerJob(agg);
    assert.throws(() => {
      agg.execute(new EnableJob("job-1", "2026-03-18T01:00:00Z"));
    }, /already enabled/);
  });
});
