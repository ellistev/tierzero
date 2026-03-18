/**
 * GitLab Issues REST API v4 connector.
 *
 * Auth:    PRIVATE-TOKEN header (Personal Access Token or Group/Project Access Token).
 * Issues:  scoped to a single project (numeric ID or "group/project" path).
 * Status:  GitLab only has "opened" / "closed" natively.
 *          "in_progress" and "pending" are represented by configurable labels.
 * Priority: no built-in field -- inferred from labels (e.g. "priority::high") or
 *           the `severity` field on incident issues.
 * Internal notes: uses `confidential: true` on notes (GitLab Premium/Ultimate).
 *          Gracefully falls back to a regular note on lower tiers.
 * Attachments: GitLab has no structured per-issue attachment list.
 *          uploadAttachment uses the project uploads API; listAttachments
 *          returns [] (attachments are embedded as markdown links in note bodies).
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

export interface GitLabConfig {
  /** e.g. https://gitlab.com or https://gitlab.mycompany.com */
  baseUrl: string;
  /** Personal Access Token or Group/Project Access Token */
  token: string;
  /**
   * Project path (e.g. "mygroup/myproject") or numeric project ID.
   * All issue API calls are scoped to this project.
   */
  projectId: string | number;
  /**
   * Labels that indicate a ticket is "in progress".
   * Default: ["in-progress", "doing"]
   */
  inProgressLabels?: string[];
  /**
   * Labels that indicate a ticket is "pending / blocked".
   * Default: ["blocked", "pending", "on-hold"]
   */
  pendingLabels?: string[];
}

export const DEFAULT_IN_PROGRESS_LABELS = ["in-progress", "doing"];
export const DEFAULT_PENDING_LABELS = ["blocked", "pending", "on-hold"];

// ---------------------------------------------------------------------------
// Raw GitLab API shapes
// ---------------------------------------------------------------------------

interface GitLabUser {
  id: number;
  name: string;
  username: string;
  email?: string;
}

interface GitLabIssue {
  id: number;        // global unique ID
  iid: number;       // project-scoped issue number (what users see)
  project_id: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
  labels: string[];
  assignees: GitLabUser[];
  author: GitLabUser;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  due_date: string | null;
  web_url: string;
  issue_type: string;             // "issue" | "incident" | "task" | "test_case"
  severity?: string;              // GitLab 15+ incidents: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"
  milestone?: { id: number; title: string } | null;
}

interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  system: boolean;   // true for automated GitLab activity notes (we skip these)
  confidential: boolean;
}

interface GitLabUpload {
  alt: string;
  url: string;          // relative path, e.g. "/uploads/hash/filename"
  full_path: string;
  markdown: string;
}

// ---------------------------------------------------------------------------
// Field mapping tables
// ---------------------------------------------------------------------------

const LABEL_PRIORITY_MAP: Record<string, TicketPriority> = {
  "priority::critical": "critical",
  "priority::high":     "high",
  "priority::medium":   "medium",
  "priority::low":      "low",
  // Short-form labels
  critical:  "critical",
  high:      "high",
  medium:    "medium",
  low:       "low",
  // Severity scoped labels
  "severity::critical": "critical",
  "severity::high":     "high",
  "severity::medium":   "medium",
  "severity::low":      "low",
};

const ISSUE_TYPE_MAP: Record<string, TicketType> = {
  issue:      "task",
  task:       "task",
  incident:   "incident",
  test_case:  "task",
  objective:  "task",
  key_result: "task",
};

// GitLab severity field (incident issues, GitLab 15+) to TicketPriority
const SEVERITY_MAP: Record<string, TicketPriority> = {
  CRITICAL: "critical",
  HIGH:     "high",
  MEDIUM:   "medium",
  LOW:      "low",
  UNKNOWN:  "medium",
};

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Map a GitLab issue's state + labels to our canonical TicketStatus.
 * Priority: closed → resolved, then pending labels, then in-progress labels, else open.
 */
export function mapStatus(
  state: "opened" | "closed",
  labels: string[],
  inProgressLabels: string[],
  pendingLabels: string[]
): TicketStatus {
  if (state === "closed") return "resolved";
  const lower = labels.map((l) => l.toLowerCase());
  if (pendingLabels.some((pl) => lower.includes(pl.toLowerCase()))) return "pending";
  if (inProgressLabels.some((il) => lower.includes(il.toLowerCase()))) return "in_progress";
  return "open";
}

