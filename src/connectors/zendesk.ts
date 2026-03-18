/**
 * Zendesk Support REST API v2 connector.
 *
 * Auth: Basic email/token (base64 of "email/token:apiToken").
 * Zendesk tickets map cleanly to our Ticket interface.
 * Internal notes: Zendesk comments have a `public` flag (false = internal).
 */

import type {
  Ticket,
  TicketComment,
  TicketAttachment,
  TicketStatus,
  TicketPriority,
  TicketType,
  TicketUser,
  UpdateTicketFields,
} from "./types";
import type {
  TicketConnector,
  ListTicketsOptions,
  ListTicketsResult,
  AddCommentOptions,
  HealthCheckResult,
} from "./connector";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ZendeskConfig {
  /** e.g. https://mycompany.zendesk.com */
  subdomain: string;
  /** Email of the API token owner */
  email: string;
  /** Zendesk API token (Admin > Channels > API) */
  apiToken: string;
}

// ---------------------------------------------------------------------------
// Raw Zendesk API shapes
// ---------------------------------------------------------------------------

interface ZDUser {
  id: number;
  name: string;
  email: string;
}

interface ZDTicket {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string | null;
  type: string | null;
  requester_id: number;
  assignee_id: number | null;
  tags: string[];
  group_id: number | null;
  created_at: string;
  updated_at: string;
  url: string;
}

interface ZDComment {
  id: number;
  author_id: number;
  body: string;
  public: boolean;
  created_at: string;
  attachments: ZDAttachment[];
}

