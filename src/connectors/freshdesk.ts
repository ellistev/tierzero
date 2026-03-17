/**
 * Freshdesk REST API v2 connector.
 *
 * Auth: API key (used as username with Basic auth, password is "X").
 * Maps Freshdesk tickets to the unified Ticket interface.
 * Conversations (notes/replies) map to comments; note.private → isInternal.
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
} from "./connector";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface FreshdeskConfig {
  /** Freshdesk domain, e.g. "mycompany.freshdesk.com" or full URL */
  domain: string;
  /** API key (found under Profile Settings in Freshdesk) */
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Raw Freshdesk API shapes
// ---------------------------------------------------------------------------

interface FDContact {
  id: number;
  name: string;
  email: string | null;
}

interface FDAttachment {
  id: number;
  name: string;
  size: number;
  content_type: string;
  attachment_url: string;
}

interface FDTicket {
  id: number;
  subject: string;
  description_text: string;
  description: string;
  status: number;
  priority: number;
  type: string | null;
  requester_id: number;
  responder_id: number | null;
  group_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  due_by: string | null;
  attachments: FDAttachment[];
  custom_fields: Record<string, unknown>;
  requester?: FDContact;
}

interface FDConversation {
  id: number;
  body_text: string;
  body: string;
  user_id: number;
  private: boolean;
  incoming: boolean;
  created_at: string;
  updated_at: string;
  attachments: FDAttachment[];
}

// ---------------------------------------------------------------------------
// Status mapping -- Freshdesk default statuses
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<number, TicketStatus> = {
  2: "open",        // Open
  3: "pending",     // Pending
  4: "resolved",    // Resolved
  5: "closed",      // Closed
};

const REVERSE_STATUS_MAP: Record<TicketStatus, number> = {
  open: 2,
  in_progress: 2,   // Freshdesk has no native in_progress; keep as open
  pending: 3,
  resolved: 4,
  closed: 5,
};

// ---------------------------------------------------------------------------
// Priority mapping -- Freshdesk priority integers
// ---------------------------------------------------------------------------

const PRIORITY_MAP: Record<number, TicketPriority> = {
  1: "low",
  2: "medium",
  3: "high",
  4: "critical",    // "Urgent" in Freshdesk
};