/**
 * Infer TicketPriority from issue labels and the optional severity field.
 * Severity field (set on incidents) takes precedence over labels.
 */
export function mapPriorityFromLabels(labels: string[], severity?: string): TicketPriority {
  if (severity && SEVERITY_MAP[severity]) return SEVERITY_MAP[severity];
  for (const label of labels) {
    const mapped = LABEL_PRIORITY_MAP[label.toLowerCase()];
    if (mapped) return mapped;
  }
  return "medium";
}

/**
 * Build the GitLab issue update body from UpdateTicketFields.
 * Status uses `state_event`; in_progress/pending are managed via add/remove labels.
 * Pure function -- exported for unit testing.
 */
export function buildUpdateFields(
  fields: UpdateTicketFields,
  inProgressLabels: string[],
  pendingLabels: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const addLabels: string[] = [];
  const removeLabels: string[] = [];

  if (fields.status !== undefined) {
    switch (fields.status) {
      case "resolved":
      case "closed":
        out.state_event = "close";
        break;
      case "open":
        out.state_event = "reopen";
        removeLabels.push(...inProgressLabels, ...pendingLabels);
        break;
      case "in_progress":
        out.state_event = "reopen";
        if (inProgressLabels[0]) addLabels.push(inProgressLabels[0]);
        removeLabels.push(...pendingLabels);
        break;
      case "pending":
        if (pendingLabels[0]) addLabels.push(pendingLabels[0]);
        removeLabels.push(...inProgressLabels);
        break;
    }
  }

  if (fields.assigneeId !== undefined) {
    out.assignee_ids = fields.assigneeId
      ? [parseInt(fields.assigneeId, 10)]
      : [];
  }

  if (fields.priority !== undefined) {
    // Remove all existing priority:: labels before adding the new one
    removeLabels.push(
      "priority::critical", "priority::high", "priority::medium", "priority::low"
    );
    addLabels.push(`priority::${fields.priority}`);
  }

  if (addLabels.length > 0)    out.add_labels    = addLabels.join(",");
  if (removeLabels.length > 0) out.remove_labels = removeLabels.join(",");

  return out;
}

function toUser(u: GitLabUser): TicketUser {
  return { id: String(u.id), name: u.name, email: u.email };
}

function toTicket(
  issue: GitLabIssue,
  inProgressLabels: string[],
  pendingLabels: string[]
): Ticket {
  return {
    id: String(issue.iid),         // project-scoped number -- what users reference
    externalId: String(issue.id),  // global GitLab ID
    source: "gitlab",
    url: issue.web_url,
    title: issue.title,
    description: issue.description ?? "",
    type: ISSUE_TYPE_MAP[issue.issue_type] ?? "task",
    status: mapStatus(issue.state, issue.labels, inProgressLabels, pendingLabels),
    priority: mapPriorityFromLabels(issue.labels, issue.severity),
    reporter: toUser(issue.author),
    assignee: issue.assignees[0] ? toUser(issue.assignees[0]) : undefined,
    labels: issue.labels,
    project: String(issue.project_id),
    createdAt: new Date(issue.created_at),
    updatedAt: new Date(issue.updated_at),
    resolvedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
    dueAt: issue.due_date ? new Date(issue.due_date) : undefined,
  };
}

