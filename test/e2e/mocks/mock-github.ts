/**
 * In-memory GitHub API mock.
 * Simulates issues, PRs, labels, comments, and merges.
 */

import type { Ticket, TicketComment, TicketUser } from "../../../src/connectors/types";

export interface MockIssue {
  id: string;
  number: number;
  title: string;
  description: string;
  status: "open" | "closed";
  labels: string[];
  comments: TicketComment[];
  reporter: TicketUser;
  assignee?: TicketUser;
}

export interface MockPR {
  number: number;
  title: string;
  body: string;
  head: string;
  draft: boolean;
  state: "open" | "closed" | "merged";
  url: string;
  comments: string[];
  merged: boolean;
  mergeMethod?: string;
}

/**
 * In-memory GitHub connector mock.
 * Satisfies the subset of GitHubConnector that IssuePipeline and GitHubWatcher use.
 */
export class MockGitHub {
  readonly issues = new Map<string, MockIssue>();
  readonly prs = new Map<number, MockPR>();
  private nextPR = 1;

  // ── Issue Management ────────────────────────────────────────────

  addIssue(issue: Omit<MockIssue, "comments"> & { comments?: TicketComment[] }): MockIssue {
    const full: MockIssue = { comments: [], ...issue };
    this.issues.set(issue.id, full);
    return full;
  }

  /** Satisfies GitHubConnector.listTickets() */
  async listTickets(opts: { status?: string; projectKey?: string }): Promise<{ tickets: Ticket[]; total: number }> {
    const tickets = Array.from(this.issues.values())
      .filter((i) => {
        if (opts.status && i.status !== opts.status) return false;
        if (opts.projectKey && !i.labels.includes(opts.projectKey)) return false;
        return true;
      })
      .map((i) => this.toTicket(i));
    return { tickets, total: tickets.length };
  }

  /** Satisfies GitHubConnector.getTicket() */
  async getTicket(id: string): Promise<Ticket | null> {
    const issue = this.issues.get(id);
    return issue ? this.toTicket(issue) : null;
  }

  /** Satisfies GitHubConnector.updateTicket() */
  async updateTicket(id: string, fields: { assigneeId?: string; status?: string }): Promise<void> {
    const issue = this.issues.get(id);
    if (!issue) return;
    if (fields.assigneeId) {
      issue.assignee = { id: fields.assigneeId, name: fields.assigneeId };
    }
    if (fields.status === "closed" || fields.status === "resolved") {
      issue.status = "closed";
    }
  }

  /** Satisfies GitHubConnector.addLabels() */
  async addLabels(issueId: string, labels: string[]): Promise<void> {
    const issue = this.issues.get(issueId);
    if (!issue) return;
    for (const label of labels) {
      if (!issue.labels.includes(label)) {
        issue.labels.push(label);
      }
    }
  }

  /** Satisfies GitHubConnector.addComment() */
  async addComment(issueId: string, body: string): Promise<TicketComment> {
    const issue = this.issues.get(issueId);
    const comment: TicketComment = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: { id: "bot", name: "TierZero" },
      body,
      isInternal: false,
      createdAt: new Date(),
    };
    if (issue) {
      issue.comments.push(comment);
    }
    return comment;
  }

  /** Satisfies GitHubConnector.getComments() */
  async getComments(issueId: string): Promise<TicketComment[]> {
    return this.issues.get(issueId)?.comments ?? [];
  }

  // ── PR Management ───────────────────────────────────────────────

  createPR(opts: { title: string; body?: string; head: string; draft?: boolean }): MockPR {
    const number = this.nextPR++;
    const pr: MockPR = {
      number,
      title: opts.title,
      body: opts.body ?? "",
      head: opts.head,
      draft: opts.draft ?? false,
      state: "open",
      url: `https://github.com/mock/mock/pull/${number}`,
      comments: [],
      merged: false,
    };
    this.prs.set(number, pr);
    return pr;
  }

  mergePR(prNumber: number, method = "squash"): void {
    const pr = this.prs.get(prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not found`);
    pr.state = "merged";
    pr.merged = true;
    pr.mergeMethod = method;
  }

  commentOnPR(prNumber: number, body: string): void {
    const pr = this.prs.get(prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not found`);
    pr.comments.push(body);
  }

  getPR(prNumber: number): MockPR | undefined {
    return this.prs.get(prNumber);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private toTicket(issue: MockIssue): Ticket {
    return {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      source: "github",
      type: "task",
      status: issue.status === "open" ? "open" : "resolved",
      priority: "medium",
      reporter: issue.reporter,
      assignee: issue.assignee,
      tags: issue.labels,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
