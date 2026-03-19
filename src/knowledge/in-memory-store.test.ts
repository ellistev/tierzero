import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryKnowledgeStore } from "./in-memory-store";

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    type: "solution" as const,
    title: "How to add a connector",
    content: "1. Create file\n2. Implement interface\n3. Add tests",
    source: { taskId: "task-1", agentName: "claude-code", timestamp: "2026-03-18T10:00:00Z" },
    tags: ["connector", "howto"],
    relatedFiles: ["src/connectors/example.ts"],
    confidence: 0.9,
    supersededBy: null,
    ...overrides,
  };
}

describe("InMemoryKnowledgeStore", () => {
  it("should add and retrieve an entry", async () => {
    const store = new InMemoryKnowledgeStore();
    const id = await store.add(makeEntry());
    assert.ok(id);

    const entry = await store.get(id);
    assert.ok(entry);
    assert.equal(entry.title, "How to add a connector");
    assert.equal(entry.type, "solution");
    assert.equal(entry.usageCount, 0);
    assert.equal(entry.lastUsedAt, null);
    assert.ok(entry.createdAt);
  });

  it("should return null for unknown id", async () => {
    const store = new InMemoryKnowledgeStore();
    const entry = await store.get("nonexistent");
    assert.equal(entry, null);
  });

  it("should search by query terms matching title/content/tags", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry());
    await store.add(makeEntry({ title: "Test naming convention", tags: ["testing"], content: "Co-locate tests" }));

    const results = await store.search("connector");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "How to add a connector");

    const results2 = await store.search("testing");
    assert.equal(results2.length, 1);
    assert.equal(results2[0].title, "Test naming convention");
  });

  it("should respect search limit", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ title: "Entry 1", tags: ["shared"] }));
    await store.add(makeEntry({ title: "Entry 2", tags: ["shared"] }));
    await store.add(makeEntry({ title: "Entry 3", tags: ["shared"] }));

    const results = await store.search("shared", { limit: 2 });
    assert.equal(results.length, 2);
  });

  it("should filter by minConfidence", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ confidence: 0.3, title: "Low confidence", tags: ["test"] }));
    await store.add(makeEntry({ confidence: 0.9, title: "High confidence", tags: ["test"] }));

    const results = await store.search("test", { minConfidence: 0.5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "High confidence");
  });

  it("should filter by types", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ type: "solution", title: "A solution", tags: ["code"] }));
    await store.add(makeEntry({ type: "error", title: "An error", tags: ["code"] }));

    const results = await store.search("code", { types: ["error"] });
    assert.equal(results.length, 1);
    assert.equal(results[0].type, "error");
  });

  it("should findByTags with matchAll=false (any)", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ tags: ["connector", "zendesk"] }));
    await store.add(makeEntry({ tags: ["testing", "patterns"] }));

    const results = await store.findByTags(["connector"]);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].tags, ["connector", "zendesk"]);
  });

  it("should findByTags with matchAll=true", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ tags: ["connector", "zendesk"] }));
    await store.add(makeEntry({ tags: ["connector", "github"] }));

    const results = await store.findByTags(["connector", "zendesk"], true);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].tags, ["connector", "zendesk"]);
  });

  it("should findByFiles", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ relatedFiles: ["src/connectors/zendesk.ts"] }));
    await store.add(makeEntry({ relatedFiles: ["src/workflows/pipeline.ts"] }));

    const results = await store.findByFiles(["src/connectors/zendesk.ts"]);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].relatedFiles, ["src/connectors/zendesk.ts"]);
  });

  it("should recordUsage and increment usageCount", async () => {
    const store = new InMemoryKnowledgeStore();
    const id = await store.add(makeEntry());

    await store.recordUsage(id);
    await store.recordUsage(id);

    const entry = await store.get(id);
    assert.ok(entry);
    assert.equal(entry.usageCount, 2);
    assert.ok(entry.lastUsedAt);
  });

  it("should supersede old knowledge", async () => {
    const store = new InMemoryKnowledgeStore();
    const oldId = await store.add(makeEntry({ title: "Old way" }));
    const newId = await store.add(makeEntry({ title: "New way" }));

    await store.supersede(oldId, newId);

    const old = await store.get(oldId);
    assert.ok(old);
    assert.equal(old.supersededBy, newId);

    // Superseded entries should not appear in search
    const results = await store.search("connector");
    assert.ok(results.every((r) => r.id !== oldId));
  });

  it("should compute stats", async () => {
    const store = new InMemoryKnowledgeStore();
    await store.add(makeEntry({ type: "solution" }));
    await store.add(makeEntry({ type: "pattern", confidence: 0.8 }));
    await store.add(makeEntry({ type: "error", confidence: 0.7 }));

    const stats = await store.stats();
    assert.equal(stats.totalEntries, 3);
    assert.equal(stats.byType["solution"], 1);
    assert.equal(stats.byType["pattern"], 1);
    assert.equal(stats.byType["error"], 1);
    assert.equal(stats.mostUsed.length, 3);
    assert.equal(stats.recentlyAdded.length, 3);
    assert.ok(stats.averageConfidence > 0);
  });

  it("should exclude superseded entries from stats", async () => {
    const store = new InMemoryKnowledgeStore();
    const oldId = await store.add(makeEntry({ type: "solution" }));
    const newId = await store.add(makeEntry({ type: "solution" }));
    await store.supersede(oldId, newId);

    const stats = await store.stats();
    assert.equal(stats.totalEntries, 1);
  });
});
