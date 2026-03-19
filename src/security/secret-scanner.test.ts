import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  scanFile,
  auditGitignore,
  generateReport,
  SECRET_PATTERNS,
  type ScanFinding,
  type GitIgnoreAuditResult,
} from "./secret-scanner.js";
import { checkStagedFiles } from "./pre-commit-check.js";

// ── Helpers ─────────────────────────────────────────────────────────

function scan(file: string, lines: string[]): ScanFinding[] {
  return scanFile(file, lines.join("\n"));
}

// ── Pattern detection ───────────────────────────────────────────────

describe("secret-scanner patterns", () => {
  it("detects OpenAI API keys (sk-*)", () => {
    const findings = scan("src/config.ts", [
      'const key = "sk-aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJ";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "openai-key");
  });

  it("detects GitHub tokens (ghp_*)", () => {
    const findings = scan("src/config.ts", [
      "const token = ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmN;",
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "github-token");
  });

  it("detects Slack tokens (xoxb-*)", () => {
    const findings = scan("src/config.ts", [
      'const token = "xoxb-1234567890-abcdefghij";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "slack-token");
  });

  it("detects AWS access keys (AKIA*)", () => {
    const findings = scan("src/config.ts", [
      "const key = AKIAIOSFODNN7EXAMPLE;",
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "aws-key");
  });

  it("detects Bearer tokens", () => {
    const findings = scan("src/config.ts", [
      'const auth = "Bearer eyJhbGciOiJIUzI1NiJ9abcdef";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "bearer-token");
  });

  it("detects JWT tokens", () => {
    const findings = scan("src/config.ts", [
      'const jwt = "eyJhbGciOiJIUzI1NiIsInR5.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fwp";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "jwt-token");
  });

  it("detects hardcoded passwords", () => {
    const findings = scan("src/config.ts", [
      'const password = "mySuperSecretPassword123";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "password-assignment");
  });

  it("detects connection strings with credentials", () => {
    const findings = scan("src/config.ts", [
      'const db = "postgres://admin:secretpass@db.example.com/mydb";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "connection-string");
  });

  it("detects private keys", () => {
    const findings = scan("src/config.ts", [
      "-----BEGIN RSA PRIVATE KEY-----",
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "private-key");
  });

  it("detects API key assignments", () => {
    const findings = scan("src/config.ts", [
      'const api_key = "abcdefghijklmnopqrstuvwxyz123456";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "api-key-assignment");
  });

  it("detects base64-encoded secrets", () => {
    const findings = scan("src/config.ts", [
      'const credential = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODk=";',
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, "base64-secret");
  });
});

// ── Skipping ────────────────────────────────────────────────────────

describe("secret-scanner skip rules", () => {
  it("skips test files entirely", () => {
    const findings = scan("src/config.test.ts", [
      'const api_key = "abcdefghijklmnopqrstuvwxyz123456";',
    ]);
    assert.equal(findings.length, 0);
  });

  it("skips spec files", () => {
    const findings = scan("src/config.spec.ts", [
      'const password = "reallyLongPassword123";',
    ]);
    assert.equal(findings.length, 0);
  });

  it("skips lines with obvious fake values", () => {
    const findings = scan("src/config.ts", [
      'const key = "test-token-123";',
      'const token = "fake-api-key-for-testing";',
    ]);
    assert.equal(findings.length, 0);
  });

  it("does not flag process.env references", () => {
    const findings = scan("src/config.ts", [
      "const key = process.env.API_KEY;",
      "const secret = process.env.SECRET;",
    ]);
    assert.equal(findings.length, 0);
  });
});

// ── .gitignore audit ────────────────────────────────────────────────

describe("gitignore audit", () => {
  it("detects missing entries", () => {
    // Use a temp dir that has a .gitignore with only some entries
    const tmpDir = process.env.TEMP || "/tmp";
    const fs = require("node:fs");
    const path = require("node:path");
    const testDir = path.join(tmpDir, "secret-scanner-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, ".gitignore"), ".env\nnode_modules/\n");

    const result = auditGitignore(testDir);
    assert.equal(result.complete, false);
    assert.ok(result.missing.length > 0);
    assert.ok(result.missing.includes(".env.*"));
    assert.ok(result.missing.includes("*.pem"));

    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("passes when all entries present", () => {
    const tmpDir = process.env.TEMP || "/tmp";
    const fs = require("node:fs");
    const path = require("node:path");
    const testDir = path.join(tmpDir, "secret-scanner-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, ".gitignore"),
      ".env\n.env.*\n*.pem\n*.key\ncredentials.json\n.tierzero/credentials/\nnode_modules/\n",
    );

    const result = auditGitignore(testDir);
    assert.equal(result.complete, true);
    assert.equal(result.missing.length, 0);

    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

// ── Pre-commit check ────────────────────────────────────────────────

describe("pre-commit check", () => {
  it("blocks files with secrets", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const tmpDir = process.env.TEMP || "/tmp";
    const testDir = path.join(tmpDir, "precommit-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    const filePath = path.join(testDir, "config.ts");
    fs.writeFileSync(filePath, 'const key = "sk-aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJ";');

    const result = checkStagedFiles([filePath]);
    assert.equal(result.passed, false);
    assert.ok(result.findings.length > 0);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("passes clean files", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const tmpDir = process.env.TEMP || "/tmp";
    const testDir = path.join(tmpDir, "precommit-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    const filePath = path.join(testDir, "config.ts");
    fs.writeFileSync(filePath, "const key = process.env.API_KEY;");

    const result = checkStagedFiles([filePath]);
    assert.equal(result.passed, true);
    assert.equal(result.findings.length, 0);

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

// ── Report generation ───────────────────────────────────────────────

describe("security report generation", () => {
  it("produces valid report with CLEAN status when no findings", () => {
    const report = generateReport(100, [], [], { missing: [], complete: true });
    assert.equal(report.filesScanned, 100);
    assert.equal(report.findings.length, 0);
    assert.equal(report.gitHistoryClean, true);
    assert.equal(report.gitignoreComplete, true);
    assert.equal(report.status, "CLEAN");
    assert.ok(report.scanDate);
  });

  it("produces FINDINGS status when secrets found", () => {
    const finding: ScanFinding = {
      file: "src/config.ts",
      line: 5,
      pattern: "openai-key",
      match: "sk-a***bHiJ",
      source: "current",
    };
    const report = generateReport(50, [finding], [], { missing: [], complete: true });
    assert.equal(report.status, "FINDINGS");
    assert.equal(report.findings.length, 1);
  });

  it("produces FINDINGS status when gitignore incomplete", () => {
    const report = generateReport(50, [], [], { missing: [".env.*"], complete: false });
    assert.equal(report.status, "FINDINGS");
  });

  it("includes git history findings", () => {
    const historyFinding: ScanFinding = {
      file: "old-config.ts",
      line: 0,
      pattern: "aws-key",
      match: "AKIA***MPLE",
      source: "git-history",
    };
    const report = generateReport(50, [], [historyFinding], { missing: [], complete: true });
    assert.equal(report.gitHistoryClean, false);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].source, "git-history");
  });

  it("produces valid JSON structure", () => {
    const report = generateReport(0, [], [], { missing: [], complete: true });
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    assert.ok("scanDate" in parsed);
    assert.ok("filesScanned" in parsed);
    assert.ok("findings" in parsed);
    assert.ok("gitHistoryClean" in parsed);
    assert.ok("gitignoreComplete" in parsed);
    assert.ok("status" in parsed);
  });
});
