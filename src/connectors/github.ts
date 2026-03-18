/**
 * GitHub Issues REST API connector.
 *
 * Auth: Personal access token (PAT) with `repo` scope.
 * Maps GitHub Issues to the unified Ticket interface.
 * Labels are mapped to tags; milestones to project field.
 * Status mapping: open -> open, closed -> resolved.
 * PR linking: if an issue has a linked PR, it's tracked in customFields.
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

export interface GitHubConfig {
  /** GitHub PAT with repo scope */
  token: string;
  /** Repository owner (user or org) */
  owner: string;
  /** Repository name */
  repo: string;
  /** API base URL. Defaults to https://api.github.com */
  apiUrl?: string;
}

// ---------------------------------------------------------------------------
// Raw GitHub API shapes
// ---------------------------------------------------------------------------

interface GHUser {
  id: number;
  login: string;
  email?: string;
}

interface GHLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

interface GHMilestone {
  id: number;
  title: string;
  number: number;
}

interface GHIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GHUser;
  assignee: GHUser | null;
  assignees: GHUser[];
  labels: GHLabel[];
  milestone: GHMilestone | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: { url: string };
  comments: number;
}

interface GHComment {
  id: number;
  user: GHUser;
  body: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Priority inference from labels
// ---------------------------------------------------------------------------

const PRIORITY_LABELS: Record<string, TicketPriority> = {
  "priority: critical": "critical",
  "priority: high": "high",
  "priority: medium": "medium",
  "priority: low": "low",
  "p0": "critical",
  "p1": "high",
  "p2": "medium",
  "p3": "low",
  "critical": "critical",
  "urgent": "critical",
};

const TYPE_LABELS: Record<string, TicketType> = {
  "bug": "bug",
  "feature": "task",
  "enhancement": "task",
  "task": "task",
  "incident": "incident",
  "request": "request",
  "change": "change",
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toUser(u: GHUser): TicketUser {
  return { id: String(u.id), name: u.login, email: u.email };
}

function inferPriority(labels: GHLabel[]): TicketPriority {
  for (const label of labels) {
    const mapped = PRIORITY_LABELS[label.name.toLowerCase()];
    if (mapped) return mapped;
  }
  return "medium";
}

function inferType(labels: GHLabel[]): TicketType {
  for (const label of labels) {
    const mapped = TYPE_LABELS[label.name.toLowerCase()];
    if (mapped) return mapped;
  }
  return "task";
}

function mapStatus(state: "open" | "closed"): TicketStatus {
  return state === "open" ? "open" : "resolved";
}

function toTicket(issue: GHIssue, owner: string, repo: string): Ticket {
  return {
    id: String(issue.number),
    externalId: String(issue.id),
    source: "github",
    url: issue.html_url,
    title: issue.title,
    description: issue.body ?? "",
    type: inferType(issue.labels),
    status: mapStatus(issue.state),
    priority: inferPriority(issue.labels),
    reporter: toUser(issue.user),
    assignee: issue.assignee ? toUser(issue.assignee) : undefined,
    watchers: issue.assignees.map(toUser),
    tags: issue.labels.map((l) => l.name),
    project: issue.milestone?.title,
    customFields: {
      isPullRequest: !!issue.pull_request,
      commentCount: issue.comments,
      owner,
      repo,
    },
    createdAt: new Date(issue.created_at),
    updatedAt: new Date(issue.updated_at),
    resolvedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
  };
}

function toComment(comment: GHComment): TicketComment {
  return {
    id: String(comment.id),
    author: toUser(comment.user),
    body: comment.body,
    isInternal: false, // GitHub has no internal comments
    createdAt: new Date(comment.created_at),
  };
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

export const _testExports = {
  PRIORITY_LABELS,
  TYPE_LABELS,
  toUser,
  inferPriority,
  inferType,
  mapStatus,
  toTicket,
  toComment,
};

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export class GitHubConnector implements TicketConnector {
  readonly name = "GitHub";
  private readonly apiUrl: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;

  constructor(config: GitHubConfig) {
    this.apiUrl = (config.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.apiUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub ${res.status} ${res.statusText}: ${body}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  private repoPath(path: string): string {
    return `/repos/${this.owner}/${this.repo}${path}`;
  }

  async listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 30;

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(pageSize),
      sort: "updated",
      direction: "desc",
    });

    // Map status filter
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      // GitHub only has open/closed -- if any "open" status requested, use open
      const wantOpen = statuses.some((s) => s === "open" || s === "in_progress" || s === "pending");
      const wantClosed = statuses.some((s) => s === "resolved" || s === "closed");
      if (wantOpen && !wantClosed) params.set("state", "open");
      else if (wantClosed && !wantOpen) params.set("state", "closed");
      else params.set("state", "all");
    } else {
      params.set("state", "open"); // default: open issues only
    }

    if (options.assigneeId) params.set("assignee", options.assigneeId);
    if (options.updatedSince) params.set("since", options.updatedSince.toISOString());

    // Filter for labels matching projectKey if provided
    if (options.projectKey) params.set("labels", options.projectKey);

    const issues = await this.request<GHIssue[]>(
      this.repoPath(`/issues?${params}`)
    );

    // Filter out PRs (GitHub API returns PRs in /issues)
    const realIssues = issues.filter((i) => !i.pull_request);

    return {
      tickets: realIssues.map((i) => toTicket(i, this.owner, this.repo)),
      total: realIssues.length, // GitHub doesn't return total count easily
      page,
      pageSize,
      hasMore: issues.length === pageSize,
    };
  }

  async getTicket(id: string): Promise<Ticket> {
    const issue = await this.request<GHIssue>(
      this.repoPath(`/issues/${id}`)
    );
    return toTicket(issue, this.owner, this.repo);
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const comments = await this.request<GHComment[]>(
      this.repoPath(`/issues/${ticketId}/comments?per_page=100`)
    );
    return comments.map(toComment);
  }

  async addComment(
    ticketId: string,
    body: string,
    _options: AddCommentOptions = {}
  ): Promise<TicketComment> {
    // GitHub has no internal comments - isInternal is ignored
    const comment = await this.request<GHComment>(
      this.repoPath(`/issues/${ticketId}/comments`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }
    );
    return toComment(comment);
  }

  async listAttachments(_ticketId: string): Promise<TicketAttachment[]> {
    // GitHub doesn't have native file attachments on issues
    // Images are inline in markdown body. Return empty.
    return [];
  }

  async downloadAttachment(_attachmentId: string): Promise<Buffer> {
    throw new Error("GitHub Issues does not support file attachments");
  }

  async uploadAttachment(
    _ticketId: string,
    _filename: string,
    _data: Buffer,
    _mimeType?: string
  ): Promise<TicketAttachment> {
    throw new Error("GitHub Issues does not support file attachments via API");
  }

  async updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket> {
    const body: Record<string, unknown> = {};

    if (fields.status !== undefined) {
      body.state = fields.status === "open" || fields.status === "in_progress" || fields.status === "pending"
        ? "open"
        : "closed";
    }

    if (fields.assigneeId !== undefined) {
      body.assignees = fields.assigneeId ? [fields.assigneeId] : [];
    }

    if (fields.priority !== undefined) {
      // Add/update priority label
      const issue = await this.getTicket(ticketId);
      const currentTags = issue.tags ?? [];
      // Remove existing priority labels
      const filtered = currentTags.filter(
        (t) => !Object.keys(PRIORITY_LABELS).includes(t.toLowerCase())
      );
      filtered.push(`priority: ${fields.priority}`);
      body.labels = filtered;
    }

    if (Object.keys(body).length > 0) {
      await this.request(this.repoPath(`/issues/${ticketId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    return this.getTicket(ticketId);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const user = await this.request<GHUser>("/user");
      return {
        ok: true,
        connector: this.name,
        latencyMs: Date.now() - start,
        details: `Authenticated as ${user.login}`,
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

  // ---------------------------------------------------------------------------
  // GitHub-specific extras (not part of TicketConnector interface)
  // ---------------------------------------------------------------------------

  /** Create a new issue */
  async createIssue(title: string, body: string, labels?: string[]): Promise<Ticket> {
    const issue = await this.request<GHIssue>(
      this.repoPath("/issues"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, labels }),
      }
    );
    return toTicket(issue, this.owner, this.repo);
  }

  /** Add labels to an issue */
  async addLabels(ticketId: string, labels: string[]): Promise<void> {
    await this.request(
      this.repoPath(`/issues/${ticketId}/labels`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      }
    );
  }

  /** Remove a label from an issue */
  async removeLabel(ticketId: string, label: string): Promise<void> {
    await this.request(
      this.repoPath(`/issues/${ticketId}/labels/${encodeURIComponent(label)}`),
      { method: "DELETE" }
    );
  }
}
