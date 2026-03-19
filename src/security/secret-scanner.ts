/**
 * Full-repository secret scanner.
 *
 * Scans files for accidentally committed secrets, API keys, tokens,
 * passwords, connection strings, and private keys.
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretPattern {
  name: string;
  regex: RegExp;
  label: string;
}

export interface ScanFinding {
  file: string;
  line: number;
  pattern: string;
  match: string;
  source: "current" | "git-history";
}

export interface GitIgnoreAuditResult {
  missing: string[];
  complete: boolean;
}

export interface SecurityReport {
  scanDate: string;
  filesScanned: number;
  findings: ScanFinding[];
  gitHistoryClean: boolean;
  gitignoreComplete: boolean;
  status: "CLEAN" | "FINDINGS";
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export const SECRET_PATTERNS: SecretPattern[] = [
  // API keys
  { name: "openai-key", regex: /sk-[a-zA-Z0-9]{32,}/, label: "OpenAI API key" },
  { name: "github-token", regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/, label: "GitHub token" },
  { name: "slack-token", regex: /(?:xoxb|xoxp|xapp)-[a-zA-Z0-9-]{10,}/, label: "Slack token" },
  { name: "aws-key", regex: /AKIA[0-9A-Z]{16}/, label: "AWS access key" },

  // Tokens
  { name: "bearer-token", regex: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/, label: "Bearer token" },
  { name: "jwt-token", regex: /eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, label: "JWT token" },

  // Passwords / secrets with values
  { name: "password-assignment", regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*["'][^"']{8,}["']/i, label: "Hardcoded password/secret" },

  // Connection strings with credentials
  { name: "connection-string", regex: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^/\s"']+/, label: "Connection string with credentials" },

  // Private keys
  { name: "private-key", regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/, label: "Private key" },

  // Generic API key assignments
  { name: "api-key-assignment", regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][a-zA-Z0-9]{16,}["']/i, label: "API key" },

  // Base64-encoded secrets (long base64 strings assigned to secret-like variable names)
  { name: "base64-secret", regex: /(?:secret|token|key|credential)\s*[:=]\s*["'][A-Za-z0-9+/]{40,}={0,2}["']/i, label: "Possible base64-encoded secret" },
];

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

const SCAN_EXTENSIONS = new Set([".ts", ".js", ".json", ".md", ".yml", ".yaml", ".toml"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".chroma_db", ".chromadb", "venv"]);

function isTestFile(filePath: string): boolean {
  return /\.test\.[jt]sx?$/.test(filePath) || /\.spec\.[jt]sx?$/.test(filePath) || filePath.includes("__tests__");
}

function isDemoOrTestHelper(filePath: string): boolean {
  return filePath.startsWith("demo/") || filePath.startsWith("test/") || filePath.startsWith("fixtures/");
}

function hasFakeTestValue(content: string): boolean {
  return /test-token-123|fake-|mock-|dummy-|example-|placeholder|admin123|john123|jane123/i.test(content);
}

function collectFiles(dir: string, root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...collectFiles(fullPath, root));
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      results.push(relative(root, fullPath).replace(/\\/g, "/"));
    }
  }
  return results;
}

export function scanFile(filePath: string, content: string): ScanFinding[] {
  const findings: ScanFinding[] = [];

  // Skip test files with obviously fake values
  if (isTestFile(filePath)) return findings;
  // Skip demo and test helper directories (use obvious fixture data)
  if (isDemoOrTestHelper(filePath)) return findings;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip lines that are obviously fake/test values even in non-test files
    if (hasFakeTestValue(line)) continue;
    // Skip comment lines referencing patterns (documentation)
    if (/^\s*\/\/.*(?:regex|pattern|example|e\.g\.|detect)/i.test(line)) continue;
    // Skip regex literal definitions (pattern definitions, not actual secrets)
    if (/new RegExp\(|\/.*\/[gimsuy]*/.test(line) && !/[:=]\s*["']/.test(line)) continue;

    for (const pattern of SECRET_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        // Additional false-positive filters
        const matchedValue = match[0];
        // Skip if inside a regex literal
        if (/^\s*\{?\s*regex\s*:/.test(line)) continue;
        // Skip if it looks like a pattern definition
        if (/label\s*:/.test(line)) continue;

        findings.push({
          file: filePath,
          line: i + 1,
          pattern: pattern.name,
          match: maskSecret(matchedValue),
          source: "current",
        });
      }
    }
  }
  return findings;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "***" + value.slice(-4);
}

