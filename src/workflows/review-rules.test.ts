import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  noConsoleLog,
  noTodo,
  testCoverage,
  noAny,
  importOrder,
  fileSize,
  noSecrets,
  parseDiff,
  type DiffFile,
  type DiffLine,
} from "./review-rules";

// ── Helpers ─────────────────────────────────────────────────────────

function makeDiff(path: string, lines: string[]): DiffFile {
  return {
    path,
    additions: lines.map((content, i) => ({ lineNumber: i + 1, content })),
  };
}

// ── no-console-log ──────────────────────────────────────────────────

describe("no-console-log rule", () => {
  it("flags console.log in production code", () => {
    const diff = [makeDiff("src/app.ts", ['console.log("hello");'])];
    const findings = noConsoleLog.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "no-console-log");
    assert.equal(findings[0].severity, "warning");
  });

  it("flags console.warn and console.error", () => {
    const diff = [makeDiff("src/app.ts", ['console.warn("w");', 'console.error("e");'])];
    const findings = noConsoleLog.check(diff);
    assert.equal(findings.length, 2);
  });

  it("does not flag test files", () => {
    const diff = [makeDiff("src/app.test.ts", ['console.log("test output");'])];
    const findings = noConsoleLog.check(diff);
    assert.equal(findings.length, 0);
  });

  it("does not flag code without console statements", () => {
    const diff = [makeDiff("src/app.ts", ['const x = 1;', 'return x + 2;'])];
    const findings = noConsoleLog.check(diff);
    assert.equal(findings.length, 0);
  });
});

// ── no-todo ─────────────────────────────────────────────────────────

describe("no-todo rule", () => {
  it("flags TODO comments", () => {
    const diff = [makeDiff("src/app.ts", ["// TODO: fix this later"])];
    const findings = noTodo.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "no-todo");
    assert.ok(findings[0].message.includes("TODO"));
  });

  it("flags FIXME comments", () => {
    const diff = [makeDiff("src/app.ts", ["// FIXME: broken"])];
    const findings = noTodo.check(diff);
    assert.equal(findings.length, 1);
  });

  it("flags HACK comments", () => {
    const diff = [makeDiff("src/app.ts", ["// HACK: workaround"])];
    const findings = noTodo.check(diff);
    assert.equal(findings.length, 1);
  });

  it("does not flag clean code", () => {
    const diff = [makeDiff("src/app.ts", ["const result = compute();"])];
    const findings = noTodo.check(diff);
    assert.equal(findings.length, 0);
  });
});

// ── test-coverage ───────────────────────────────────────────────────

describe("test-coverage rule", () => {
  it("flags source file without corresponding test", () => {
    const diff = [makeDiff("src/utils.ts", ["export function foo() {}"])];
    diff[0].allPaths = ["src/utils.ts"];
    const findings = testCoverage.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "test-coverage");
  });

  it("passes when test file exists", () => {
    const diff = [
      makeDiff("src/utils.ts", ["export function foo() {}"]),
      makeDiff("src/utils.test.ts", ['it("works", () => {});']),
    ];
    const allPaths = ["src/utils.ts", "src/utils.test.ts"];
    diff[0].allPaths = allPaths;
    diff[1].allPaths = allPaths;
    const findings = testCoverage.check(diff);
    assert.equal(findings.length, 0);
  });

  it("does not flag test files themselves", () => {
    const diff = [makeDiff("src/utils.test.ts", ['it("works", () => {});'])];
    diff[0].allPaths = ["src/utils.test.ts"];
    const findings = testCoverage.check(diff);
    assert.equal(findings.length, 0);
  });
});

// ── no-any ──────────────────────────────────────────────────────────

describe("no-any rule", () => {
  it("flags : any type annotation", () => {
    const diff = [makeDiff("src/app.ts", ["function foo(x: any) {}"])];
    const findings = noAny.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "no-any");
  });

  it("flags as any cast", () => {
    const diff = [makeDiff("src/app.ts", ["const x = val as any;"])];
    const findings = noAny.check(diff);
    assert.equal(findings.length, 1);
  });

  it("does not flag words containing 'any'", () => {
    const diff = [makeDiff("src/app.ts", ["const company = getCompany();", "const many = 5;"])];
    const findings = noAny.check(diff);
    assert.equal(findings.length, 0);
  });

  it("skips test files", () => {
    const diff = [makeDiff("src/app.test.ts", ["const x: any = 1;"])];
    const findings = noAny.check(diff);
    assert.equal(findings.length, 0);
  });
});

