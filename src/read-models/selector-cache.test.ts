import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectorCacheReadModelFull, type SelectorCacheRecord } from "./selector-cache";

// Mock TransactionalRepository
function createMockRepo() {
  const records = new Map<string, SelectorCacheRecord>();

  return {
    records,
    create_v2(record: SelectorCacheRecord) {
      records.set(record.cacheKey, { ...record });
    },
    updateOne(filter: Partial<SelectorCacheRecord>, update: Partial<SelectorCacheRecord>) {
      for (const [key, record] of records) {
        let match = true;
        for (const [fk, fv] of Object.entries(filter)) {
          if ((record as Record<string, unknown>)[fk] !== fv) { match = false; break; }
        }
        if (match) {
          records.set(key, { ...record, ...update });
          return;
        }
      }
    },
    async findOne_v2(filter: Partial<SelectorCacheRecord>): Promise<SelectorCacheRecord | null> {
      for (const record of records.values()) {
        let match = true;
        for (const [fk, fv] of Object.entries(filter)) {
          if ((record as Record<string, unknown>)[fk] !== fv) { match = false; break; }
        }
        if (match) return { ...record };
      }
      return null;
    },
  };
}

describe("SelectorCache Read Model", () => {
  it("should create a cache entry on first IntentSucceeded", async () => {
    const repo = createMockRepo();
    await selectorCacheReadModelFull.handler(repo, {
      streamId: "IntentExecution-i1",
      eventNumber: 2,
      position: null,
      event: { intentId: "i1", selector: "button#search", method: "aria", durationMs: 50, succeededAt: "2026-01-01T00:00:00Z" },
      eventId: "e1",
      typeId: "IntentSucceeded",
      creationTime: Date.now(),
      metadata: { page: "/admin", intentName: "click-search" },
    });

    const record = repo.records.get("/admin::click-search");
    assert.ok(record);
    assert.equal(record.page, "/admin");
    assert.equal(record.intentName, "click-search");
    assert.equal(record.lastSelector, "button#search");
    assert.equal(record.lastMethod, "aria");
    assert.equal(record.successCount, 1);
    assert.equal(record.avgDurationMs, 50);
  });

  it("should update existing cache entry on subsequent IntentSucceeded", async () => {
    const repo = createMockRepo();
    const handler = selectorCacheReadModelFull.handler;

    // First success
    await handler(repo, {
      streamId: "IntentExecution-i1",
      eventNumber: 2,
      position: null,
      event: { intentId: "i1", selector: "button#search", method: "aria", durationMs: 50, succeededAt: "2026-01-01T00:00:00Z" },
      eventId: "e1",
      typeId: "IntentSucceeded",
      creationTime: Date.now(),
      metadata: { page: "/admin", intentName: "click-search" },
    });

    // Second success - different selector, different duration
    await handler(repo, {
      streamId: "IntentExecution-i2",
      eventNumber: 2,
      position: null,
      event: { intentId: "i2", selector: "button.search-btn", method: "cached", durationMs: 10, succeededAt: "2026-01-02T00:00:00Z" },
      eventId: "e2",
      typeId: "IntentSucceeded",
      creationTime: Date.now(),
      metadata: { page: "/admin", intentName: "click-search" },
    });

    const record = repo.records.get("/admin::click-search");
    assert.ok(record);
    assert.equal(record.lastSelector, "button.search-btn");
    assert.equal(record.lastMethod, "cached");
    assert.equal(record.successCount, 2);
    assert.equal(record.avgDurationMs, 30); // (50 + 10) / 2 = 30
    assert.equal(record.lastUsed, "2026-01-02T00:00:00Z");
  });

  it("should track separate cache entries for different pages", async () => {
    const repo = createMockRepo();
    const handler = selectorCacheReadModelFull.handler;

    await handler(repo, {
      streamId: "IntentExecution-i1",
      eventNumber: 2,
      position: null,
      event: { intentId: "i1", selector: "button#search", method: "aria", durationMs: 50, succeededAt: "2026-01-01T00:00:00Z" },
      eventId: "e1",
      typeId: "IntentSucceeded",
      creationTime: Date.now(),
      metadata: { page: "/admin", intentName: "click-search" },
    });

    await handler(repo, {
      streamId: "IntentExecution-i2",
      eventNumber: 2,
      position: null,
      event: { intentId: "i2", selector: "button.find", method: "vision", durationMs: 200, succeededAt: "2026-01-01T00:00:00Z" },
      eventId: "e2",
      typeId: "IntentSucceeded",
      creationTime: Date.now(),
      metadata: { page: "/settings", intentName: "click-search" },
    });

    assert.equal(repo.records.size, 2);
    assert.ok(repo.records.has("/admin::click-search"));
    assert.ok(repo.records.has("/settings::click-search"));
  });

  it("should ignore non-IntentSucceeded events", async () => {
    const repo = createMockRepo();
    await selectorCacheReadModelFull.handler(repo, {
      streamId: "IntentExecution-i1",
      eventNumber: 1,
      position: null,
      event: { intentId: "i1", intentName: "click-search", goal: "Click Search", page: "/admin", value: null, context: {}, attemptedAt: "2026-01-01T00:00:00Z" },
      eventId: "e1",
      typeId: "IntentAttempted",
      creationTime: Date.now(),
      metadata: {},
    });

    assert.equal(repo.records.size, 0);
  });

  it("should compute running average duration correctly", async () => {
    const repo = createMockRepo();
    const handler = selectorCacheReadModelFull.handler;
    const meta = { page: "/page", intentName: "fill-input" };

    const durations = [100, 80, 120];
    for (let i = 0; i < durations.length; i++) {
      await handler(repo, {
        streamId: `IntentExecution-i${i}`,
        eventNumber: 2,
        position: null,
        event: { intentId: `i${i}`, selector: "input#name", method: "cached", durationMs: durations[i], succeededAt: `2026-01-0${i + 1}T00:00:00Z` },
        eventId: `e${i}`,
        typeId: "IntentSucceeded",
        creationTime: Date.now(),
        metadata: meta,
      });
    }

    const record = repo.records.get("/page::fill-input");
    assert.ok(record);
    assert.equal(record.successCount, 3);
    assert.equal(record.avgDurationMs, 100); // (100 + 80 + 120) / 3 = 100
  });

  it("should have correct config schema", () => {
    assert.equal(selectorCacheReadModelFull.name, "selector_cache");
    assert.equal(selectorCacheReadModelFull.config.key, "cacheKey");
    assert.ok(selectorCacheReadModelFull.config.indexes.includes("page"));
    assert.ok(selectorCacheReadModelFull.config.indexes.includes("intentName"));
  });
});
