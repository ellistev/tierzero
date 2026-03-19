/**
 * Codebase Context Gatherer for LLM-powered PR review.
 *
 * Before sending a diff to the LLM reviewer, this module automatically
 * gathers relevant context: dependency files the diff imports from,
 * similar files in the same directory (pattern references), the issue
 * description, and test output.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";
import { parseDiff } from "./review-rules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewContext {
  /** Files that the diff imports from (existing code the new code depends on) */
  dependencies: { path: string; content: string }[];

  /** Similar files in the codebase (e.g., if adding a new connector, show existing connector) */
  similarFiles: { path: string; content: string }[];

  /** The issue description + acceptance criteria */
  issueContext: { title: string; body: string; acceptanceCriteria: string[] };

  /** Test output */
  testOutput: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract relative import paths from added lines in a diff.
 * Matches `from "./foo"`, `from "../bar"`, `import "./baz"`.
 */
export function extractImports(diffText: string): string[] {
  const imports = new Set<string>();
  const importRegex = /(?:from|import)\s+["'](\.[^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(diffText)) !== null) {
    imports.add(match[1]);
  }
  return [...imports];
}

/**
 * Resolve an import specifier relative to the importing file's directory.
 * Tries .ts, .tsx, /index.ts extensions if the specifier has no extension.
 */
export function resolveImport(importPath: string, fromFile: string, workDir: string): string | null {
  const dir = dirname(join(workDir, fromFile));
  const candidate = join(dir, importPath);

  const extensions = ["", ".ts", ".tsx", "/index.ts"];
  for (const ext of extensions) {
    const full = candidate + ext;
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Find similar files in the same directory as a changed file.
 * E.g., if editing `src/connectors/jira.ts`, returns other `.ts` files
 * in `src/connectors/` as pattern references.
 */
export function findSimilarFiles(changedFile: string, workDir: string, maxFiles: number = 2): string[] {
  const fullPath = join(workDir, changedFile);
  const dir = dirname(fullPath);
  const ext = extname(changedFile);
  const base = basename(changedFile);

  if (!existsSync(dir)) return [];

  try {
    const entries = readdirSync(dir);
    return entries
      .filter((e) => {
        if (e === base) return false;
        if (!e.endsWith(ext)) return false;
        // Skip test files and index files
        if (/\.test\.[jt]sx?$/.test(e) || /\.spec\.[jt]sx?$/.test(e)) return false;
        if (e === "index.ts" || e === "index.js") return false;
        return true;
      })
      .slice(0, maxFiles)
      .map((e) => join(dir, e));
  } catch {
    return [];
  }
}

/**
 * Extract acceptance criteria from an issue body.
 * Looks for checkbox lists (`- [ ]` or `- [x]`) or items under
 * a heading containing "acceptance criteria" or "requirements".
 */
export function extractAcceptanceCriteria(body: string): string[] {
  const criteria: string[] = [];

  // Look for checkbox items
  const checkboxRegex = /^[-*]\s*\[[ x]\]\s*(.+)/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRegex.exec(body)) !== null) {
    criteria.push(match[1].trim());
  }

  if (criteria.length > 0) return criteria;

  // Fall back: look for section under "Acceptance Criteria" or "Requirements" heading
  const sectionRegex = /#{1,3}\s*(?:acceptance\s*criteria|requirements)\s*\n([\s\S]*?)(?=\n#{1,3}\s|\n*$)/i;
  const sectionMatch = body.match(sectionRegex);
  if (sectionMatch) {
    const lines = sectionMatch[1].split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (trimmed.length > 0) {
        criteria.push(trimmed);
      }
    }
  }

  return criteria;
}

function safeReadFile(filePath: string, maxBytes: number = 50_000): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.length > maxBytes ? content.slice(0, maxBytes) + "\n... (truncated)" : content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main gatherer
// ---------------------------------------------------------------------------

export interface GatherContextOptions {
  /** Full unified diff text */
  diffText: string;
  /** List of changed file paths (relative to workDir) */
  filesChanged: string[];
  /** Working directory (repo root) */
  workDir: string;
  /** Issue title */
  issueTitle: string;
  /** Issue body / description */
  issueBody: string;
  /** Test output string */
  testOutput: string;
  /** Max dependency files to include (default: 5) */
  maxDependencies?: number;
  /** Max similar files to include (default: 3) */
  maxSimilarFiles?: number;
}

/**
 * Gather all context needed for an LLM-powered code review.
 */
export function gatherReviewContext(opts: GatherContextOptions): ReviewContext {
  const {
    diffText,
    filesChanged,
    workDir,
    issueTitle,
    issueBody,
    testOutput,
    maxDependencies = 5,
    maxSimilarFiles = 3,
  } = opts;

  // 1. Extract imports from diff and resolve to real files
  const importPaths = extractImports(diffText);
  const depSet = new Set<string>();
  const dependencies: { path: string; content: string }[] = [];

  for (const changedFile of filesChanged) {
    for (const imp of importPaths) {
      const resolved = resolveImport(imp, changedFile, workDir);
      if (resolved && !depSet.has(resolved)) {
        depSet.add(resolved);
        const content = safeReadFile(resolved);
        if (content) {
          dependencies.push({ path: resolved, content });
        }
      }
    }
    if (dependencies.length >= maxDependencies) break;
  }

  // 2. Find similar files for pattern comparison
  const similarSet = new Set<string>();
  const similarFiles: { path: string; content: string }[] = [];

  for (const changedFile of filesChanged) {
    if (similarFiles.length >= maxSimilarFiles) break;
    const candidates = findSimilarFiles(changedFile, workDir, 2);
    for (const candidate of candidates) {
      if (similarFiles.length >= maxSimilarFiles) break;
      if (similarSet.has(candidate) || depSet.has(candidate)) continue;
      similarSet.add(candidate);
      const content = safeReadFile(candidate);
      if (content) {
        similarFiles.push({ path: candidate, content });
      }
    }
  }

  // 3. Extract acceptance criteria from issue body
  const acceptanceCriteria = extractAcceptanceCriteria(issueBody);

  // 4. Build context
  return {
    dependencies,
    similarFiles,
    issueContext: {
      title: issueTitle,
      body: issueBody,
      acceptanceCriteria,
    },
    testOutput,
  };
}
