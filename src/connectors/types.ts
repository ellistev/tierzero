export type TicketStatus = "open" | "in_progress" | "pending" | "resolved" | "closed";
export type TicketPriority = "critical" | "high" | "medium" | "low";
export type TicketType = "incident" | "request" | "bug" | "task" | "change" | "problem";

export interface TicketUser {
  id: string;
  name: string;
  email?: string;
}

export interface TicketComment {
  id: string;
  author: TicketUser;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface TicketAttachment {
  id: string;
  filename: string;
  url: string;
  size?: number;
  mimeType?: string;
}

export interface Ticket {
  // Identity
  id: string;
  externalId?: string; // source system's native ID
  source: "zendesk" | "servicenow" | "jira" | string;
  url?: string;

  // Content
  title: string;
  description: string;
  type: TicketType;

  // State
  status: TicketStatus;
  priority: TicketPriority;

  // People
  reporter: TicketUser;
  assignee?: TicketUser;
  watchers?: TicketUser[];

  // Organization
  tags?: string[];
  labels?: string[];
  project?: string;
  queue?: string;

  // Relations
  parentId?: string;
  childIds?: string[];
  relatedIds?: string[];

  // Extras
  comments?: TicketComment[];
  attachments?: TicketAttachment[];
  customFields?: Record<string, unknown>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  dueAt?: Date;
}
