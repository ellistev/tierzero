import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskCompleted } from "./task-completed";
import { taskFailed } from "./task-failed";
import { taskEscalated } from "./task-escalated";
import { agentHung } from "./agent-hung";
import { healthReport } from "./health-report";
import { prCreated } from "./pr-created";
import { renderTemplate } from "./index";

describe("Templates", () => {
  it("taskCompleted renders correctly", () => {
    const msg = taskCompleted({
      title: "Fix login bug",
      taskId: "t-1",
      result: "All tests passing",
      durationMs: 5000,
    });
    assert.ok(msg.subject?.includes("Task Completed"));
    assert.ok(msg.subject?.includes("Fix login bug"));
    assert.ok(msg.body.includes("5s"));
    assert.ok(msg.body.includes("All tests passing"));
    assert.ok(msg.body.includes("t-1"));
  });

  it("taskFailed renders correctly", () => {
    const msg = taskFailed({
      title: "Deploy service",
      taskId: "t-2",
      error: "Connection timeout",
      retryCount: 3,
      maxRetries: 3,
    });
    assert.ok(msg.subject?.includes("Task Failed"));
    assert.ok(msg.body.includes("3/3"));
    assert.ok(msg.body.includes("Connection timeout"));
    assert.equal(msg.priority, "high");
  });

  it("taskEscalated renders correctly", () => {
    const msg = taskEscalated({
      title: "Review PR",
      taskId: "t-3",
      reason: "Max retries exceeded",
    });
    assert.ok(msg.subject?.includes("Task Escalated"));
    assert.ok(msg.body.includes("human attention"));
    assert.ok(msg.body.includes("Max retries exceeded"));
    assert.equal(msg.priority, "high");
  });

  it("agentHung renders correctly", () => {
    const msg = agentHung({
      agentName: "code-agent",
      taskId: "t-4",
      lastHeartbeat: "2026-03-18T09:55:00Z",
    });
    assert.ok(msg.subject?.includes("Agent Hung"));
    assert.ok(msg.subject?.includes("code-agent"));
    assert.ok(msg.body.includes("stopped responding"));
    assert.ok(msg.body.includes("2026-03-18T09:55:00Z"));
    assert.equal(msg.priority, "high");
  });

  it("healthReport renders correctly - all healthy", () => {
    const msg = healthReport({
      channels: [
        { name: "email", ok: true },
        { name: "slack", ok: true },
      ],
      timestamp: "2026-03-18T10:00:00Z",
    });
    assert.ok(msg.subject?.includes("All Systems OK"));
    assert.ok(msg.body.includes("Healthy"));
    assert.equal(msg.priority, "low");
  });

  it("healthReport renders correctly - degraded", () => {
    const msg = healthReport({
      channels: [
        { name: "email", ok: true },
        { name: "slack", ok: false, error: "Token expired" },
      ],
      timestamp: "2026-03-18T10:00:00Z",
    });
    assert.ok(msg.subject?.includes("Issues Detected"));
    assert.ok(msg.body.includes("FAIL - slack"));
    assert.ok(msg.body.includes("Token expired"));
    assert.ok(msg.body.includes("Degraded"));
    assert.equal(msg.priority, "high");
  });

  it("prCreated renders correctly", () => {
    const msg = prCreated({
      title: "Fix auth flow",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      branch: "fix/auth-flow",
      taskId: "t-5",
    });
    assert.ok(msg.subject?.includes("PR Created"));
    assert.ok(msg.subject?.includes("#42"));
    assert.ok(msg.body.includes("https://github.com/org/repo/pull/42"));
    assert.ok(msg.body.includes("fix/auth-flow"));
  });

  it("renderTemplate returns null for unknown template", () => {
    const result = renderTemplate("nonexistent", {});
    assert.equal(result, null);
  });

  it("renderTemplate renders known template", () => {
    const result = renderTemplate("task-completed", {
      title: "Test",
      taskId: "t-1",
      result: "ok",
      durationMs: 1000,
    });
    assert.ok(result);
    assert.ok(result.subject?.includes("Task Completed"));
  });
});