// ── import-order ────────────────────────────────────────────────────

describe("import-order rule", () => {
  it("passes correct order: node, external, internal", () => {
    const diff = [makeDiff("src/app.ts", [
      'import { readFile } from "node:fs";',
      'import express from "express";',
      'import { foo } from "./utils";',
    ])];
    const findings = importOrder.check(diff);
    assert.equal(findings.length, 0);
  });

  it("flags internal import before external", () => {
    const diff = [makeDiff("src/app.ts", [
      'import { foo } from "./utils";',
      'import express from "express";',
    ])];
    const findings = importOrder.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "import-order");
  });
});

// ── file-size ───────────────────────────────────────────────────────

describe("file-size rule", () => {
  it("flags files with 500+ new lines", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const diff = [makeDiff("src/big.ts", lines)];
    const findings = fileSize.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "file-size");
  });

  it("passes files under 500 lines", () => {
    const diff = [makeDiff("src/small.ts", ["const x = 1;"])];
    const findings = fileSize.check(diff);
    assert.equal(findings.length, 0);
  });
});

// ── no-secrets ──────────────────────────────────────────────────────

describe("no-secrets rule", () => {
  it("flags hardcoded API keys", () => {
    const diff = [makeDiff("src/config.ts", ['const api_key = "abcdefghijklmnopqrstuvwxyz123456";'])];
    const findings = noSecrets.check(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    assert.equal(findings[0].rule, "no-secrets");
  });

  it("flags GitHub tokens", () => {
    const diff = [makeDiff("src/config.ts", ["const token = ghp_abcdefghijklmnopqrstuvwxyz1234567890;"])];
    const findings = noSecrets.check(diff);
    assert.equal(findings.length, 1);
  });

  it("flags AWS access keys", () => {
    const diff = [makeDiff("src/config.ts", ["const key = AKIAIOSFODNN7EXAMPLE;"])];
    const findings = noSecrets.check(diff);
    assert.equal(findings.length, 1);
  });

  it("does not flag test files", () => {
    const diff = [makeDiff("src/config.test.ts", ['const api_key = "abcdefghijklmnopqrstuvwxyz123456";'])];
    const findings = noSecrets.check(diff);
    assert.equal(findings.length, 0);
  });

  it("does not flag clean code", () => {
    const diff = [makeDiff("src/config.ts", ['const key = process.env.API_KEY;'])];
    const findings = noSecrets.check(diff);
    assert.equal(findings.length, 0);
  });
});

// ── parseDiff ───────────────────────────────────────────────────────

describe("parseDiff", () => {
  it("parses a simple unified diff", () => {
    const diffText = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc..def 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "+const b = 2;",
      " const c = 3;",
    ].join("\n");

    const files = parseDiff(diffText);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "src/foo.ts");
    assert.equal(files[0].additions.length, 1);
    assert.equal(files[0].additions[0].content, "const b = 2;");
    assert.equal(files[0].additions[0].lineNumber, 2);
  });

  it("parses multiple files", () => {
    const diffText = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1,2 @@",
      " old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1,2 @@",
      " old2",
      "+new2",
    ].join("\n");

    const files = parseDiff(diffText);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "src/a.ts");
    assert.equal(files[1].path, "src/b.ts");
  });

  it("populates allPaths on each file", () => {
    const diffText = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1,2 @@",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1,2 @@",
      "+new2",
    ].join("\n");

    const files = parseDiff(diffText);
    assert.deepEqual(files[0].allPaths, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(files[1].allPaths, ["src/a.ts", "src/b.ts"]);
  });

  it("handles empty diff", () => {
    const files = parseDiff("");
    assert.equal(files.length, 0);
  });
});
