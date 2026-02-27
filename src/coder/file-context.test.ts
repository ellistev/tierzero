import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testExports } from "./file-context";

const { matchesGlob, globToRegex, relevanceScore, isBinaryFile, formatFileContext } = _testExports;

// ---------------------------------------------------------------------------
// matchesGlob
// ---------------------------------------------------------------------------

describe("matchesGlob", () => {
  it("matches simple extension patterns", () => {
    assert.ok(matchesGlob("src/main.ts", "**/*.ts"));
    assert.ok(matchesGlob("src/utils/helper.ts", "**/*.ts"));
  });

  it("rejects non-matching extensions", () => {
    assert.ok(!matchesGlob("src/main.ts", "**/*.js"));
  });

  it("matches directory-scoped patterns", () => {
    assert.ok(matchesGlob("node_modules/pkg/index.js", "**/node_modules/**"));
    assert.ok(matchesGlob("vendor/lib.go", "**/vendor/**"));
  });

  it("handles exact filename patterns", () => {
    assert.ok(matchesGlob("Dockerfile", "**/Dockerfile"));
    assert.ok(matchesGlob("src/Dockerfile", "**/Dockerfile"));
  });

  it("normalizes backslashes to forward slashes", () => {
    assert.ok(matchesGlob("src\\utils\\helper.ts", "**/*.ts"));
  });
});

// ---------------------------------------------------------------------------
// relevanceScore
// ---------------------------------------------------------------------------

describe("relevanceScore", () => {
  it("scores zero for completely unrelated path and ticket", () => {
    assert.equal(relevanceScore("src/main.ts", "password reset"), 0);
  });

  it("scores higher when path segments match ticket words", () => {
    const score = relevanceScore("src/auth/password-reset.ts", "user cannot reset password");
    assert.ok(score > 0, `expected positive score, got ${score}`);
  });

  it("boosts readme and package.json", () => {
    const readmeScore = relevanceScore("README.md", "some unrelated ticket");
    const regularScore = relevanceScore("src/index.ts", "some unrelated ticket");
    assert.ok(readmeScore > regularScore, "README.md should be boosted");
  });

  it("boosts test files", () => {
    const testScore = relevanceScore("src/auth/auth.test.ts", "authentication bug");
    const implScore = relevanceScore("src/auth/auth.ts", "authentication bug");
    assert.ok(testScore >= implScore, "test file should score at least as high");
  });
});

// ---------------------------------------------------------------------------
// isBinaryFile
// ---------------------------------------------------------------------------

describe("isBinaryFile", () => {
  it("detects common image formats", () => {
    assert.ok(isBinaryFile("photo.png"));
    assert.ok(isBinaryFile("logo.jpg"));
    assert.ok(isBinaryFile("icon.gif"));
    assert.ok(isBinaryFile("banner.webp"));
  });

  it("detects archives", () => {
    assert.ok(isBinaryFile("package.zip"));
    assert.ok(isBinaryFile("dist.tar.gz"));
  });

  it("detects compiled files", () => {
    assert.ok(isBinaryFile("app.exe"));
    assert.ok(isBinaryFile("lib.dll"));
    assert.ok(isBinaryFile("cache.pyc"));
  });

  it("returns false for text files", () => {
    assert.ok(!isBinaryFile("main.ts"));
    assert.ok(!isBinaryFile("README.md"));
    assert.ok(!isBinaryFile("config.yaml"));
    assert.ok(!isBinaryFile("Dockerfile"));
  });

  it("is case-insensitive", () => {
    assert.ok(isBinaryFile("photo.PNG"));
    assert.ok(isBinaryFile("icon.JPG"));
  });
});

// ---------------------------------------------------------------------------
// formatFileContext
// ---------------------------------------------------------------------------

describe("formatFileContext", () => {
  it("returns placeholder for empty file list", () => {
    assert.ok(formatFileContext([]).includes("No source files available"));
  });

  it("formats files with path headers and code fences", () => {
    const result = formatFileContext([
      { relativePath: "src/main.ts", content: 'console.log("hello");', sizeBytes: 22 },
    ]);
    assert.ok(result.includes("### src/main.ts"));
    assert.ok(result.includes("```"));
    assert.ok(result.includes('console.log("hello")'));
  });

  it("includes multiple files", () => {
    const result = formatFileContext([
      { relativePath: "a.ts", content: "a", sizeBytes: 1 },
      { relativePath: "b.ts", content: "b", sizeBytes: 1 },
    ]);
    assert.ok(result.includes("### a.ts"));
    assert.ok(result.includes("### b.ts"));
  });
});
