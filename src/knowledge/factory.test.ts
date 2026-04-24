import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChromaKnowledgeStore } from "./chroma-store";
import { createKnowledgeExtractor } from "./extractor-factory";
import { createKnowledgeStore } from "./factory";
import { InMemoryKnowledgeStore } from "./in-memory-store";

describe("createKnowledgeStore", () => {
  it("returns undefined when disabled", async () => {
    const store = await createKnowledgeStore({ enabled: false });
    assert.equal(store, undefined);
  });

  it("defaults to in-memory backend", async () => {
    const store = await createKnowledgeStore();
    assert.ok(store instanceof InMemoryKnowledgeStore);
  });

  it("creates a chroma backend when configured", async () => {
    const store = await createKnowledgeStore({
      backend: "chroma",
      chroma: {
        collectionName: "tierzero-test",
        chromaUrl: "http://localhost:8000",
      },
    });

    assert.ok(store instanceof ChromaKnowledgeStore);
  });

  it("creates no extractor when OpenAI credentials are unavailable", () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const extractor = createKnowledgeExtractor({ enabled: true });
      assert.equal(extractor, undefined);
    } finally {
      if (original) process.env.OPENAI_API_KEY = original;
    }
  });
});
