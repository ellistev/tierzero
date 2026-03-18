/**
 * Jira Cloud REST API v3 connector.
 *
 * Auth:  Basic  email:apiToken  (base64). Jira Cloud no longer accepts passwords.
 * Comments: uses Atlassian Document Format (ADF) for both reading and writing.
 * Internal notes: standard Jira has no work_notes equivalent; all comments are
 *   public. Jira Service Management's /rest/servicedeskapi/request/{key}/comment
 *   supports internal notes -- that path is used when isInternal=true.
 * Status changes: Jira uses transitions, not direct field writes. The connector
 *   fetches available transitions and picks one by name from a configurable list.
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

export interface JiraConfig {
  /** e.g. https://mycompany.atlassian.net */
  baseUrl: string;
  /** Email address of the API token owner */
  email: string;
  /** Jira API token (Settings → Security → API tokens) */
  apiToken: string;
  /** Default project key to scope searches. If omitted, searches all accessible projects. */
  projectKey?: string;
  /**
   * Override the transition names searched for each status.
   * Values are checked case-insensitively as substrings of the transition name.
   * If a status is not listed here, DEFAULT_TRANSITION_NAMES is used.
   */
  transitionNames?: Partial<Record<TicketStatus, string[]>>;
}

// ---------------------------------------------------------------------------
// Default transition name hints (case-insensitive substring match)
// ---------------------------------------------------------------------------

export const DEFAULT_TRANSITION_NAMES: Record<TicketStatus, string[]> = {
  open:        ["Reopen", "Reopen Issue", "Restore"],
  in_progress: ["Start Progress", "In Progress", "Start", "Begin"],
  pending:     ["Pending", "On Hold", "Waiting", "Hold"],
  resolved:    ["Resolve", "Resolve Issue", "Done", "Complete", "Fix"],
  closed:      ["Close", "Close Issue", "Done", "Won't Fix"],
};

// ---------------------------------------------------------------------------
// Raw Jira API shapes
// ---------------------------------------------------------------------------

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
}

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

interface JiraStatus {
  name: string;
  statusCategory: { key: string };
}

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description: AdfNode | null;
    status: JiraStatus;
    priority: { name: string } | null;
    issuetype: { name: string };
    reporter: JiraUser | null;
    assignee: JiraUser | null;
    created: string;
    updated: string;
    resolutiondate: string | null;
    duedate: string | null;
    labels?: string[];
    parent?: { id: string; key: string };
    [key: string]: unknown;
  };
}

interface JiraComment {
  id: string;
  author: JiraUser;
  body: AdfNode;
  created: string;
  visibility?: { type: string; value: string } | null;
}

interface JiraAttachment {
  id: string;
  filename: string;
  content: string;   // download URL
  size: number;
  mimeType: string;
}

interface JiraTransition {
  id: string;
  name: string;
}

interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Field mapping tables
// ---------------------------------------------------------------------------

const PRIORITY_MAP: Record<string, TicketPriority> = {
  blocker:  "critical",
  critical: "critical",
  highest:  "critical",
  major:    "high",
  high:     "high",
  medium:   "medium",
  minor:    "low",
  low:      "low",
  lowest:   "low",
  trivial:  "low",
};

const PRIORITY_TO_NAME: Record<TicketPriority, string> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  low:      "Low",
};

const TYPE_MAP: Record<string, TicketType> = {
  bug:                    "bug",
  story:                  "task",
  task:                   "task",
  "sub-task":             "task",
  subtask:                "task",
  epic:                   "task",
  initiative:             "task",
  incident:               "incident",
  "service request":      "request",
  "service desk request": "request",
  "it help":              "request",
  change:                 "change",
  "change request":       "change",
  problem:                "problem",
};

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Map a Jira status object to our canonical TicketStatus.
 * Priority:
 *  1. status.name substring hints for "pending" semantics
 *  2. statusCategory.key for the big three (new / indeterminate / done)
 */
export function mapStatus(status: JiraStatus): TicketStatus {
  const name = status.name.toLowerCase();
  if (name.includes("pending") || name.includes("on hold") || name.includes("waiting")) {
    return "pending";
  }
  switch (status.statusCategory.key) {
    case "new":           return "open";
    case "indeterminate": return "in_progress";
    case "done":
      return name.includes("clos") ? "closed" : "resolved";
    default:              return "open";
  }
}

/** Flatten an ADF document tree into plain text. */
export function extractAdfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as AdfNode;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map(extractAdfText);
    // Paragraph-level nodes get a newline separator for readability
    const sep = (n.type === "paragraph" || n.type === "bulletList" || n.type === "orderedList") ? "\n" : "";
    return parts.join("") + sep;
  }
  return "";
}

