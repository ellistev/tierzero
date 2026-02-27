/**
 * TicketMiner — mines resolved/closed tickets from any TicketConnector and
 * converts them into "Problem → Resolution Thread" markdown articles stored
 * in knowledge/mined/<source>-<externalId>.md.
 *
 * Works with ServiceNow, Jira, GitLab, or any future connector.
 */

import path from "path";
import type { TicketConnector } from "../connectors/connector.js";
import type { Ticket, TicketComment } from "../connectors/types.js";
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

export interface TicketMinerOptions {
  /** Output root directory (defaults to "knowledge") */
  outputDir?: string;
  /** Max tickets to mine, default 100 */
  limit?: number;
  /** Only consider tickets updated after this date */
  since?: Date;
  /** Quality gate: skip tickets with fewer comments than this (default 1) */
  minComments?: number;
}

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Format a resolved ticket + its comments as a markdown article.
 */
export function formatTicketArticle(ticket: Ticket, comments: TicketComment[]): string {
  const id = ticket.externalId ?? ticket.id;
  const source = ticket.source;
  const resolvedAt = ticket.resolvedAt ?? ticket.updatedAt;
  const dateStr = resolvedAt.toISOString().split("T")[0];
  const priority = ticket.priority;

  const lines: string[] = [
    `# ${ticket.title}`,
    `**Source:** ${id} | **Resolved:** ${dateStr} | **Priority:** ${priority}`,
    "",
    "## Problem",
    ticket.description.trim() || "_No description provided._",
    "",
    "## Resolution Thread",
  ];

  for (const comment of comments) {
    const authorName = comment.author.name || "Unknown";
    const visibility = comment.isInternal ? "internal" : "public";
    lines.push(`### ${authorName} (${visibility})`);
    lines.push(comment.body.trim());
    lines.push("---");
  }

  if (!comments.length) {
    lines.push("_No comments recorded._");
  }

  return lines.join("\n");
}

/**
 * Generate the output filename for a mined ticket.
 * e.g. source="servicenow", externalId="INC0012345", title="VPN not working"
 * → "servicenow-INC0012345-vpn-not-working.md"
 */
export function mineFilename(source: string, externalId: string, title: string): string {
  const slug = slugify(title).slice(0, 50);
  const safeId = externalId.replace(/[^\w-]/g, "");
  return `${slugify(source)}-${safeId}-${slug}.md`;
}

// ---------------------------------------------------------------------------
// TicketMiner
// ---------------------------------------------------------------------------

export class TicketMiner {
  private readonly connector: TicketConnector;
  private readonly opts: Required<TicketMinerOptions>;

  constructor(connector: TicketConnector, options: TicketMinerOptions = {}) {
    this.connector = connector;
    this.opts = {
      outputDir: "knowledge",
      limit: 100,
      minComments: 1,
      since: new Date(0),
      ...options,
    };
  }

  async mine(): Promise<IngestResult> {
    const start = Date.now();
    const outputDir = path.join(this.opts.outputDir, "mined");
    const result: IngestResult = { imported: 0, skipped: 0, errors: [], docs: [], durationMs: 0 };

    // Paginate through resolved/closed tickets
    const tickets: Ticket[] = [];
    let page = 1;
    const pageSize = 50;

    outer: while (tickets.length < this.opts.limit) {
      let listResult;
      try {
        listResult = await this.connector.listTickets({
          status: ["resolved", "closed"],
          page,
          pageSize,
          updatedSince: this.opts.since,
        });
      } catch (err) {
        result.errors.push({
          source: `listTickets(page=${page})`,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      for (const t of listResult.tickets) {
        tickets.push(t);
        if (tickets.length >= this.opts.limit) break outer;
      }

      if (!listResult.hasMore) break;
      page++;
    }

    // Process each ticket
    for (const ticket of tickets) {
      const id = ticket.externalId ?? ticket.id;
      const sourceKey = `${ticket.source}:${id}`;

      try {
        // Fetch comments
        let comments: TicketComment[] = [];
        try {
          comments = await this.connector.getComments(ticket.id);
        } catch {
          // Non-fatal — proceed with empty comments
        }

        // Quality gate
        if (comments.length < this.opts.minComments) {
          result.skipped++;
          continue;
        }

        const content = formatTicketArticle(ticket, comments);
        const filename = mineFilename(ticket.source, id, ticket.title);
        const filePath = path.join(outputDir, filename);

        const written = await writeIfChanged(filePath, content);
        const doc: ImportedDoc = {
          filename: path.join("mined", filename),
          source: sourceKey,
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
          source: sourceKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}
