/**
 * Shared types and utilities for all knowledge-base importers.
 *
 * Each importer fetches content from an external source, converts it to
 * markdown, and writes files into the knowledge/ folder so the user can
 * run `npm run index` as normal afterwards.
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ImportedDoc {
  /** Relative path of the file written, e.g. "wiki/runbooks-password-reset.md" */
  filename: string;
  /** Original source URL or path */
  source: string;
  /** Approximate word count of the written content */
  wordCount: number;
}

export interface IngestResult {
  imported: number;
  /** Files skipped because an identical version already existed */
  skipped: number;
  errors: Array<{ source: string; error: string }>;
  docs: ImportedDoc[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// File writer (idempotent -- skips if content hash unchanged)
// ---------------------------------------------------------------------------

/**
 * Write `content` to `filePath`.
 * Returns true if the file was written, false if it was skipped (identical content).
 */
export async function writeIfChanged(filePath: string, content: string): Promise<boolean> {
  const newHash = crypto.createHash("sha256").update(content).digest("hex");

  try {
    const existing = await fs.readFile(filePath, "utf-8");
    const oldHash = crypto.createHash("sha256").update(existing).digest("hex");
    if (oldHash === newHash) return false;
  } catch {
    // File doesn't exist yet — write it
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Slug / filename helpers
// ---------------------------------------------------------------------------

/**
 * Convert an arbitrary string into a safe filename stem.
 * e.g. "How to Reset a Password?" → "how-to-reset-a-password"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")   // drop punctuation
    .replace(/[\s_]+/g, "-")    // spaces/underscores → dash
    .replace(/-{2,}/g, "-")     // collapse multiple dashes
    .replace(/^-|-$/g, "");     // trim leading/trailing dashes
}

/** Count words in a string (split on whitespace). */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// htmlToMarkdown — zero-dependency HTML → Markdown converter
// ---------------------------------------------------------------------------

/**
 * Convert a subset of HTML to readable Markdown.
 * Handles: headings, paragraphs, lists, inline code, code blocks, links, bold/italic.
 * Good enough for wiki/Confluence/web pages fed to an LLM — not a full spec parser.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Normalise line endings and collapse excessive whitespace inside tags
  md = md.replace(/\r\n/g, "\n");

  // Remove <script>, <style>, <nav>, <header>, <footer>, <aside> blocks entirely
  md = md.replace(/<(script|style|nav|header|footer|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Code blocks — preserve content literally
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    const raw = decodeEntities(code.replace(/<[^>]+>/g, ""));
    return `\n\`\`\`\n${raw}\n\`\`\`\n`;
  });
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    const raw = decodeEntities(code.replace(/<[^>]+>/g, ""));
    return `\n\`\`\`\n${raw}\n\`\`\`\n`;
  });

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${stripTags(t)}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${stripTags(t)}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${stripTags(t)}\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${stripTags(t)}\n`);
  md = md.replace(/<h[56][^>]*>([\s\S]*?)<\/h[56]>/gi, (_, t) => `\n##### ${stripTags(t)}\n`);

  // Horizontal rules
  md = md.replace(/<hr[^>]*\/?>/gi, "\n---\n");

  // Bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, t) => `**${stripTags(t)}**`);
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, t) => `_${stripTags(t)}_`);

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${stripTags(t)}\``);

  // Links — keep text and href
  md = md.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, text) => `[${stripTags(text)}](${href})`);

  // Images — alt text only
  md = md.replace(/<img[^>]+alt=["']([^"']*)["'][^>]*\/?>/gi, (_, alt) => alt ? `_${alt}_` : "");

  // List items
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripTags(t).trim()}\n`);
  md = md.replace(/<\/?[uo]l[^>]*>/gi, "\n");

  // Table cells → space-separated
  md = md.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, (_, t) => `| **${stripTags(t).trim()}** `);
  md = md.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (_, t) => `| ${stripTags(t).trim()} `);
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => `${row}|\n`);
  md = md.replace(/<\/?t(able|head|body|foot|r)[^>]*>/gi, "\n");

  // Block elements → newlines
  md = md.replace(/<\/?p[^>]*>/gi, "\n");
  md = md.replace(/<br[^>]*\/?>/gi, "\n");
  md = md.replace(/<div[^>]*>/gi, "\n");
  md = md.replace(/<\/div>/gi, "\n");
  md = md.replace(/<blockquote[^>]*>/gi, "\n> ");
  md = md.replace(/<\/blockquote>/gi, "\n");

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = decodeEntities(md);

  // Collapse 3+ blank lines to 2
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g,   "&")
    .replace(/&lt;/g,    "<")
    .replace(/&gt;/g,    ">")
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/&apos;/g,  "'")
    .replace(/&nbsp;/g,  " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

// Export for testing
export const _testExports = { slugify, countWords, htmlToMarkdown, writeIfChanged, decodeEntities };
