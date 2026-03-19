import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

import {
  extractImports,
  extractAcceptanceCriteria,
  findSimilarFiles,
  resolveImport,
  gatherReviewContext,
} from "./review-context";

// ── extractImports ──────────────────────────────────────────────────

describe("extractImports", () => {
  it("extracts relative imports from diff text", () => {
    const diff = [
      '+import { foo } from "./utils";',
      '+import bar from "../lib/bar";',
      '+import { baz } from "external-lib";',
    ].join("\n");

    const imports = extractImports(diff);
    assert.deepEqual(imports, ["./utils", "../lib/bar"]);
  });

  it("returns empty array for no imports", () => {
    const imports = extractImports("const x = 1;");
    assert.deepEqual(imports, []);
  });

  it("deduplicates imports", () => {
    const diff = [
      '+import { a } from "./shared";',
      '+import { b } from "./shared";',
    ].join("\n");

    const imports = extractImports(diff);
    assert.deepEqual(imports, ["./shared"]);
  });

  it("handles dynamic imports", () => {
    const diff = '+const mod = await import("./dynamic");';
    const imports = extractImports(diff);
    assert.deepEqual(imports, ["./dynamic"]);
  });
});

// ── extractAcceptanceCriteria ───────────────────────────────────────

describe("extractAcceptanceCriteria", () => {
  it("extracts checkbox items", () => {
    const body = [
      "## Description",
      "Some description.",
      "",
      "## Acceptance Criteria",
      "- [ ] Feature A works",
      "- [x] Feature B is implemented",
      "- [ ] Tests pass",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(body);
    assert.deepEqual(criteria, [
      "Feature A works",
      "Feature B is implemented",
      "Tests pass",
    ]);
  });

  it("falls back to section heading for non-checkbox lists", () => {
    const body = [
      "## Acceptance Criteria",
      "- Feature A",
      "- Feature B",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(body);
    assert.deepEqual(criteria, ["Feature A", "Feature B"]);
  });

  it("returns empty array when no criteria found", () => {
    const body = "This issue has no acceptance criteria.";
    const criteria = extractAcceptanceCriteria(body);
    assert.deepEqual(criteria, []);
  });

  it("handles Requirements heading", () => {
    const body = [
      "## Requirements",
      "- Must do X",
      "- Must do Y",
    ].join("\n");

    const criteria = extractAcceptanceCriteria(body);
    assert.deepEqual(criteria, ["Must do X", "Must do Y"]);
  });
});

// ── findSimilarFiles ────────────────────────────────────────────────

describe("findSimilarFiles", () => {
  const tmpDir = join(process.cwd(), ".tmp-test-similar-files");

  it("finds .ts files in the same directory", () => {
    // Setup temp dir
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
    mkdirSync(join(tmpDir, "src", "connectors"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "connectors", "github.ts"), "export class GitHub {}");
    writeFileSync(join(tmpDir, "src", "connectors", "jira.ts"), "export class Jira {}");
    writeFileSync(join(tmpDir, "src", "connectors", "new.ts"), "export class New {}");
    writeFileSync(join(tmpDir, "src", "connectors", "github.test.ts"), "test");

    try {
      const similar = findSimilarFiles("src/connectors/new.ts", tmpDir, 2);
      assert.ok(similar.length > 0);
      assert.ok(similar.length <= 2);
      // Should not include test files
      assert.ok(similar.every((f) => !f.includes(".test.")));
      // Should not include the file itself
      assert.ok(similar.every((f) => !f.endsWith("new.ts")));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("returns empty for nonexistent directory", () => {
    const similar = findSimilarFiles("nonexistent/foo.ts", tmpDir);
    assert.deepEqual(similar, []);
  });
});

// ── resolveImport ───────────────────────────────────────────────────

describe("resolveImport", () => {
  const tmpDir = join(process.cwd(), ".tmp-test-resolve-import");

  it("resolves .ts import without extension", () => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "utils.ts"), "export const x = 1;");

    try {
      const result = resolveImport("./utils", "src/app.ts", tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith("utils.ts"));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("returns null for unresolvable import", () => {
    const result = resolveImport("./nonexistent", "src/app.ts", "/fake/dir");
    assert.equal(result, null);
  });
});

// ── gatherReviewContext ─────────────────────────────────────────────

describe("gatherReviewContext", () => {
  it("gathers issue context and acceptance criteria", () => {
    const ctx = gatherReviewContext({
      diffText: "+const x = 1;",
      filesChanged: ["src/foo.ts"],
      workDir: "/fake",
      issueTitle: "Add feature X",
      issueBody: "## Acceptance Criteria\n- [ ] X works\n- [ ] Tests pass",
      testOutput: "tests 5\npass 5\nfail 0",
    });

    assert.equal(ctx.issueContext.title, "Add feature X");
    assert.deepEqual(ctx.issueContext.acceptanceCriteria, ["X works", "Tests pass"]);
    assert.equal(ctx.testOutput, "tests 5\npass 5\nfail 0");
  });

  it("includes empty arrays when no deps or similar files found", () => {
    const ctx = gatherReviewContext({
      diffText: "+const x = 1;",
      filesChanged: ["src/foo.ts"],
      workDir: "/fake",
      issueTitle: "Test",
      issueBody: "No criteria",
      testOutput: "",
    });

    assert.deepEqual(ctx.dependencies, []);
    assert.deepEqual(ctx.similarFiles, []);
    assert.deepEqual(ctx.issueContext.acceptanceCriteria, []);
  });
});
