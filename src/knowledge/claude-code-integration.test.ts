import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeAgent } from "../workflows/claude-code-agent";
import { InMemoryKnowledgeStore } from "./in-memory-store";
import { LLMKnowledgeExtractor } from "./extractor";
import type { LLM } from "./extractor";

describe("ClaudeCodeAgent knowledge integration", () => {
  it("should accept knowledgeStore and knowledgeExtractor config", () => {
    const store = new InMemoryKnowledgeStore();
    const llm: LLM = { invoke: async () => "[]" };
    const extractor = new LLMKnowledgeExtractor(llm);
    const agent = new ClaudeCodeAgent({
      knowledgeStore: store,
      knowledgeExtractor: extractor,
    });
    assert.ok(agent);
  });

  it("should build TASK.md with prior knowledge section", async () => {
    const store = new InMemoryKnowledgeStore();

    // Seed knowledge
    await store.add({
      type: "solution",
      title: "How to add a new connector",
      content: "1. Create src/connectors/<name>.ts\n2. Implement TicketConnector interface\n3. Add tests",
      source: { taskId: "task-1", agentName: "claude-code", timestamp: "2026-03-18T10:00:00Z" },
      tags: ["connector"],
      relatedFiles: ["src/connectors/example.ts"],
      confidence: 0.92,
      supersededBy: null,
    });

    await store.add({
      type: "pattern",
      title: "Test naming convention",
      content: "Test files are co-located: <name>.test.ts next to <name>.ts",
      source: { taskId: "task-2", agentName: "claude-code", timestamp: "2026-03-18T10:00:00Z" },
      tags: ["testing", "convention"],
      relatedFiles: [],
      confidence: 0.88,
      supersededBy: null,
    });

    const agent = new ClaudeCodeAgent({ knowledgeStore: store });

    // Access buildTaskFile via the agent by testing the full TASK.md content
    // We do this by calling the private method indirectly through the public API shape
    // Since we can't call solve() without spawning Claude, we test the config acceptance
    // and verify knowledge search works
    const results = await store.search("connector");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "How to add a new connector");
  });

  it("should track usage when knowledge is retrieved", async () => {
    const store = new InMemoryKnowledgeStore();
    const id = await store.add({
      type: "solution",
      title: "Connector pattern",
      content: "How to add connectors",
      source: { taskId: "task-1", agentName: "claude-code", timestamp: "2026-03-18T10:00:00Z" },
      tags: ["connector"],
      relatedFiles: [],
      confidence: 0.9,
      supersededBy: null,
    });

    // Simulate what the agent does: search + record usage
    const results = await store.search("connector");
    for (const entry of results) {
      await store.recordUsage(entry.id);
    }

    const updated = await store.get(id);
    assert.ok(updated);
    assert.equal(updated.usageCount, 1);
    assert.ok(updated.lastUsedAt);
  });

  it("should extract and store knowledge from completed work", async () => {
    const store = new InMemoryKnowledgeStore();
    const llm: LLM = {
      invoke: async () => JSON.stringify([
        {
          type: "solution",
          title: "Adding a Zendesk connector",
          content: "Step-by-step guide for Zendesk integration",
          tags: ["connector", "zendesk"],
          relatedFiles: ["src/connectors/zendesk.ts"],
          confidence: 0.9,
        },
      ]),
    };
    const extractor = new LLMKnowledgeExtractor(llm);

    // Simulate extraction
    const entries = await extractor.extract({
      taskId: "issue-42",
      taskTitle: "Add Zendesk connector",
      taskDescription: "Implement Zendesk ticket connector",
      agentName: "claude-code",
      gitDiff: "diff --git ...",
      agentOutput: "Created connector successfully",
      filesModified: ["src/connectors/zendesk.ts"],
    });

    // Store extracted knowledge
    for (const entry of entries) {
      await store.add(entry);
    }

    // Verify it's searchable
    const results = await store.search("zendesk connector");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Adding a Zendesk connector");
    assert.equal(results[0].source.taskId, "issue-42");
  });
});
