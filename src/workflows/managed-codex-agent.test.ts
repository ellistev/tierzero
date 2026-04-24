import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ManagedCodexAgent } from "./managed-codex-agent";

describe("ManagedCodexAgent", () => {
  it("should implement ManagedAgent interface", () => {
    const agent = new ManagedCodexAgent();
    assert.equal(agent.name, "codex");
    assert.equal(agent.type, "codex");
    assert.equal(typeof agent.start, "function");
    assert.equal(typeof agent.heartbeat, "function");
    assert.equal(typeof agent.stop, "function");
    assert.equal(typeof agent.kill, "function");
  });

  it("should accept custom name and model", async () => {
    const agent = new ManagedCodexAgent({ name: "custom-codex", model: "gpt-5.4" });
    assert.equal(agent.name, "custom-codex");

    const hb = await agent.heartbeat();
    assert.equal(hb.alive, false);
    assert.equal(hb.percentComplete, null);
  });

  it("should handle stop and kill before start gracefully", async () => {
    const agent = new ManagedCodexAgent();
    await agent.stop();
    agent.kill();
  });
});