/** Wrap plain text in the simplest valid ADF document. */
export function textToAdf(text: string): AdfNode {
  return {
    type: "doc",
    version: 1 as unknown as undefined, // ADF spec requires version: 1 at the root
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  } as AdfNode;
}

function toUser(u: JiraUser): TicketUser {
  return { id: u.accountId, name: u.displayName, email: u.emailAddress };
}

/**
 * Build the `fields` object for a Jira issue PUT (non-status fields).
 * Status is handled separately via transitions.
 * Pure function, exported for unit testing.
 */
export function buildFieldUpdate(fields: Omit<UpdateTicketFields, "status">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.assigneeId !== undefined) {
    out.assignee = fields.assigneeId ? { accountId: fields.assigneeId } : null;
  }
  if (fields.assigneeGroupId !== undefined) {
    // Jira doesn't have a standard "group" field on issues; skip silently
  }
  if (fields.priority !== undefined) {
    out.priority = { name: PRIORITY_TO_NAME[fields.priority] };
  }
  return out;
}

function toTicket(issue: JiraIssue, baseUrl: string): Ticket {
  const f = issue.fields;
  return {
    id: issue.id,
    externalId: issue.key,
    source: "jira",
    url: `${baseUrl}/browse/${issue.key}`,
    title: f.summary,
    description: f.description ? extractAdfText(f.description).trim() : "",
    type: TYPE_MAP[f.issuetype.name.toLowerCase()] ?? "task",
    status: mapStatus(f.status),
    priority: PRIORITY_MAP[f.priority?.name.toLowerCase() ?? ""] ?? "medium",
    reporter: f.reporter ? toUser(f.reporter) : { id: "", name: "Unknown" },
    assignee: f.assignee ? toUser(f.assignee) : undefined,
    labels: f.labels,
    parentId: f.parent?.id,
    createdAt: new Date(f.created),
    updatedAt: new Date(f.updated),
    resolvedAt: f.resolutiondate ? new Date(f.resolutiondate) : undefined,
    dueAt: f.duedate ? new Date(f.duedate) : undefined,
  };
}

function toComment(comment: JiraComment): TicketComment {
  return {
    id: comment.id,
    author: toUser(comment.author),
    body: extractAdfText(comment.body).trim(),
    // Jira standard API has no work_notes; non-null visibility = restricted (treat as internal)
    isInternal: comment.visibility != null,
    createdAt: new Date(comment.created),
  };
}

