import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { _compileFilter, KnowledgeRetriever } from "./retriever";
import type { SearchResult } from "./retriever";

// ---------------------------------------------------------------------------
// _compileFilter
// ---------------------------------------------------------------------------

describe("_compileFilter", () => {
  test("empty filter returns undefined", () => {
    assert.equal(_compileFilter({}), undefined);
  });

  test("single fileType produces $eq clause", () => {
    assert.deepEqual(_compileFilter({ fileType: "markdown" }), {
      fileType: { $eq: "markdown" },
    });
  });

  test("multiple fileTypes produce $in clause", () => {
    assert.deepEqual(_compileFilter({ fileType: ["markdown", "text"] }), {
      fileType: { $in: ["markdown", "text"] },
    });
  });

  test("single-element fileType array still produces $eq clause", () => {
    assert.deepEqual(_compileFilter({ fileType: ["pdf"] }), {
      fileType: { $eq: "pdf" },
    });
  });

  test("sourcePrefix produces $contains clause on source field", () => {
    assert.deepEqual(_compileFilter({ sourcePrefix: "runbooks/" }), {
      source: { $contains: "runbooks/" },
    });
  });

  test("raw where clause passes through unchanged", () => {
    const raw = { customTag: { $eq: "sop" } } as any;
    assert.deepEqual(_compileFilter({ where: raw }), raw);
  });

  test("fileType + sourcePrefix produces $and with both clauses", () => {
    assert.deepEqual(_compileFilter({ fileType: "pdf", sourcePrefix: "policies/" }), {
      $and: [
        { fileType: { $eq: "pdf" } },
        { source: { $contains: "policies/" } },
      ],
    });
  });

  test("all three combined produces $and with three clauses", () => {
    const result = _compileFilter({
      fileType: "markdown",
      sourcePrefix: "runbooks/",
      where: { author: { $eq: "ops-team" } } as any,
    });
    assert.ok(result && "$and" in result);
    const clauses = (result as any).$and as unknown[];
    assert.equal(clauses.length, 3);
  });
});

// ---------------------------------------------------------------------------
// KnowledgeRetriever.formatForPrompt
// ---------------------------------------------------------------------------

describe("KnowledgeRetriever.formatForPrompt", () => {
  test("empty chunks returns no-results message", () => {
    const result: SearchResult = { query: "q", chunks: [], totalFound: 0, totalReturned: 0 };
    assert.equal(
      KnowledgeRetriever.formatForPrompt(result),
      "(No relevant knowledge base entries found.)"
    );
  });

  test("chunk with numeric score shows source and score", () => {
    const result: SearchResult = {
      query: "q",
      chunks: [{
        content: "reset your password at https://portal",
        score: 0.87,
        source: "runbooks/password-reset.md",
        metadata: {} as any,
      }],
      totalFound: 1,
      totalReturned: 1,
    };
    const out = KnowledgeRetriever.formatForPrompt(result);
    assert.ok(out.includes("runbooks/password-reset.md"), "should include source path");
    assert.ok(out.includes("score: 0.87"), "should include formatted score");
    assert.ok(out.includes("reset your password"), "should include chunk content");
  });

  test("MMR chunk (score NaN) shows MMR label instead of score", () => {
    const result: SearchResult = {
      query: "q",
      chunks: [{
        content: "some content",
        score: NaN,
        source: "runbooks/some.md",
        metadata: {} as any,
      }],
      totalFound: 1,
      totalReturned: 1,
    };
    const out = KnowledgeRetriever.formatForPrompt(result);
    assert.ok(out.includes("MMR"), "should include MMR label");
    assert.ok(!out.includes("NaN"), "should not show NaN as a score");
  });

  test("multiple chunks are separated by double newline", () => {
    const result: SearchResult = {
      query: "q",
      chunks: [
        { content: "first", score: 0.9, source: "a.md", metadata: {} as any },
        { content: "second", score: 0.8, source: "b.md", metadata: {} as any },
      ],
      totalFound: 2,
      totalReturned: 2,
    };
    const out = KnowledgeRetriever.formatForPrompt(result);
    assert.ok(out.includes("\n\n"), "chunks should be separated by double newline");
    assert.ok(out.includes("a.md") && out.includes("b.md"), "both sources should appear");
  });

  test("score is formatted to 2 decimal places", () => {
    const result: SearchResult = {
      query: "q",
      chunks: [{ content: "c", score: 0.1234567, source: "x.md", metadata: {} as any }],
      totalFound: 1,
      totalReturned: 1,
    };
    const out = KnowledgeRetriever.formatForPrompt(result);
    assert.ok(out.includes("score: 0.12"), "score should be 2 decimal places");
  });
});