function toComment(note: GitLabNote): TicketComment {
  return {
    id: String(note.id),
    author: toUser(note.author),
    body: note.body,
    isInternal: note.confidential,
    createdAt: new Date(note.created_at),
  };
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

/* istanbul ignore next */
export const _testExports = {
  LABEL_PRIORITY_MAP,
  ISSUE_TYPE_MAP,
  SEVERITY_MAP,
  DEFAULT_IN_PROGRESS_LABELS,
  DEFAULT_PENDING_LABELS,
  mapStatus,
  mapPriorityFromLabels,
  buildUpdateFields,
  toUser,
};

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export class GitLabConnector implements TicketConnector {
  readonly name = "GitLab";
  private readonly baseUrl: string;
  private readonly projectPath: string;
  private readonly inProgressLabels: string[];
  private readonly pendingLabels: string[];

  constructor(private readonly config: GitLabConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    // URL-encode the project path for API calls (e.g. "group/project" → "group%2Fproject")
    this.projectPath = encodeURIComponent(String(config.projectId));
    this.inProgressLabels = config.inProgressLabels ?? DEFAULT_IN_PROGRESS_LABELS;
    this.pendingLabels = config.pendingLabels ?? DEFAULT_PENDING_LABELS;
  }

  private get apiBase() {
    return `${this.baseUrl}/api/v4/projects/${this.projectPath}`;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "PRIVATE-TOKEN": this.config.token,
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitLab ${res.status} ${res.statusText}: ${body}`);
    }

    if (res.status === 204) {
      return { data: undefined as unknown as T, headers: res.headers };
    }

    return { data: (await res.json()) as T, headers: res.headers };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const { data: user } = await this.request<GitLabUser>(`${this.baseUrl}/api/v4/user`);
      return {
        ok: true,
        connector: this.name,
        latencyMs: Date.now() - start,
        details: `Authenticated as ${user.username}`,
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

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(pageSize),
    });

    // Map our statuses to GitLab's opened/closed
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const needsOpen   = statuses.some((s) => s === "open" || s === "in_progress" || s === "pending");
      const needsClosed = statuses.some((s) => s === "resolved" || s === "closed");
      if (needsOpen && needsClosed) params.set("state", "all");
      else if (needsOpen)           params.set("state", "opened");
      else if (needsClosed)         params.set("state", "closed");
    }

    if (options.assigneeId) params.set("assignee_id", options.assigneeId);

    if (options.updatedSince) {
      params.set("updated_after", options.updatedSince.toISOString());
    }

    const { data, headers } = await this.request<GitLabIssue[]>(
      `/issues?${params}`
    );

    const total = parseInt(headers.get("X-Total") ?? "0", 10);
    const tickets = data.map((i) => toTicket(i, this.inProgressLabels, this.pendingLabels));

    return {
      tickets,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getTicket(id: string): Promise<Ticket> {
    const { data } = await this.request<GitLabIssue>(`/issues/${id}`);
    return toTicket(data, this.inProgressLabels, this.pendingLabels);
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const params = new URLSearchParams({ sort: "asc", per_page: "100" });
    const { data } = await this.request<GitLabNote[]>(
      `/issues/${ticketId}/notes?${params}`
    );
    // Skip system notes (automated GitLab activity entries)
    return data.filter((n) => !n.system).map(toComment);
  }

  async addComment(
    ticketId: string,
    body: string,
    options: AddCommentOptions = {}
  ): Promise<TicketComment> {
    const payload: Record<string, unknown> = { body };

    if (options.isInternal) {
      // confidential notes require GitLab Premium/Ultimate
      payload.confidential = true;
    }

    try {
      const { data } = await this.request<GitLabNote>(
        `/issues/${ticketId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      return toComment(data);
    } catch (err) {
      // If confidential flag caused a 400/403 (tier limitation), retry without it
      if (options.isInternal && String(err).includes("4")) {
        const { data } = await this.request<GitLabNote>(
          `/issues/${ticketId}/notes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          }
        );
        return toComment(data);
      }
      throw err;
    }
  }

  async listAttachments(_ticketId: string): Promise<TicketAttachment[]> {
    // GitLab has no structured per-issue attachment listing.
    // Uploaded files are embedded as markdown links in issue/note bodies.
    return [];
  }

  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    // attachmentId is the upload URL (relative or absolute)
    const url = attachmentId.startsWith("http")
      ? attachmentId
      : `${this.baseUrl}${attachmentId}`;
    const res = await fetch(url, {
      headers: { "PRIVATE-TOKEN": this.config.token },
    });
    if (!res.ok) throw new Error(`GitLab attachment download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadAttachment(
    _ticketId: string,
    filename: string,
    data: Buffer,
    mimeType = "application/octet-stream"
  ): Promise<TicketAttachment> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), filename);

    const { data: upload } = await this.request<GitLabUpload>("/uploads", {
      method: "POST",
      body: form,
    });

    // Resolve the relative URL to an absolute one
    const url = upload.url.startsWith("http")
      ? upload.url
      : `${this.baseUrl}${upload.url}`;

    return {
      id: url,          // URL is the only stable reference for downloads
      filename: upload.alt || filename,
      url,
    };
  }

  async updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket> {
    const body = buildUpdateFields(fields, this.inProgressLabels, this.pendingLabels);

    const { data } = await this.request<GitLabIssue>(`/issues/${ticketId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return toTicket(data, this.inProgressLabels, this.pendingLabels);
  }
}
