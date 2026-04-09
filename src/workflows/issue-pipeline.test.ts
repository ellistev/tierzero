import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTestOutput } from "./issue-pipeline";
import { checkStagedFiles } from "../security/pre-commit-check";

describe("parseTestOutput", () => {
  it("parses node:test output with all passing", () => {
    const output = `
      ✔ some test (1ms)
      ✔ another test (2ms)
      ℹ tests 20
      ℹ suites 5
      ℹ pass 20
      ℹ fail 0
    `;
    const result = parseTestOutput(output);
    assert.equal(result.passed, true);
    assert.equal(result.total, 20);
    assert.equal(result.passing, 20);
    assert.equal(result.failing, 0);
  });

  it("parses output with failures", () => {
    const output = `
      ✔ passes (1ms)
      ✗ fails (2ms)
      ℹ tests 10
      ℹ pass 8
      ℹ fail 2
    `;
    const result = parseTestOutput(output);
    assert.equal(result.passed, false);
    assert.equal(result.total, 10);
    assert.equal(result.passing, 8);
    assert.equal(result.failing, 2);
  });

  it("returns failed for empty output", () => {
    const result = parseTestOutput("");
    assert.equal(result.passed, false);
    assert.equal(result.total, 0);
    assert.equal(result.passing, 0);
    assert.equal(result.failing, 0);
  });

  it("preserves raw output", () => {
    const raw = "some test output here";
    const result = parseTestOutput(raw);
    assert.equal(result.output, raw);
  });

  it("parses real TierZero test output", () => {
    const output = `
✔ IntentEngine (245.7234ms)
✔ SkillGenerator (7.2754ms)
ℹ tests 263
ℹ suites 66
ℹ pass 263
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2196.5876
    `;
    const result = parseTestOutput(output);
    assert.equal(result.passed, true);
    assert.equal(result.total, 263);
    assert.equal(result.passing, 263);
    assert.equal(result.failing, 0);
  });
});

describe("pre-PR secret gate", () => {
  it("passes clean changed files", () => {
    const result = checkStagedFiles(["src/workflows/issue-pipeline.ts"]);
    assert.equal(result.passed, true);
  });

  it("flags secret-bearing pending files", () => {
    const dir = mkdtempSync(join(tmpdir(), "tierzero-secret-gate-"));
    const file = join(dir, "pending-secret.ts");

    try {
      writeFileSync(file, 'const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";\n', "utf-8");
      const result = checkStagedFiles([file]);
      assert.equal(result.passed, false);
      assert.ok(result.findings.length > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
