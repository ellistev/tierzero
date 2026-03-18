import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeAgent } from "./claude-code-agent";

describe("ClaudeCodeAgent", () => {
  it("initializes with default config", () => {
    const agent = new ClaudeCodeAgent();
    assert.ok(agent);
  });

  it("initializes with custom config", () => {
    const agent = new ClaudeCodeAgent({
      claudePath: "/usr/local/bin/claude",
      timeoutMs: 300_000,
      extraContext: "Use the AdapTech ES/CQRS pattern",
    });
    assert.ok(agent);
  });

  it("implements CodeAgent interface", () => {
    const agent = new ClaudeCodeAgent();
    assert.equal(typeof agent.solve, "function");
    assert.equal(typeof agent.fixTests, "function");
  });
});
