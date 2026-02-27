/**
 * Azure DevOps knowledge-base importers.
 *
 * Two importers:
 *   - AzureDevOpsWikiImporter  — fetches wiki pages (already Markdown) and writes
 *     them to knowledge/wiki/<slug>.md
 *   - AzureDevOpsWorkItemMiner — mines resolved/closed work items and writes
 *     "Problem → Resolution" articles to knowledge/work-items/<id>-<slug>.md
 *
 * Auth: PAT token, sent as Basic base64(":<token>") with an empty username.
 */

import path from "path";
import {
  IngestResult,
  ImportedDoc,
  writeIfChanged,
  slugify,
  countWords,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AzureDevOpsConfig {
  organization: string;
  project: string;
  /** Personal Access Token */
  token: string;
  /** REST API version, defaults to "7.1" */
  apiVersion?: string;
  /** Specific wiki ID to import; if omitted the first wiki is used */
  wikiId?: string;
  /** Output directory root (defaults to "knowledge") */
  outputDir?: string;
}

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert an Azure DevOps wiki page path to a safe filename stem.
 * "/Runbooks/Password Reset" → "runbooks-password-reset.md"
 */
export function pagePathToFilename(pagePath: string): string {
  const parts = pagePath
    .replace(/^\//, "")   // strip leading slash
    .split("/")
    .map(slugify)
    .filter(Boolean);
  return (parts.join("-") || "index") + ".md";
}

/** Raw work-item fields returned by the Azure DevOps API */
export interface WorkItemFields {
  id: number;
  title: string;
  description?: string;
  resolvedReason?: string;
  workItemType?: string;
  createdDate?: string;
  resolvedDate?: string;
  closedDate?: string;
}

/**
 * Format a resolved work item as a "Problem → Resolution" markdown article.
 */
export function formatWorkItem(item: WorkItemFields): string {
  const type = item.workItemType ?? "Work Item";
  const resolvedAt = item.resolvedDate ?? item.closedDate ?? item.createdDate ?? "";
  const dateStr = resolvedAt ? new Date(resolvedAt).toISOString().split("T")[0] : "unknown";

  const description = (item.description ?? "").trim() || "_No description provided._";
  const resolution = (item.resolvedReason ?? "").trim() || "_No resolution details recorded._";

  return [
    `# ${item.title}`,
    `**Type:** ${type} | **Resolved:** ${dateStr}`,
    "",
    "## Problem",
    description,
    "",
    "## Resolution",
    resolution,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Internal request helper type
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  body?: unknown;
}

// ---------------------------------------------------------------------------
// AzureDevOpsWikiImporter
// ---------------------------------------------------------------------------

export class AzureDevOpsWikiImporter {
  private readonly cfg: Required<Pick<AzureDevOpsConfig, "organization" | "project" | "token" | "apiVersion">> &
    Pick<AzureDevOpsConfig, "wikiId" | "outputDir">;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: AzureDevOpsConfig) {
    this.cfg = {
      apiVersion: "7.1",
      ...config,
    };
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/_apis`;
    this.authHeader = "Basic " + Buffer.from(`:${config.token}`).toString("base64");
  }

  private async request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}api-version=${this.cfg.apiVersion}`;

    const res = await fetch(fullUrl, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`AzDO API ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /** Resolve the wiki ID to use (from config or first available wiki). */
  private async resolveWikiId(): Promise<string> {
    if (this.cfg.wikiId) return this.cfg.wikiId;

    const data = await this.request<{ value: Array<{ id: string }> }>(
      `${this.baseUrl}/wiki/wikis`
    );
    if (!data.value.length) throw new Error("No wikis found in this project");
    return data.value[0].id;
  }

  /**
   * Fetch all wiki pages and write them to `outputDir/wiki/`.
   */
  async import(): Promise<IngestResult> {
    const start = Date.now();
    const outputDir = path.join(this.cfg.outputDir ?? "knowledge", "wiki");
    const result: IngestResult = { imported: 0, skipped: 0, errors: [], docs: [], durationMs: 0 };

    const wikiId = await this.resolveWikiId();

    // Get full page tree
    const tree = await this.request<{ value: Array<{ path: string }> }>(
      `${this.baseUrl}/wiki/wikis/${encodeURIComponent(wikiId)}/pages?path=/&recursionLevel=Full&includeContent=false`
    );

    for (const page of tree.value) {
      try {
        const detail = await this.request<{ content: string }>(
          `${this.baseUrl}/wiki/wikis/${encodeURIComponent(wikiId)}/pages?path=${encodeURIComponent(page.path)}&includeContent=true`
        );

        const content = detail.content ?? "";
        if (!content.trim()) continue;

        const filename = pagePathToFilename(page.path);
        const filePath = path.join(outputDir, filename);
        const written = await writeIfChanged(filePath, content);

        const doc: ImportedDoc = {
          filename: path.join("wiki", filename),
          source: `azdo-wiki:${page.path}`,
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
          source: page.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}

// ---------------------------------------------------------------------------
// AzureDevOpsWorkItemMiner
// ---------------------------------------------------------------------------

interface WiqlQueryResult {
  workItems: Array<{ id: number }>;
}

interface WorkItemBatchResponse {
  value: Array<{
    id: number;
    fields: Record<string, string | undefined>;
  }>;
}

export class AzureDevOpsWorkItemMiner {
  private readonly cfg: Required<Pick<AzureDevOpsConfig, "organization" | "project" | "token" | "apiVersion">> &
    Pick<AzureDevOpsConfig, "outputDir">;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  /** Max work items to mine per run */
  limit: number;

  constructor(config: AzureDevOpsConfig & { limit?: number }) {
    this.cfg = {
      apiVersion: "7.1",
      ...config,
    };
    this.limit = config.limit ?? 100;
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/_apis`;
    this.authHeader = "Basic " + Buffer.from(`:${config.token}`).toString("base64");
  }

  private async request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}api-version=${this.cfg.apiVersion}`;

    const res = await fetch(fullUrl, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`AzDO API ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async mine(): Promise<IngestResult> {
    const start = Date.now();
    const outputDir = path.join(this.cfg.outputDir ?? "knowledge", "work-items");
    const result: IngestResult = { imported: 0, skipped: 0, errors: [], docs: [], durationMs: 0 };

    // 1. Run WIQL query to find resolved/closed items
    const wiqlResult = await this.request<WiqlQueryResult>(
      `${this.baseUrl}/wit/wiql`,
      {
        method: "POST",
        body: {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.State] IN ('Resolved','Closed','Done') ORDER BY [System.ChangedDate] DESC`,
        },
      }
    );

    const ids = wiqlResult.workItems.map((w) => w.id).slice(0, this.limit);
    if (!ids.length) {
      result.durationMs = Date.now() - start;
      return result;
    }

    // 2. Batch-fetch fields in chunks of 200 (API limit)
    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      let batch: WorkItemBatchResponse;
      try {
        batch = await this.request<WorkItemBatchResponse>(
          `${this.baseUrl}/wit/workitemsbatch`,
          {
            method: "POST",
            body: {
              ids: chunk,
              fields: [
                "System.Id",
                "System.Title",
                "System.Description",
                "System.WorkItemType",
                "System.CreatedDate",
                "Microsoft.VSTS.Common.ResolvedDate",
                "Microsoft.VSTS.Common.ResolvedReason",
                "Microsoft.VSTS.Common.ClosedDate",
              ],
            },
          }
        );
      } catch (err) {
        result.errors.push({
          source: `batch-${i}`,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const wi of batch.value) {
        const f = wi.fields;
        const item: WorkItemFields = {
          id: wi.id,
          title: f["System.Title"] ?? `Work Item ${wi.id}`,
          description: f["System.Description"],
          resolvedReason: f["Microsoft.VSTS.Common.ResolvedReason"],
          workItemType: f["System.WorkItemType"],
          createdDate: f["System.CreatedDate"],
          resolvedDate: f["Microsoft.VSTS.Common.ResolvedDate"],
          closedDate: f["Microsoft.VSTS.Common.ClosedDate"],
        };

        try {
          const content = formatWorkItem(item);
          const slug = slugify(item.title).slice(0, 60);
          const filename = `${item.id}-${slug}.md`;
          const filePath = path.join(outputDir, filename);
          const written = await writeIfChanged(filePath, content);

          const doc: ImportedDoc = {
            filename: path.join("work-items", filename),
            source: `azdo-workitem:${item.id}`,
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
            source: `workitem-${wi.id}`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}
