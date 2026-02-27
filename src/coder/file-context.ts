/**
 * File context gatherer — discovers and reads relevant source files from
 * a codebase to send as context to the coding LLM.
 *
 * Uses glob-based include/exclude patterns and sorts by relevance to the
 * ticket content so the most useful files are sent first within the
 * context budget.
 */

import fs from "fs/promises";
import path from "path";
import type {
  CodebaseConfig,
  FileContextEntry,
} from "./types.js";
import {
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
} from "./types.js";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Check if a relative path matches any of the given glob-style patterns.
 * Supports: **, *, and literal segments.
 */
export function matchesGlob(relativePath: string, pattern: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const regex = globToRegex(pattern);
  return regex.test(normalized);
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `**` (any depth), `*` (single segment wildcard), and literal chars.
 */
export function globToRegex(pattern: string): RegExp {
  // Use placeholders to prevent later replacement steps from corrupting
  // regex syntax inserted by earlier steps (e.g. `.*` contains `*` which
  // the single-star step would otherwise turn into `[^/]*`).
  const DOUBLE_STAR_SLASH = "\x00DS\x00"; // **/
  const DOUBLE_STAR       = "\x00DA\x00"; // **
  const SINGLE_STAR       = "\x00SS\x00"; // *
  const QUESTION          = "\x00QQ\x00"; // ?

  let s = pattern.replace(/\\/g, "/");
  // Tokenise glob constructs before escaping
  s = s.replace(/\*\*\//g, DOUBLE_STAR_SLASH);
  s = s.replace(/\*\*/g,   DOUBLE_STAR);
  s = s.replace(/\*/g,     SINGLE_STAR);
  s = s.replace(/\?/g,     QUESTION);
  // Escape regex-special chars in literal parts
  s = s.replace(/[.+^${}()|[\]]/g, "\\$&");
  // Replace tokens with regex equivalents
  s = s.replace(new RegExp(DOUBLE_STAR_SLASH.replace(/\x00/g, "\\x00"), "g"), "(.+/)?");
  s = s.replace(new RegExp(DOUBLE_STAR.replace(/\x00/g, "\\x00"), "g"),       ".*");
  s = s.replace(new RegExp(SINGLE_STAR.replace(/\x00/g, "\\x00"), "g"),       "[^/]*");
  s = s.replace(new RegExp(QUESTION.replace(/\x00/g, "\\x00"), "g"),          "[^/]");

  return new RegExp(`^${s}$`, "i");
}

/**
 * Score how relevant a file path is to the ticket text.
 * Higher = more relevant. Simple keyword overlap heuristic.
 */
export function relevanceScore(relativePath: string, ticketText: string): number {
  const pathParts = relativePath
    .toLowerCase()
    .replace(/[/\\._-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const ticketWords = new Set(
    ticketText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

  let score = 0;
  for (const part of pathParts) {
    if (ticketWords.has(part)) score += 2;
    for (const tw of ticketWords) {
      if (tw.includes(part) || part.includes(tw)) score += 1;
    }
  }

  // Boost key files
  const basename = path.basename(relativePath).toLowerCase();
  if (basename === "readme.md" || basename === "package.json" || basename === "agents.md") score += 3;
  if (basename.includes("test")) score += 1; // tests help understand expected behavior

  return score;
}

/**
 * Check if a file is likely binary based on extension.
 */
export function isBinaryFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm",
    ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
    ".woff", ".woff2", ".ttf", ".eot",
    ".exe", ".dll", ".so", ".dylib",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".db", ".sqlite", ".sqlite3",
    ".pyc", ".pyo", ".class",
  ]);
  return binaryExts.has(ext);
}

// ---------------------------------------------------------------------------
// Main context gatherer
// ---------------------------------------------------------------------------

/**
 * Walk a codebase directory and collect relevant source files.
 * Returns files sorted by relevance to the ticket text, within the
 * configured context character budget.
 */
export async function gatherFileContext(
  codebase: CodebaseConfig,
  ticketText: string,
): Promise<FileContextEntry[]> {
  const includePatterns = codebase.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
  const excludePatterns = codebase.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
  const maxChars = codebase.maxContextChars ?? 200_000;

  const allFiles: Array<{ relativePath: string; fullPath: string }> = [];

  // Recursively walk the directory
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(codebase.path, fullPath).replace(/\\/g, "/");

      // Check excludes first (cheaper than includes)
      if (excludePatterns.some((p) => matchesGlob(relativePath, p))) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (isBinaryFile(entry.name)) continue;
        if (includePatterns.some((p) => matchesGlob(relativePath, p))) {
          allFiles.push({ relativePath, fullPath });
        }
      }
    }
  }

  await walk(codebase.path);

  // Score and sort by relevance
  const scored = allFiles.map((f) => ({
    ...f,
    score: relevanceScore(f.relativePath, ticketText),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Read files within budget
  const results: FileContextEntry[] = [];
  let totalChars = 0;

  for (const file of scored) {
    if (totalChars >= maxChars) break;

    try {
      const content = await fs.readFile(file.fullPath, "utf-8");
      const sizeBytes = Buffer.byteLength(content, "utf-8");

      // Skip very large files (>50KB individually)
      if (content.length > 50_000) continue;

      if (totalChars + content.length > maxChars) continue;

      results.push({
        relativePath: file.relativePath,
        content,
        sizeBytes,
      });
      totalChars += content.length;
    } catch {
      // Skip files we can't read
    }
  }

  return results;
}

/**
 * Format gathered file context into a string for the coding LLM prompt.
 */
export function formatFileContext(files: FileContextEntry[]): string {
  if (!files.length) return "(No source files available)";

  return files
    .map((f) => `### ${f.relativePath}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
}

// Export for testing
export const _testExports = {
  matchesGlob,
  globToRegex,
  relevanceScore,
  isBinaryFile,
  formatFileContext,
};
