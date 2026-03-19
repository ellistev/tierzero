import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PRReviewer } from "./pr-reviewer";

// ── Helper: build a minimal unified diff ────────────────────────────

function buildDiff(files: { path: string; lines: string[] }[]): string {
  return files
    .map(
      (f) =>
        [
          `diff --git a/${f.path} b/${f.path}`,
          `--- a/${f.path}`,
          `+++ b/${f.path}`,
          `@@ -0,0 +1,${f.lines.length} @@`,
          ...f.lines.map((l) => `+${l}`),
        ].join("\n"),
    )
    .join("\n");
}

// ── Scoring ─────────────────────────────────────────────────────────

describe("PRReviewer scoring", () => {
  it("returns 100 for clean code", () => {
    const reviewer = new PRReviewer();
    const diff = buildDiff([{ path: "src/clean.ts", lines: ["const x = 1;"] }]);
    // clean.ts has no test file so test-coverage triggers — disable it
    const reviewer2 = new PRReviewer({ rules: ["no-console-log", "no-todo", "no-any"] });
    const result = reviewer2.review(diff, ["src/clean.ts"]);
    assert.equal(result.score, 100);
  });

  it("deducts 20 per error finding", () => {
    const reviewer = new PRReviewer({ rules: ["no-secrets"] });
    const diff = buildDiff([
      { path: "src/config.ts", lines: ['const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";'] },
    ]);
    const result = reviewer.review(diff, ["src/config.ts"]);
    assert.equal(result.score, 80);
  });

  it("deducts 5 per warning finding", () => {
    const reviewer = new PRReviewer({ rules: ["no-console-log"] });
    const diff = buildDiff([
      { path: "src/app.ts", lines: ['console.log("a");', 'console.log("b");'] },
    ]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.equal(result.score, 90);
  });

  it("score floors at 0", () => {
    const reviewer = new PRReviewer({ rules: ["no-secrets"] });
    const lines = Array.from({ length: 10 }, () => 'const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";');
    const diff = buildDiff([{ path: "src/config.ts", lines }]);
    const result = reviewer.review(diff, ["src/config.ts"]);
    assert.equal(result.score, 0);
  });
});

// ── Approval threshold ──────────────────────────────────────────────

describe("PRReviewer approval", () => {
  it("approves when score >= minScore and no errors", () => {
    const reviewer = new PRReviewer({ minScore: 70, rules: ["no-console-log"] });
    const diff = buildDiff([{ path: "src/app.ts", lines: ["const x = 1;"] }]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.equal(result.approved, true);
  });

  it("blocks when score < minScore", () => {
    const reviewer = new PRReviewer({ minScore: 95, rules: ["no-console-log"] });
    const diff = buildDiff([
      { path: "src/app.ts", lines: ['console.log("a");', 'console.log("b");'] },
    ]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.equal(result.approved, false);
    assert.ok(result.score < 95);
  });

  it("blocks when errors exceed maxErrors", () => {
    const reviewer = new PRReviewer({ maxErrors: 0, rules: ["no-secrets"] });
    const diff = buildDiff([
      { path: "src/config.ts", lines: ['const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";'] },
    ]);
    const result = reviewer.review(diff, ["src/config.ts"]);
    assert.equal(result.approved, false);
  });

  it("blocks when warnings exceed maxWarnings", () => {
    const reviewer = new PRReviewer({ maxWarnings: 1, rules: ["no-console-log"] });
    const diff = buildDiff([
      { path: "src/app.ts", lines: ['console.log("a");', 'console.log("b");'] },
    ]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.equal(result.approved, false);
  });

  it("uses default minScore of 70", () => {
    const reviewer = new PRReviewer({ rules: ["no-secrets"] });
    // One error = score 80, which is >= 70 but has 1 error > maxErrors(0)
    const diff = buildDiff([
      { path: "src/config.ts", lines: ['const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";'] },
    ]);
    const result = reviewer.review(diff, ["src/config.ts"]);
    assert.equal(result.approved, false); // blocked by maxErrors
  });
});

// ── Finding aggregation ─────────────────────────────────────────────

describe("PRReviewer finding aggregation", () => {
  it("collects findings from multiple rules", () => {
    const reviewer = new PRReviewer({ rules: ["no-console-log", "no-todo"] });
    const diff = buildDiff([
      { path: "src/app.ts", lines: ['console.log("x");', "// TODO: fix"] },
    ]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.equal(result.findings.length, 2);
    const rules = result.findings.map((f) => f.rule);
    assert.ok(rules.includes("no-console-log"));
    assert.ok(rules.includes("no-todo"));
  });

  it("collects findings from multiple files", () => {
    const reviewer = new PRReviewer({ rules: ["no-console-log"] });
    const diff = buildDiff([
      { path: "src/a.ts", lines: ['console.log("a");'] },
      { path: "src/b.ts", lines: ['console.log("b");'] },
    ]);
    const result = reviewer.review(diff, ["src/a.ts", "src/b.ts"]);
    assert.equal(result.findings.length, 2);
  });

  it("only runs selected rules", () => {
    const reviewer = new PRReviewer({ rules: ["no-todo"] });
    const diff = buildDiff([
      { path: "src/app.ts", lines: ['console.log("x");'] },
    ]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.equal(result.findings.length, 0); // no-console-log not selected
  });
});

// ── Summary & formatting ────────────────────────────────────────────

describe("PRReviewer formatting", () => {
  it("summary includes APPROVED for passing review", () => {
    const reviewer = new PRReviewer({ rules: ["no-console-log"] });
    const diff = buildDiff([{ path: "src/app.ts", lines: ["const x = 1;"] }]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    assert.ok(result.summary.includes("APPROVED"));
  });

  it("summary includes BLOCKED for failing review", () => {
    const reviewer = new PRReviewer({ maxErrors: 0, rules: ["no-secrets"] });
    const diff = buildDiff([
      { path: "src/config.ts", lines: ['const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";'] },
    ]);
    const result = reviewer.review(diff, ["src/config.ts"]);
    assert.ok(result.summary.includes("BLOCKED"));
  });

  it("formatFindings includes score", () => {
    const reviewer = new PRReviewer({ rules: ["no-console-log"] });
    const diff = buildDiff([{ path: "src/app.ts", lines: ['console.log("x");'] }]);
    const result = reviewer.review(diff, ["src/app.ts"]);
    const formatted = reviewer.formatFindings(result);
    assert.ok(formatted.includes("TierZero Review:"));
    assert.ok(formatted.includes("/100"));
  });
});