const REVERSE_PRIORITY_MAP: Record<TicketPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, TicketType> = {
  "Incident": "incident",
  "Service Request": "request",
  "Bug": "bug",
  "Task": "task",
  "Change": "change",
  "Problem": "problem",
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapStatus(status: number): TicketStatus {
  return STATUS_MAP[status] ?? "open";
}

function mapPriority(priority: number): TicketPriority {
  return PRIORITY_MAP[priority] ?? "medium";
}

function mapType(type: string | null): TicketType {
  if (!type) return "incident";
  return TYPE_MAP[type] ?? "incident";
}

function toUser(contact: FDContact): TicketUser {
  return {
    id: String(contact.id),
    name: contact.name,
    email: contact.email ?? undefined,
  };
}

function toUserFromId(id: number): TicketUser {
  return { id: String(id), name: `user-${id}` };
}

function toAttachment(att: FDAttachment): TicketAttachment {
  return {
    id: String(att.id),
    filename: att.name,
    url: att.attachment_url,
    size: att.size,
    mimeType: att.content_type,
  };
}

function toTicket(fd: FDTicket, baseUrl: string): Ticket {
  return {
    id: String(fd.id),
    externalId: String(fd.id),
    source: "freshdesk",
    url: `${baseUrl}/a/tickets/${fd.id}`,

    title: fd.subject,
    description: fd.description_text || fd.description || "",
    type: mapType(fd.type),

    status: mapStatus(fd.status),
    priority: mapPriority(fd.priority),

    reporter: fd.requester
      ? toUser(fd.requester)
      : toUserFromId(fd.requester_id),
    assignee: fd.responder_id
      ? toUserFromId(fd.responder_id)
      : undefined,

    tags: fd.tags,
    queue: fd.group_id ? String(fd.group_id) : undefined,

    attachments: fd.attachments?.map(toAttachment) ?? [],
    customFields: fd.custom_fields ?? {},

    createdAt: new Date(fd.created_at),
    updatedAt: new Date(fd.updated_at),
    dueAt: fd.due_by ? new Date(fd.due_by) : undefined,
  };
}

function toComment(conv: FDConversation): TicketComment {
  return {
    id: String(conv.id),
    author: toUserFromId(conv.user_id),
    body: conv.body_text || conv.body,
    isInternal: conv.private,
    createdAt: new Date(conv.created_at),
  };
}

// ---------------------------------------------------------------------------
// Build update payload
// ---------------------------------------------------------------------------

function buildUpdateBody(fields: UpdateTicketFields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.status !== undefined) body.status = REVERSE_STATUS_MAP[fields.status];
  if (fields.priority !== undefined) body.priority = REVERSE_PRIORITY_MAP[fields.priority];
  if (fields.assigneeId !== undefined) body.responder_id = Number(fields.assigneeId);
  if (fields.assigneeGroupId !== undefined) body.group_id = Number(fields.assigneeGroupId);
  return body;
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

export const _testExports = {
  STATUS_MAP,
  REVERSE_STATUS_MAP,
  PRIORITY_MAP,
  REVERSE_PRIORITY_MAP,
  TYPE_MAP,
  mapStatus,
  mapPriority,
  mapType,
  toUser,
  toUserFromId,
  toAttachment,
  toTicket,
  toComment,
  buildUpdateBody,
};

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export class FreshdeskConnector implements TicketConnector {
  readonly name = "Freshdesk";
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: FreshdeskConfig) {
    // Accept "myco.freshdesk.com" or "https://myco.freshdesk.com"
    const domain = config.domain.replace(/\/$/, "");
    this.baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
    // Freshdesk Basic auth: apiKey as username, "X" as password
    this.authHeader = `Basic ${Buffer.from(`${config.apiKey}:X`).toString("base64")}`;
  }

  // ---- HTTP helper -------------------------------------------------------

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Freshdesk ${res.status} ${res.statusText}: ${body}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ---- TicketConnector interface ------------------------------------------

  async listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
    const page = options.page ?? 1;
    const pageSize = Math.min(options.pageSize ?? 30, 100); // Freshdesk max is 100

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(pageSize),
      include: "requester",
      order_by: "updated_at",
      order_type: "desc",
    });

    // Freshdesk filter API supports a single status filter at a time via
    // the /api/v2/tickets?filter endpoint or a predefined filter.
    // For the list endpoint, use updated_since + manual status filtering.
    if (options.updatedSince) {
      params.set("updated_since", options.updatedSince.toISOString());
    }

    const tickets = await this.request<FDTicket[]>(
      `/api/v2/tickets?${params}`
    );

    // Client-side status filtering (Freshdesk list API doesn't filter by status natively)
    let filtered = tickets;
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      filtered = tickets.filter((t) => statuses.includes(mapStatus(t.status)));
    }

    return {
      tickets: filtered.map((t) => toTicket(t, this.baseUrl)),
      total: filtered.length,
      page,
      pageSize,
      hasMore: tickets.length === pageSize,
    };
  }

  async getTicket(id: string): Promise<Ticket> {
    const ticket = await this.request<FDTicket>(
      `/api/v2/tickets/${id}?include=requester`
    );
    return toTicket(ticket, this.baseUrl);
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const conversations = await this.request<FDConversation[]>(
      `/api/v2/tickets/${ticketId}/conversations`
    );
    return conversations.map(toComment);
  }

  async addComment(
    ticketId: string,
    body: string,
    options: AddCommentOptions = {}
  ): Promise<TicketComment> {
    // Private note vs public reply
    if (options.isInternal) {
      const note = await this.request<FDConversation>(
        `/api/v2/tickets/${ticketId}/notes`,
        {
          method: "POST",
          body: JSON.stringify({ body, private: true }),
        }
      );
      return toComment(note);
    }

    const reply = await this.request<FDConversation>(
      `/api/v2/tickets/${ticketId}/reply`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      }
    );
    return toComment(reply);
  }

  async listAttachments(ticketId: string): Promise<TicketAttachment[]> {
    const ticket = await this.request<FDTicket>(
      `/api/v2/tickets/${ticketId}`
    );
    return (ticket.attachments ?? []).map(toAttachment);
  }

  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    // Freshdesk attachment URLs are direct download links; fetch raw bytes
    const url = `/api/v2/attachments/${attachmentId}`;
    const fullUrl = `${this.baseUrl}${url}`;
    const res = await fetch(fullUrl, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) {
      throw new Error(`Freshdesk attachment download ${res.status}: ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadAttachment(
    ticketId: string,
    filename: string,
    data: Buffer,
    mimeType?: string
  ): Promise<TicketAttachment> {
    // Freshdesk supports attachments via multipart form on ticket update
    const blob = new Blob([data], { type: mimeType ?? "application/octet-stream" });
    const form = new FormData();
    form.append("attachments[]", blob, filename);

    const res = await fetch(`${this.baseUrl}/api/v2/tickets/${ticketId}`, {
      method: "PUT",
      headers: { Authorization: this.authHeader },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Freshdesk attachment upload ${res.status}: ${body}`);
    }

    const updated = (await res.json()) as FDTicket;
    // Return the last attachment (the one we just added)
    const attachments = updated.attachments ?? [];
    const last = attachments[attachments.length - 1];
    if (!last) throw new Error("Freshdesk upload succeeded but no attachment returned");
    return toAttachment(last);
  }

  async updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket> {
    const body = buildUpdateBody(fields);

    if (Object.keys(body).length > 0) {
      await this.request(`/api/v2/tickets/${ticketId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }

    return this.getTicket(ticketId);
  }
}
