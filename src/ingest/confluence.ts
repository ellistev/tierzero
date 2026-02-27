/**
 * Confluence space importer.
 *
 * Fetches all pages in one or more Confluence spaces and writes them as
 * Markdown to knowledge/confluence/<spaceKey>/<slug>.md.
 *
 * Auth: Basic email:apiToken (Atlassian Cloud) or Basic user:password (Server).
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

export interface ConfluenceConfig {
  /** e.g. "https://mycompany.atlassian.net" */
  baseUrl: string;
  /** Atlassian account email (Cloud) or username (Server) */
  email: string;
  /** API token (Cloud) or password (Server) */
  apiToken: string;
  /** One or more space keys to import, e.g. ["ITSM", "HR"] */
  spaceKeys?: string[];
  /** Output root directory (defaults to "knowledge") */
  outputDir?: string;
  /** Max pages to import per space, defaults to 1000 */
  maxPages?: number;
}

// ---------------------------------------------------------------------------
// Confluence REST API shapes (minimal)
// ---------------------------------------------------------------------------

interface ConfluencePage {
  id: string;
  title: string;
  body?: {
    view?: {
      value: string;
    };
  };
}

interface ConfluencePageList {
  results: ConfluencePage[];
  _links?: { next?: string };
  size: number;
  limit: number;
  start: number;
}

interface ConfluenceSpaceList {
  results: Array<{ key: string; name: string }>;
  _links?: { next?: string };
}

// ---------------------------------------------------------------------------
// ConfluenceImporter
// ---------------------------------------------------------------------------

export class ConfluenceImporter {
  private readonly cfg: ConfluenceConfig;
  private readonly authHeader: string;
  private readonly apiBase: string;

  constructor(config: ConfluenceConfig) {
    this.cfg = config;
    this.authHeader = "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
    this.apiBase = `${config.baseUrl.replace(/\/$/, "")}/wiki/rest/api`;
  }

  private async request<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Confluence API ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /** List all space keys available (for auto-discovery when none configured). */
  private async listSpaceKeys(): Promise<string[]> {
    const keys: string[] = [];
    let url: string | undefined = `${this.apiBase}/space?limit=50&type=global`;

    while (url) {
      const data = await this.request<ConfluenceSpaceList>(url);
      keys.push(...data.results.map((s) => s.key));
      url = data._links?.next ? `${this.cfg.baseUrl}${data._links.next}` : undefined;
    }

    return keys;
  }

  /**
   * Fetch all pages in a given space, paginated.
   */
  private async fetchPages(spaceKey: string): Promise<ConfluencePage[]> {
    const maxPages = this.cfg.maxPages ?? 1000;
    const pages: ConfluencePage[] = [];
    let start = 0;
    const limit = 50;

    while (pages.length < maxPages) {
      const url = `${this.apiBase}/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&expand=body.view&limit=${limit}&start=${start}`;
      const data = await this.request<ConfluencePageList>(url);

      pages.push(...data.results);

      if (data.results.length < limit) break;
      start += limit;
    }

    return pages.slice(0, maxPages);
  }

  /** Import one or more spaces. If no spaceKeys configured, imports all spaces. */
  async import(): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = { imported: 0, skipped: 0, errors: [], docs: [], durationMs: 0 };

    let spaceKeys = this.cfg.spaceKeys ?? [];
    if (!spaceKeys.length) {
      spaceKeys = await this.listSpaceKeys();
    }

    for (const spaceKey of spaceKeys) {
      const outputDir = path.join(this.cfg.outputDir ?? "knowledge", "confluence", spaceKey.toLowerCase());

      let pages: ConfluencePage[];
      try {
        pages = await this.fetchPages(spaceKey);
      } catch (err) {
        result.errors.push({
          source: `space:${spaceKey}`,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const page of pages) {
        const sourceId = `confluence:${spaceKey}:${page.id}`;
        try {
          const html = page.body?.view?.value ?? "";
          const markdown = htmlToMarkdown(html);

          if (!markdown.trim()) continue;

          const header = `# ${page.title}\n_Source: Confluence ${spaceKey} · Page ${page.id}_\n\n`;
          const content = header + markdown;

          const slug = slugify(page.title).slice(0, 80);
          const filename = `${slug || page.id}.md`;
          const filePath = path.join(outputDir, filename);
          const written = await writeIfChanged(filePath, content);

          const doc: ImportedDoc = {
            filename: path.join("confluence", spaceKey.toLowerCase(), filename),
            source: sourceId,
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
            source: sourceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}
