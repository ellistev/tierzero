import type { Ticket, TicketComment, TicketAttachment, UpdateTicketFields } from "./types";

export interface ListTicketsOptions {
  status?: Ticket["status"] | Ticket["status"][];
  assigneeId?: string;
  projectKey?: string;
  updatedSince?: Date;
  page?: number;
  pageSize?: number;
}

export interface ListTicketsResult {
  tickets: Ticket[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AddCommentOptions {
  isInternal?: boolean;
}

export interface TicketConnector {
  /** Human-readable name, e.g. "Zendesk", "Jira" */
  readonly name: string;

  /** List tickets, optionally filtered/paginated */
  listTickets(options?: ListTicketsOptions): Promise<ListTicketsResult>;

  /** Fetch a single ticket by its source ID */
  getTicket(id: string): Promise<Ticket>;

  /** Fetch all comments for a ticket */
  getComments(ticketId: string): Promise<TicketComment[]>;

  /** Post a new comment on a ticket */
  addComment(ticketId: string, body: string, options?: AddCommentOptions): Promise<TicketComment>;

  /** List attachments on a ticket */
  listAttachments(ticketId: string): Promise<TicketAttachment[]>;

  /** Download an attachment -- returns raw bytes */
  downloadAttachment(attachmentId: string): Promise<Buffer>;

  /** Upload a file and attach it to a ticket -- returns the created attachment */
  uploadAttachment(ticketId: string, filename: string, data: Buffer, mimeType?: string): Promise<TicketAttachment>;

  /** Update mutable fields on a ticket (status, assignee, priority). Returns the updated ticket. */
  updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket>;
}
