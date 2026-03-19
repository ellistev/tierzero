import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deploySuccess } from "./deploy-success";
import { deployFailed } from "./deploy-failed";
import { renderTemplate } from "./index";

describe("Deploy templates", () => {
  it("deploySuccess renders correctly", () => {
    const msg = deploySuccess({
      version: "abc123",
      environment: "staging",
      durationMs: 5000,
    });
    assert.ok(msg.subject?.includes("Deploy Succeeded"));
    assert.ok(msg.subject?.includes("staging"));
    assert.ok(msg.body.includes("vabc123"));
    assert.ok(msg.body.includes("staging"));
    assert.ok(msg.body.includes("5s"));
  });

  it("deployFailed renders correctly", () => {
    const msg = deployFailed({
      environment: "production",
      error: "Connection timeout",
      rolledBack: true,
    });
    assert.ok(msg.subject?.includes("Deploy Failed"));
    assert.ok(msg.subject?.includes("production"));
    assert.ok(msg.body.includes("FAILED"));
    assert.ok(msg.body.includes("Connection timeout"));
    assert.ok(msg.body.includes("Rolled back: true"));
    assert.equal(msg.priority, "high");
  });

  it("deployFailed renders when not rolled back", () => {
    const msg = deployFailed({
      environment: "staging",
      error: "SSH connection failed",
      rolledBack: false,
    });
    assert.ok(msg.body.includes("Rolled back: false"));
    assert.equal(msg.priority, "high");
  });

  it("renderTemplate works for deploy-success", () => {
    const result = renderTemplate("deploy-success", {
      version: "v2.0",
      environment: "production",
      durationMs: 3000,
    });
    assert.ok(result);
    assert.ok(result!.subject?.includes("Deploy Succeeded"));
    assert.ok(result!.body.includes("vv2.0"));
  });

  it("renderTemplate works for deploy-failed", () => {
    const result = renderTemplate("deploy-failed", {
      environment: "staging",
      error: "Timeout",
      rolledBack: false,
    });
    assert.ok(result);
    assert.ok(result!.subject?.includes("Deploy Failed"));
    assert.ok(result!.body.includes("Timeout"));
  });
});