interface ZDAttachment {
  id: number;
  file_name: string;
  content_url: string;
  size: number;
  content_type: string;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, TicketStatus> = {
  new: "open",
  open: "open",
  pending: "pending",
  hold: "pending",
  solved: "resolved",
  closed: "closed",
};

const STATUS_TO_ZD: Record<TicketStatus, string> = {
  open: "open",
  in_progress: "open",
  pending: "pending",
  resolved: "solved",
  closed: "closed",
};

const PRIORITY_MAP: Record<string, TicketPriority> = {
  urgent: "critical",
  high: "high",
  normal: "medium",
  low: "low",
};

const PRIORITY_TO_ZD: Record<TicketPriority, string> = {
  critical: "urgent",
  high: "high",
  medium: "normal",
  low: "low",
};

const TYPE_MAP: Record<string, TicketType> = {
  problem: "problem",
  incident: "incident",
  question: "request",
  task: "task",
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function mapStatus(status: string): TicketStatus {
  return STATUS_MAP[status] ?? "open";
}

export function mapPriority(priority: string | null): TicketPriority {
  return priority ? (PRIORITY_MAP[priority] ?? "medium") : "medium";
}

export function mapType(type: string | null): TicketType {
  return type ? (TYPE_MAP[type] ?? "task") : "task";
}

function toUser(id: number, name?: string, email?: string): TicketUser {
  return { id: String(id), name: name ?? String(id), email };
}

function toTicket(zd: ZDTicket, baseUrl: string): Ticket {
  return {
    id: String(zd.id),
    externalId: String(zd.id),
    source: "zendesk",
    url: `${baseUrl}/agent/tickets/${zd.id}`,
    title: zd.subject ?? "(no subject)",
    description: zd.description ?? "",
    type: mapType(zd.type),
    status: mapStatus(zd.status),
    priority: mapPriority(zd.priority),
    reporter: toUser(zd.requester_id),
    assignee: zd.assignee_id ? toUser(zd.assignee_id) : undefined,
    tags: zd.tags,
    createdAt: new Date(zd.created_at),
    updatedAt: new Date(zd.updated_at),
  };
}

function toComment(comment: ZDComment): TicketComment {
  return {
    id: String(comment.id),
    author: toUser(comment.author_id),
    body: comment.body,
    isInternal: !comment.public,
    createdAt: new Date(comment.created_at),
  };
}

function toAttachment(att: ZDAttachment): TicketAttachment {
  return {
    id: String(att.id),
    filename: att.file_name,
    url: att.content_url,
    size: att.size,
    mimeType: att.content_type,
  };
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

export const _testExports = {
  STATUS_MAP,
  PRIORITY_MAP,
  TYPE_MAP,
  mapStatus,
  mapPriority,
  mapType,
  toUser,
  toTicket,
  toComment,
  toAttachment,
};

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export class ZendeskConnector implements TicketConnector {
  readonly name = "Zendesk";
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: ZendeskConfig) {
    this.baseUrl = `https://${config.subdomain}.zendesk.com`;
    this.authHeader =
      "Basic " + Buffer.from(`${config.email}/token:${config.apiToken}`).toString("base64");
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}/api/v2${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zendesk ${res.status} ${res.statusText}: ${body}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const data = await this.request<{ user: ZDUser }>("/users/me.json");
      return {
        ok: true,
        connector: this.name,
        latencyMs: Date.now() - start,
        details: `Authenticated as ${data.user.name}`,
      };
    } catch (err) {
      return {
        ok: false,
        connector: this.name,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 25;

    // Build search query
    const queryParts: string[] = ["type:ticket"];

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const zdStatuses = statuses.map((s) => STATUS_TO_ZD[s]).filter(Boolean);
      if (zdStatuses.length) {
        queryParts.push(`status:${zdStatuses.join(",")}`);
      }
    }

    if (options.assigneeId) queryParts.push(`assignee:${options.assigneeId}`);
    if (options.projectKey) queryParts.push(`tags:${options.projectKey}`);

    if (options.updatedSince) {
      queryParts.push(`updated>${options.updatedSince.toISOString().split("T")[0]}`);
    }

    const query = queryParts.join(" ");
    const params = new URLSearchParams({
      query,
      page: String(page),
      per_page: String(pageSize),
      sort_by: "updated_at",
      sort_order: "desc",
    });

    const data = await this.request<{
      results: ZDTicket[];
      count: number;
      next_page: string | null;
    }>(`/search.json?${params}`);

    const tickets = data.results.map((t) => toTicket(t, this.baseUrl));

    return {
      tickets,
      total: data.count,
      page,
      pageSize,
      hasMore: data.next_page !== null,
    };
  }

  async getTicket(id: string): Promise<Ticket> {
    const data = await this.request<{ ticket: ZDTicket }>(`/tickets/${id}.json`);
    return toTicket(data.ticket, this.baseUrl);
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const data = await this.request<{ comments: ZDComment[] }>(
      `/tickets/${ticketId}/comments.json`
    );
    return data.comments.map(toComment);
  }

  async addComment(
    ticketId: string,
    body: string,
    options: AddCommentOptions = {}
  ): Promise<TicketComment> {
    const comment = {
      body,
      public: !(options.isInternal ?? false),
    };

    await this.request(`/tickets/${ticketId}.json`, {
      method: "PUT",
      body: JSON.stringify({ ticket: { comment } }),
    });

    // Zendesk doesn't return the comment directly from ticket update
    // Fetch the latest comment
    const comments = await this.getComments(ticketId);
    return comments[comments.length - 1];
  }

  async listAttachments(ticketId: string): Promise<TicketAttachment[]> {
    const comments = await this.request<{ comments: ZDComment[] }>(
      `/tickets/${ticketId}/comments.json`
    );
    const attachments: TicketAttachment[] = [];
    for (const comment of comments.comments) {
      for (const att of comment.attachments ?? []) {
        attachments.push(toAttachment(att));
      }
    }
    return attachments;
  }

  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    const data = await this.request<{ attachment: ZDAttachment }>(
      `/attachments/${attachmentId}.json`
    );
    const res = await fetch(data.attachment.content_url, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`Zendesk attachment download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadAttachment(
    ticketId: string,
    filename: string,
    data: Buffer,
    mimeType = "application/octet-stream"
  ): Promise<TicketAttachment> {
    // Step 1: Upload to Zendesk
    const params = new URLSearchParams({ filename });
    const uploadRes = await this.request<{
      upload: { token: string; attachment: ZDAttachment };
    }>(`/uploads.json?${params}`, {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
      },
      body: data,
    });

    // Step 2: Attach to ticket via comment
    await this.request(`/tickets/${ticketId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        ticket: {
          comment: {
            body: `Attached file: ${filename}`,
            uploads: [uploadRes.upload.token],
          },
        },
      }),
    });

    return toAttachment(uploadRes.upload.attachment);
  }

  async updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket> {
    const ticket: Record<string, unknown> = {};

    if (fields.status !== undefined) {
      ticket.status = STATUS_TO_ZD[fields.status] ?? "open";
    }

    if (fields.assigneeId !== undefined) {
      ticket.assignee_id = fields.assigneeId ? Number(fields.assigneeId) : null;
    }

    if (fields.assigneeGroupId !== undefined) {
      ticket.group_id = fields.assigneeGroupId ? Number(fields.assigneeGroupId) : null;
    }

    if (fields.priority !== undefined) {
      ticket.priority = PRIORITY_TO_ZD[fields.priority] ?? "normal";
    }

    if (Object.keys(ticket).length > 0) {
      await this.request(`/tickets/${ticketId}.json`, {
        method: "PUT",
        body: JSON.stringify({ ticket }),
      });
    }

    return this.getTicket(ticketId);
  }
}
