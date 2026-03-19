/**
 * Built-in static analysis review rules for PR review.
 *
 * Each rule analyzes a diff and produces findings without needing an LLM.
 */

export interface ReviewFinding {
  severity: "error" | "warning" | "info";
  file: string;
  line?: number;
  rule: string;
  message: string;
}

export interface ReviewRule {
  name: string;
  description: string;
  check(diff: DiffFile[]): ReviewFinding[];
}

export interface DiffFile {
  path: string;
  additions: DiffLine[];
  /** All files in the changeset (for cross-file checks like test-coverage) */
  allPaths?: string[];
}

export interface DiffLine {
  lineNumber: number;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTestFile(path: string): boolean {
  return /\.test\.[jt]sx?$/.test(path) || /\.spec\.[jt]sx?$/.test(path) || path.includes("__tests__");
}

function isSourceFile(path: string): boolean {
  return /\.[jt]sx?$/.test(path) && !isTestFile(path) && !path.includes("node_modules");
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const noConsoleLog: ReviewRule = {
  name: "no-console-log",
  description: "No console.log/warn/error in production code (test files exempt)",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const file of diff) {
      if (isTestFile(file.path)) continue;
      for (const line of file.additions) {
        if (/\bconsole\.(log|warn|error|debug|info)\b/.test(line.content)) {
          findings.push({
            severity: "warning",
            file: file.path,
            line: line.lineNumber,
            rule: "no-console-log",
            message: `console statement found in production code`,
          });
        }
      }
    }
    return findings;
  },
};

export const noTodo: ReviewRule = {
  name: "no-todo",
  description: "No TODO/FIXME/HACK comments in new code",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const file of diff) {
      for (const line of file.additions) {
        const match = line.content.match(/\b(TODO|FIXME|HACK)\b/);
        if (match) {
          findings.push({
            severity: "warning",
            file: file.path,
            line: line.lineNumber,
            rule: "no-todo",
            message: `${match[1]} comment found in new code`,
          });
        }
      }
    }
    return findings;
  },
};

export const testCoverage: ReviewRule = {
  name: "test-coverage",
  description: "New source files must have corresponding .test.ts files",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const allPaths = diff[0]?.allPaths ?? diff.map((d) => d.path);

    for (const file of diff) {
      if (!isSourceFile(file.path)) continue;
      if (isTestFile(file.path)) continue;

      // Check if a corresponding test file exists in the changeset
      const baseName = file.path.replace(/\.[jt]sx?$/, "");
      const hasTest = allPaths.some(
        (p) => p.startsWith(baseName) && isTestFile(p),
      );

      if (!hasTest) {
        findings.push({
          severity: "warning",
          file: file.path,
          rule: "test-coverage",
          message: `New source file has no corresponding test file`,
        });
      }
    }
    return findings;
  },
};

export const noAny: ReviewRule = {
  name: "no-any",
  description: "Minimize use of `any` type in new code",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const file of diff) {
      if (!isSourceFile(file.path)) continue;
      for (const line of file.additions) {
        // Match `: any`, `as any`, `<any>` but not words containing "any" like "company"
        if (/(?::\s*any\b|as\s+any\b|<any>)/.test(line.content)) {
          findings.push({
            severity: "warning",
            file: file.path,
            line: line.lineNumber,
            rule: "no-any",
            message: `Use of \`any\` type — consider a more specific type`,
          });
        }
      }
    }
    return findings;
  },
};

export const importOrder: ReviewRule = {
  name: "import-order",
  description: "Imports from node: first, then external, then internal",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const file of diff) {
      if (!isSourceFile(file.path)) continue;

      // Collect consecutive import lines
      const imports = file.additions.filter((l) =>
        /^\s*(import\s|}\s*from\s)/.test(l.content),
      );
      if (imports.length < 2) continue;

      let lastCategory = 0; // 0=none, 1=node, 2=external, 3=internal
      for (const line of imports) {
        let category: number;
        if (/from\s+["']node:/.test(line.content)) {
          category = 1;
        } else if (/from\s+["']\./.test(line.content)) {
          category = 3;
        } else {
          category = 2;
        }

        if (category < lastCategory) {
          findings.push({
            severity: "info",
            file: file.path,
            line: line.lineNumber,
            rule: "import-order",
            message: `Import order: node: builtins first, then external, then internal`,
          });
          break; // One finding per file is enough
        }
        lastCategory = category;
      }
    }
    return findings;
  },
};

export const fileSize: ReviewRule = {
  name: "file-size",
  description: "New files should be < 500 lines",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const file of diff) {
      if (file.additions.length >= 500) {
        findings.push({
          severity: "warning",
          file: file.path,
          rule: "file-size",
          message: `File has ${file.additions.length} new lines (threshold: 500)`,
        });
      }
    }
    return findings;
  },
};

export const noSecrets: ReviewRule = {
  name: "no-secrets",
  description: "No hardcoded API keys, tokens, passwords in diff",
  check(diff: DiffFile[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const patterns = [
      { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][a-zA-Z0-9]{16,}["']/i, label: "API key" },
      { regex: /(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i, label: "secret/password" },
      { regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/, label: "GitHub token" },
      { regex: /(?:sk-[a-zA-Z0-9]{32,})/, label: "OpenAI API key" },
      { regex: /(?:xoxb|xoxp|xapp)-[a-zA-Z0-9-]+/, label: "Slack token" },
      { regex: /AKIA[0-9A-Z]{16}/, label: "AWS access key" },
    ];

    for (const file of diff) {
      if (isTestFile(file.path)) continue;
      for (const line of file.additions) {
        for (const { regex, label } of patterns) {
          if (regex.test(line.content)) {
            findings.push({
              severity: "error",
              file: file.path,
              line: line.lineNumber,
              rule: "no-secrets",
              message: `Possible hardcoded ${label} detected`,
            });
          }
        }
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const builtinRules: Record<string, ReviewRule> = {
  "no-console-log": noConsoleLog,
  "no-todo": noTodo,
  "test-coverage": testCoverage,
  "no-any": noAny,
  "import-order": importOrder,
  "file-size": fileSize,
  "no-secrets": noSecrets,
};

/**
 * Parse a unified diff string into DiffFile structures.
 */
export function parseDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileChunks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const pathMatch = chunk.match(/^a\/(.+?)\s+b\/(.+)/m);
    if (!pathMatch) continue;

    const path = pathMatch[2];
    const additions: DiffLine[] = [];
    let lineNumber = 0;

    for (const line of chunk.split("\n")) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        lineNumber = parseInt(hunkMatch[1]);
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions.push({ lineNumber, content: line.slice(1) });
        lineNumber++;
      } else if (!line.startsWith("-")) {
        lineNumber++;
      }
    }

    files.push({ path, additions });
  }

  // Populate allPaths on each file for cross-file checks
  const allPaths = files.map((f) => f.path);
  for (const file of files) {
    file.allPaths = allPaths;
  }

  return files;
}
