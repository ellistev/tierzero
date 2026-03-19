import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "./scheduler";

describe("Scheduler", () => {
  it("should register a job", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "test-job",
      name: "Test Job",
      description: "A test job",
      schedule: "*/5 * * * *",
      taskTemplate: {
        title: "Test",
        description: "Test task",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    const job = scheduler.getJob("test-job");
    assert.ok(job);
    assert.equal(job.name, "Test Job");
    assert.equal(job.enabled, true);
    assert.ok(job.nextRunAt); // should have calculated next run
    assert.equal(job.runCount, 0);
    assert.equal(job.failCount, 0);
  });

  it("should list all jobs", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "job-1", name: "Job 1", description: "First",
      schedule: "*/5 * * * *",
      taskTemplate: { title: "T1", description: "", category: "monitoring", priority: "normal" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });
    scheduler.addJob({
      id: "job-2", name: "Job 2", description: "Second",
      schedule: "0 9 * * *",
      taskTemplate: { title: "T2", description: "", category: "code", priority: "high" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });

    const jobs = scheduler.listJobs();
    assert.equal(jobs.length, 2);
  });

  it("should remove a job", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "temp", name: "Temp", description: "Temporary",
      schedule: "* * * * *",
      taskTemplate: { title: "T", description: "", category: "operations", priority: "low" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });
    scheduler.removeJob("temp");
    assert.equal(scheduler.getJob("temp"), null);
  });

  it("should enable and disable a job", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "toggle", name: "Toggle", description: "Toggleable",
      schedule: "*/5 * * * *",
      taskTemplate: { title: "T", description: "", category: "operations", priority: "normal" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });

    scheduler.disableJob("toggle");
    let job = scheduler.getJob("toggle")!;
    assert.equal(job.enabled, false);
    assert.equal(job.nextRunAt, null);

    scheduler.enableJob("toggle");
    job = scheduler.getJob("toggle")!;
    assert.equal(job.enabled, true);
    assert.ok(job.nextRunAt);
  });

  it("should force-run a job via runNow", async () => {
    const scheduler = new Scheduler();
    let triggered = false;
    scheduler.onTrigger = async () => { triggered = true; };

    scheduler.addJob({
      id: "force", name: "Force", description: "Force-runnable",
      schedule: "0 0 1 1 *", // very infrequent
      taskTemplate: { title: "T", description: "", category: "operations", priority: "normal" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });

    await scheduler.runNow("force");
    assert.ok(triggered);
  });

  it("should throw when force-running a non-existent job", async () => {
    const scheduler = new Scheduler();
    await assert.rejects(() => scheduler.runNow("nonexistent"), /Job not found/);
  });

  it("should record success and reset consecutive failures", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "count", name: "Count", description: "",
      schedule: "* * * * *",
      taskTemplate: { title: "T", description: "", category: "monitoring", priority: "normal" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });

    scheduler.recordFailure("count");
    scheduler.recordFailure("count");
    let job = scheduler.getJob("count")!;
    assert.equal(job.consecutiveFailures, 2);
    assert.equal(job.failCount, 2);

    scheduler.recordSuccess("count");
    job = scheduler.getJob("count")!;
    assert.equal(job.consecutiveFailures, 0);
    assert.equal(job.runCount, 3);
  });

  it("should auto-disable after maxConsecutiveFailures", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "fragile", name: "Fragile", description: "",
      schedule: "* * * * *",
      taskTemplate: { title: "T", description: "", category: "monitoring", priority: "normal" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 3,
    });

    scheduler.recordFailure("fragile");
    scheduler.recordFailure("fragile");
    let job = scheduler.getJob("fragile")!;
    assert.equal(job.enabled, true);

    scheduler.recordFailure("fragile");
    job = scheduler.getJob("fragile")!;
    assert.equal(job.enabled, false);
    assert.equal(job.nextRunAt, null);
  });

  it("should start and stop without error", () => {
    const scheduler = new Scheduler();
    scheduler.addJob({
      id: "s", name: "S", description: "",
      schedule: "*/5 * * * *",
      taskTemplate: { title: "T", description: "", category: "monitoring", priority: "normal" },
      enabled: true, maxConcurrent: 1, catchUp: false, maxConsecutiveFailures: 5,
    });

    scheduler.start();
    scheduler.stop();
    // No error = pass
  });
});
