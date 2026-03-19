import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LLMKnowledgeExtractor } from "./extractor";
import type { LLM, ExtractionContext } from "./extractor";

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    taskId: "issue-42",
    taskTitle: "Add Zendesk connector",
    taskDescription: "Implement a new connector for Zendesk tickets",
    agentName: "claude-code",
    gitDiff: `diff --git a/src/connectors/zendesk.ts b/src/connectors/zendesk.ts
new file mode 100644
+export class ZendeskConnector implements TicketConnector {
+  async healthCheck() { return { ok: true }; }
+}`,
    agentOutput: "Created ZendeskConnector with healthCheck. All tests pass.",
    filesModified: ["src/connectors/zendesk.ts", "src/connectors/zendesk.test.ts"],
    ...overrides,
  };
}

function makeMockLLM(response: string): LLM {
  return {
    invoke: async (_prompt: string) => response,
  };
}

describe("LLMKnowledgeExtractor", () => {
  it("should extract knowledge entries from valid LLM response", async () => {
    const llmResponse = JSON.stringify([
      {
        type: "solution",
        title: "How to add a new connector",
        content: "1. Create file in src/connectors/\n2. Implement TicketConnector interface",
        tags: ["connector", "zendesk"],
        relatedFiles: ["src/connectors/zendesk.ts"],
        confidence: 0.92,
      },
      {
        type: "pattern",
        title: "Test file co-location",
        content: "Test files are placed next to source files",
        tags: ["testing"],
        relatedFiles: ["src/connectors/zendesk.test.ts"],
        confidence: 0.88,
      },
    ]);

    const extractor = new LLMKnowledgeExtractor(makeMockLLM(llmResponse));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, "solution");
    assert.equal(entries[0].title, "How to add a new connector");
    assert.equal(entries[0].source.taskId, "issue-42");
    assert.equal(entries[0].source.agentName, "claude-code");
    assert.deepEqual(entries[0].tags, ["connector", "zendesk"]);
    assert.equal(entries[0].confidence, 0.92);

    assert.equal(entries[1].type, "pattern");
    assert.equal(entries[1].title, "Test file co-location");
  });

  it("should handle LLM response wrapped in code fences", async () => {
    const llmResponse = "```json\n" + JSON.stringify([
      { type: "decision", title: "Use Map stores", content: "Map-based stores for testing", tags: ["architecture"], confidence: 0.85 },
    ]) + "\n```";

    const extractor = new LLMKnowledgeExtractor(makeMockLLM(llmResponse));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, "decision");
  });

  it("should return empty array for invalid JSON", async () => {
    const extractor = new LLMKnowledgeExtractor(makeMockLLM("This is not JSON"));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries.length, 0);
  });

  it("should return empty array for empty JSON array", async () => {
    const extractor = new LLMKnowledgeExtractor(makeMockLLM("[]"));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries.length, 0);
  });

  it("should skip entries missing required fields", async () => {
    const llmResponse = JSON.stringify([
      { type: "solution", title: "Valid", content: "Has all fields", tags: [], confidence: 0.8 },
      { type: "solution", title: "Missing content" }, // no content field
      { title: "Missing type", content: "Has content" }, // no type field
    ]);

    const extractor = new LLMKnowledgeExtractor(makeMockLLM(llmResponse));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, "Valid");
  });

  it("should default confidence to 0.7 if not provided", async () => {
    const llmResponse = JSON.stringify([
      { type: "error", title: "Import issue", content: "Path doesn't work on Windows", tags: ["windows"] },
    ]);

    const extractor = new LLMKnowledgeExtractor(makeMockLLM(llmResponse));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries.length, 1);
    assert.equal(entries[0].confidence, 0.7);
  });

  it("should use filesModified from context when relatedFiles not in response", async () => {
    const llmResponse = JSON.stringify([
      { type: "solution", title: "Test", content: "Content", tags: [] },
    ]);

    const ctx = makeContext({ filesModified: ["src/foo.ts", "src/bar.ts"] });
    const extractor = new LLMKnowledgeExtractor(makeMockLLM(llmResponse));
    const entries = await extractor.extract(ctx);

    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].relatedFiles, ["src/foo.ts", "src/bar.ts"]);
  });

  it("should set supersededBy to null on extracted entries", async () => {
    const llmResponse = JSON.stringify([
      { type: "solution", title: "Test", content: "Content", tags: [], confidence: 0.9 },
    ]);

    const extractor = new LLMKnowledgeExtractor(makeMockLLM(llmResponse));
    const entries = await extractor.extract(makeContext());

    assert.equal(entries[0].supersededBy, null);
  });
});