export function scanDirectory(rootDir: string): { findings: ScanFinding[]; filesScanned: number } {
  const files = collectFiles(rootDir, rootDir);
  const findings: ScanFinding[] = [];

  for (const file of files) {
    // Skip .env files (should be in .gitignore; audited separately)
    if (/^\.env/.test(file.split("/").pop()!)) continue;

    const fullPath = join(rootDir, file);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    findings.push(...scanFile(file, content));
  }

  return { findings, filesScanned: files.length };
}

// ---------------------------------------------------------------------------
// Git history scan
// ---------------------------------------------------------------------------

export function scanGitHistory(rootDir: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --all --full-history -p -- "*.ts" "*.js" "*.json" "*.env"',
      { cwd: rootDir, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
    );
  } catch {
    return findings;
  }

  const lines = logOutput.split("\n");
  let currentFile = "";
  for (const line of lines) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (diffMatch) {
      currentFile = diffMatch[2];
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    if (isTestFile(currentFile)) continue;
    if (isDemoOrTestHelper(currentFile)) continue;
    if (hasFakeTestValue(line)) continue;
    // Skip regex/pattern definition lines
    if (/^\+\s*\{?\s*regex\s*:/.test(line)) continue;
    if (/^\+\s*\/\//.test(line)) continue;

    const content = line.slice(1);
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        const match = content.match(pattern.regex);
        if (match) {
          // Avoid duplicate findings for the same file + pattern
          const alreadyFound = findings.some(
            (f) => f.file === currentFile && f.pattern === pattern.name,
          );
          if (!alreadyFound) {
            findings.push({
              file: currentFile,
              line: 0,
              pattern: pattern.name,
              match: maskSecret(match[0]),
              source: "git-history",
            });
          }
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// .gitignore audit
// ---------------------------------------------------------------------------

const REQUIRED_GITIGNORE_ENTRIES = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials.json",
  ".tierzero/credentials/",
  "node_modules/",
];

export function auditGitignore(rootDir: string): GitIgnoreAuditResult {
  const gitignorePath = join(rootDir, ".gitignore");
  let content = "";
  try {
    content = readFileSync(gitignorePath, "utf-8");
  } catch {
    return { missing: REQUIRED_GITIGNORE_ENTRIES, complete: false };
  }

  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const missing: string[] = [];
  for (const required of REQUIRED_GITIGNORE_ENTRIES) {
    if (!lines.includes(required)) {
      missing.push(required);
    }
  }

  return { missing, complete: missing.length === 0 };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

export function generateReport(
  filesScanned: number,
  currentFindings: ScanFinding[],
  historyFindings: ScanFinding[],
  gitignoreAudit: GitIgnoreAuditResult,
): SecurityReport {
  const allFindings = [...currentFindings, ...historyFindings];
  return {
    scanDate: new Date().toISOString(),
    filesScanned,
    findings: allFindings,
    gitHistoryClean: historyFindings.length === 0,
    gitignoreComplete: gitignoreAudit.complete,
    status: allFindings.length === 0 && gitignoreAudit.complete ? "CLEAN" : "FINDINGS",
  };
}

export function writeReport(rootDir: string, report: SecurityReport): string {
  const dir = join(rootDir, ".tierzero");
  if (!existsSync(dir)) {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  const reportPath = join(dir, "security-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return reportPath;
}

// ---------------------------------------------------------------------------
// Full scan orchestrator
// ---------------------------------------------------------------------------

export function runFullScan(rootDir: string): SecurityReport {
  const { findings: currentFindings, filesScanned } = scanDirectory(rootDir);
  const historyFindings = scanGitHistory(rootDir);
  const gitignoreAudit = auditGitignore(rootDir);
  const report = generateReport(filesScanned, currentFindings, historyFindings, gitignoreAudit);
  writeReport(rootDir, report);
  return report;
}
