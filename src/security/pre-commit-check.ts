/**
 * Pre-commit secret check.
 *
 * Scans staged files for secrets and blocks the commit if any are found.
 * Usage: npm run security:check
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanFile, type ScanFinding } from "./secret-scanner.js";

export function getStagedFiles(): string[] {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function checkStagedFiles(stagedFiles?: string[]): {
  findings: ScanFinding[];
  passed: boolean;
} {
  const files = stagedFiles ?? getStagedFiles();
  const findings: ScanFinding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    findings.push(...scanFile(file, content));
  }

  return { findings, passed: findings.length === 0 };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].includes("pre-commit-check")) {
  const { findings, passed } = checkStagedFiles();

  if (!passed) {
    console.error("\n=== SECRET CHECK FAILED ===\n");
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line} - ${f.pattern}: ${f.match}`);
    }
    console.error(
      "\nSecrets detected in staged files. Remove them before committing.\n",
    );
    process.exit(1);
  }

  console.log("Security check passed - no secrets found in staged files.");
  process.exit(0);
}