function toAttachment(att: JiraAttachment): TicketAttachment {
  return {
    id: att.id,
    filename: att.filename,
    url: att.content,
    size: att.size,
    mimeType: att.mimeType,
  };
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

/* istanbul ignore next */
export const _testExports = {
  PRIORITY_MAP,
  PRIORITY_TO_NAME,
  TYPE_MAP,
  DEFAULT_TRANSITION_NAMES,
  mapStatus,
  extractAdfText,
  textToAdf,
  toUser,
  buildFieldUpdate,
};

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export class JiraConnector implements TicketConnector {
  readonly name = "Jira";
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly projectKey: string | undefined;
  private readonly transitionNames: Record<TicketStatus, string[]>;

  constructor(private readonly config: JiraConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.authHeader =
      "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
    this.projectKey = config.projectKey;

    // Merge caller overrides over defaults
    this.transitionNames = { ...DEFAULT_TRANSITION_NAMES };
    if (config.transitionNames) {
      for (const [k, v] of Object.entries(config.transitionNames) as [TicketStatus, string[]][]) {
        this.transitionNames[k] = v;
      }
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira ${res.status} ${res.statusText}: ${body}`);
    }

    // 204 No Content -- common for transitions, PUT updates, etc.
    if (res.status === 204) return undefined as unknown as T;

    return res.json() as Promise<T>;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const user = await this.request<JiraUser>("/rest/api/3/myself");
      return {
        ok: true,
        connector: this.name,
        latencyMs: Date.now() - start,
        details: `Authenticated as ${user.displayName}`,
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
    const pageSize = options.pageSize ?? 50;
    const startAt = (page - 1) * pageSize;

    const jqlParts: string[] = [];

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const jqlClauses = statuses.flatMap((s) => STATUS_JQL[s] ?? []);
      if (jqlClauses.length) jqlParts.push(`(${jqlClauses.join(" OR ")})`);
    }

    if (options.assigneeId) jqlParts.push(`assignee = "${options.assigneeId}"`);

    const projectKey = options.projectKey ?? this.projectKey;
    if (projectKey) jqlParts.push(`project = "${projectKey}"`);

    if (options.updatedSince) {
      // Jira JQL datetime: "yyyy/MM/dd HH:mm"
      const d = options.updatedSince;
      const fmt = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      jqlParts.push(`updated >= "${fmt}"`);
    }

    const jql = jqlParts.join(" AND ") || "order by created DESC";
    const fields = "summary,description,status,priority,issuetype,reporter,assignee,created,updated,resolutiondate,duedate,labels,parent";

    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(pageSize),
      fields,
    });

    const data = await this.request<JiraSearchResult>(`/rest/api/3/search?${params}`);
    const tickets = data.issues.map((i) => toTicket(i, this.baseUrl));

    return {
      tickets,
      total: data.total,
      page,
      pageSize,
      hasMore: startAt + tickets.length < data.total,
    };
  }

  async getTicket(id: string): Promise<Ticket> {
    const params = new URLSearchParams({
      fields: "summary,description,status,priority,issuetype,reporter,assignee,created,updated,resolutiondate,duedate,labels,parent",
    });
    const data = await this.request<JiraIssue>(`/rest/api/3/issue/${id}?${params}`);
    return toTicket(data, this.baseUrl);
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const data = await this.request<{ comments: JiraComment[] }>(
      `/rest/api/3/issue/${ticketId}/comment?orderBy=created&maxResults=100`
    );
    return data.comments.map(toComment);
  }

  async addComment(
    ticketId: string,
    body: string,
    options: AddCommentOptions = {}
  ): Promise<TicketComment> {
    if (options.isInternal) {
      // Jira Service Management internal note path
      try {
        const data = await this.request<JiraComment>(
          `/rest/servicedeskapi/request/${ticketId}/comment`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: textToAdf(body), public: false }),
          }
        );
        return toComment(data);
      } catch {
        // Fall through to standard API if JSM endpoint unavailable
      }
    }

    const data = await this.request<JiraComment>(
      `/rest/api/3/issue/${ticketId}/comment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: textToAdf(body) }),
      }
    );
    return toComment(data);
  }

  async listAttachments(ticketId: string): Promise<TicketAttachment[]> {
    const params = new URLSearchParams({ fields: "attachment" });
    const data = await this.request<{ fields: { attachment: JiraAttachment[] } }>(
      `/rest/api/3/issue/${ticketId}?${params}`
    );
    return (data.fields.attachment ?? []).map(toAttachment);
  }

  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    // The attachment download link is the full URL from the attachment metadata.
    // We pass our auth header so private instances work.
    const data = await this.request<{ content: string }>(
      `/rest/api/3/attachment/${attachmentId}`
    );
    const res = await fetch(data.content, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`Jira attachment download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadAttachment(
    ticketId: string,
    filename: string,
    data: Buffer,
    mimeType = "application/octet-stream"
  ): Promise<TicketAttachment> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), filename);

    const result = await this.request<JiraAttachment[]>(
      `/rest/api/3/issue/${ticketId}/attachments`,
      {
        method: "POST",
        headers: {
          "X-Atlassian-Token": "no-check", // required by Jira XSRF protection
        },
        body: form,
      }
    );
    return toAttachment(result[0]);
  }

  async updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket> {
    // Status changes require transitions in Jira
    if (fields.status !== undefined) {
      await this.applyTransition(ticketId, fields.status);
    }

    // All other field updates go through a single PUT
    const { status: _status, ...rest } = fields;
    const updateFields = buildFieldUpdate(rest);
    if (Object.keys(updateFields).length > 0) {
      await this.request(`/rest/api/3/issue/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: updateFields }),
      });
    }

    return this.getTicket(ticketId);
  }

  private async applyTransition(ticketId: string, targetStatus: TicketStatus): Promise<void> {
    const { transitions } = await this.request<{ transitions: JiraTransition[] }>(
      `/rest/api/3/issue/${ticketId}/transitions`
    );

    const names = this.transitionNames[targetStatus] ?? [];
    const match = transitions.find((t) =>
      names.some((n) => t.name.toLowerCase().includes(n.toLowerCase()))
    );

    if (!match) {
      const available = transitions.map((t) => `"${t.name}"`).join(", ");
      throw new Error(
        `No transition found for status "${targetStatus}" on issue ${ticketId}. ` +
        `Available: ${available || "(none)"}. ` +
        `Configure transitionNames in JiraConfig to override.`
      );
    }

    await this.request(`/rest/api/3/issue/${ticketId}/transitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transition: { id: match.id } }),
    });
  }
}

// ---------------------------------------------------------------------------
// JQL helpers (exported for testing)
// ---------------------------------------------------------------------------

export const STATUS_JQL: Record<TicketStatus, string[]> = {
  open:        ['statusCategory = "To Do"'],
  in_progress: ['statusCategory = "In Progress"'],
  pending:     ['status in ("Pending", "On Hold", "Waiting for Customer", "Waiting")'],
  resolved:    ['statusCategory = "Done"'],
  closed:      ['statusCategory = "Done"'],
};
