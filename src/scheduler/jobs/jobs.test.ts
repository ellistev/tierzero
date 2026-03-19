import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { builtInJobs } from "./index";
import { systemHealthJob } from "./system-health";
import { connectorHealthJob } from "./connector-health";
import { dailyReportJob } from "./daily-report";
import { knowledgeMaintenanceJob } from "./knowledge-maintenance";
import { testSuiteJob } from "./test-suite";

describe("Built-in Job Templates", () => {
  it("should export all 5 built-in jobs", () => {
    assert.equal(builtInJobs.length, 5);
  });

  it("system-health should have valid template", () => {
    assert.equal(systemHealthJob.id, "system-health");
    assert.equal(systemHealthJob.schedule, "*/5 * * * *");
    assert.equal(systemHealthJob.taskTemplate.category, "monitoring");
    assert.equal(systemHealthJob.enabled, true);
    assert.equal(systemHealthJob.maxConcurrent, 1);
  });

  it("connector-health should have valid template", () => {
    assert.equal(connectorHealthJob.id, "connector-health");
    assert.equal(connectorHealthJob.schedule, "*/15 * * * *");
    assert.equal(connectorHealthJob.taskTemplate.category, "monitoring");
  });

  it("daily-report should have valid template", () => {
    assert.equal(dailyReportJob.id, "daily-report");
    assert.equal(dailyReportJob.schedule, "0 9 * * *");
    assert.equal(dailyReportJob.taskTemplate.category, "communication");
  });

  it("knowledge-maintenance should have valid template", () => {
    assert.equal(knowledgeMaintenanceJob.id, "knowledge-maintenance");
    assert.equal(knowledgeMaintenanceJob.schedule, "0 0 * * 0");
    assert.equal(knowledgeMaintenanceJob.taskTemplate.category, "operations");
  });

  it("test-suite should have valid template", () => {
    assert.equal(testSuiteJob.id, "test-suite");
    assert.equal(testSuiteJob.schedule, "0 */6 * * *");
    assert.equal(testSuiteJob.taskTemplate.category, "code");
  });

  it("each template should have required fields", () => {
    for (const job of builtInJobs) {
      assert.ok(job.id, `Job missing id`);
      assert.ok(job.name, `Job ${job.id} missing name`);
      assert.ok(job.schedule, `Job ${job.id} missing schedule`);
      assert.ok(job.taskTemplate.title, `Job ${job.id} missing taskTemplate.title`);
      assert.ok(job.taskTemplate.category, `Job ${job.id} missing taskTemplate.category`);
      assert.ok(job.taskTemplate.priority, `Job ${job.id} missing taskTemplate.priority`);
      assert.equal(typeof job.maxConcurrent, "number");
      assert.equal(typeof job.maxConsecutiveFailures, "number");
    }
  });
});
