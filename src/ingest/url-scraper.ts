/**
 * URL Scraper — fetch arbitrary URLs and convert them to Markdown.
 *
 * Supported content types:
 *   - text/html              → htmlToMarkdown()
 *   - text/plain, text/markdown → saved as-is
 *   - application/pdf        → delegates to @langchain/community PDFLoader
 *
 * Writes to knowledge/web/<domain>/<slug>.md.
 * Optionally respects robots.txt (enabled by default).
 */

import path from "path";
import {
  IngestResult,
  ImportedDoc,
  htmlToMarkdown,
  writeIfChanged,
  slugify,
  countWords,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface UrlScraperOptions {
  /** Output root directory (defaults to "knowledge") */
  outputDir?: string;
  /** If true, skip URLs disallowed by robots.txt (default: true) */
  respectRobots?: boolean;
  /** User-agent sent to robots.txt and page requests */
  userAgent?: string;
  /** Fetch timeout in ms (default: 15000) */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract the domain from a URL for use as a folder name.
 * "https://docs.example.com/kb/article?v=1" → "docs.example.com"
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown-domain";
  }
}

/**
 * Derive a safe filename stem from a URL path.
 * "https://docs.example.com/kb/Password-Reset?v=1" → "kb-password-reset.md"
 */
export function urlToFilename(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split("/")
      .map(decodeURIComponent)
      .map(slugify)
      .filter(Boolean);
    const stem = parts.join("-") || "index";
    return stem.slice(0, 100) + ".md";
  } catch {
    return "index.md";
  }
}

/**
 * Detect content type from a Content-Type header value.
 * Returns one of: "html" | "text" | "pdf" | "unknown"
 */
export function detectContentType(contentType: string): "html" | "text" | "pdf" | "unknown" {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (ct === "text/html") return "html";
  if (ct === "text/plain" || ct === "text/markdown") return "text";
  if (ct === "application/pdf") return "pdf";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Robots.txt parser
// ---------------------------------------------------------------------------

interface RobotsRules {
  disallowed: string[];
  allowed: string[];
}

function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
  const rules: RobotsRules = { disallowed: [], allowed: [] };
  let applicable = false;

  for (const line of text.split(/\n/)) {
    const trimmed = line.split("#")[0].trim();
    if (!trimmed) continue;

    const [field, ...rest] = trimmed.split(":");
    const value = rest.join(":").trim();

    if (field.toLowerCase() === "user-agent") {
      applicable = value === "*" || value.toLowerCase() === userAgent.toLowerCase();
    } else if (applicable) {
      if (field.toLowerCase() === "disallow" && value) {
        rules.disallowed.push(value);
      } else if (field.toLowerCase() === "allow" && value) {
        rules.allowed.push(value);
      }
    }
  }

  return rules;
}

function isAllowedByRobots(urlPath: string, rules: RobotsRules): boolean {
  // "Allow" takes precedence over "Disallow" when both match
  const allowed = rules.allowed.some((prefix) => urlPath.startsWith(prefix));
  if (allowed) return true;
  const blocked = rules.disallowed.some((prefix) => urlPath.startsWith(prefix));
  return !blocked;
}

// ---------------------------------------------------------------------------
// UrlScraper
// ---------------------------------------------------------------------------

export class UrlScraper {
  private readonly opts: Required<UrlScraperOptions>;
  /** Cache of fetched robots.txt rules by origin */
  private readonly robotsCache = new Map<string, RobotsRules>();

  constructor(opts: UrlScraperOptions = {}) {
    this.opts = {
      outputDir: "knowledge",
      respectRobots: true,
      userAgent: "TierZeroBot/1.0",
      timeoutMs: 15_000,
      ...opts,
    };
  }

  private async fetchRobots(origin: string): Promise<RobotsRules> {
    if (this.robotsCache.has(origin)) return this.robotsCache.get(origin)!;

    const rules: RobotsRules = { disallowed: [], allowed: [] };
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { "User-Agent": this.opts.userAgent },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseRobotsTxt(text, this.opts.userAgent);
        this.robotsCache.set(origin, parsed);
        return parsed;
      }
    } catch {
      // Robots.txt not available — assume allowed
    }

    this.robotsCache.set(origin, rules);
    return rules;
  }

  /**
   * Scrape a list of URLs and write Markdown files for each.
   */
  async scrape(urls: string[]): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = { imported: 0, skipped: 0, errors: [], docs: [], durationMs: 0 };

    for (const url of urls) {
      try {
        // Robots.txt check
        if (this.opts.respectRobots) {
          const origin = new URL(url).origin;
          const urlPath = new URL(url).pathname;
          const rules = await this.fetchRobots(origin);
          if (!isAllowedByRobots(urlPath, rules)) {
            result.errors.push({ source: url, error: "Blocked by robots.txt" });
            continue;
          }
        }

        const res = await fetch(url, {
          headers: { "User-Agent": this.opts.userAgent },
          redirect: "follow",
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });

        if (!res.ok) {
          result.errors.push({ source: url, error: `HTTP ${res.status}` });
          continue;
        }

        const rawCt = res.headers.get("content-type") ?? "";
        const ct = detectContentType(rawCt);

        let markdown: string;

        if (ct === "pdf") {
          markdown = await this.handlePdf(url, res);
        } else if (ct === "html") {
          const html = await res.text();
          markdown = htmlToMarkdown(html);
        } else if (ct === "text") {
          markdown = await res.text();
        } else {
          result.errors.push({ source: url, error: `Unsupported content-type: ${rawCt}` });
          continue;
        }

        if (!markdown.trim()) continue;

        const domain = extractDomain(url);
        const filename = urlToFilename(url);
        const outputDir = path.join(this.opts.outputDir, "web", domain);
        const filePath = path.join(outputDir, filename);

        const header = `_Source: ${url}_\n\n`;
        const content = header + markdown;

        const written = await writeIfChanged(filePath, content);
        const doc: ImportedDoc = {
          filename: path.join("web", domain, filename),
          source: url,
          wordCount: countWords(content),
        };

        if (written) {
          result.imported++;
          result.docs.push(doc);
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors.push({
          source: url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  private async handlePdf(url: string, res: Response): Promise<string> {
    // Dynamically import to avoid hard dependency when PDFs aren't used
    const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");

    const arrayBuf = await res.arrayBuffer();
    const blob = new Blob([arrayBuf], { type: "application/pdf" });

    // PDFLoader expects a file path or blob — use blob constructor
    const loader = new PDFLoader(blob);
    const docs = await loader.load();
    return docs.map((d) => d.pageContent).join("\n\n");
  }
}

// Export for testing
export const _testExports = {
  extractDomain,
  urlToFilename,
  detectContentType,
  parseRobotsTxt,
  isAllowedByRobots,
};
