import { Aggregate } from "../../infra/aggregate";
import { ReceiveTicket, AnalyzeTicket, MatchToWorkflow, EscalateTicket, ResolveTicket, PostComment } from "./commands";
import { TicketReceived, TicketAnalyzed, TicketMatchedToWorkflow, TicketEscalated, TicketResolved, TicketCommentPosted } from "./events";

interface TicketState extends Record<string, unknown> {
  id: string;
  title: string;
  description: string;
  source: string;
  fields: Record<string, unknown>;
  status: "received" | "analyzed" | "matched" | "escalated" | "resolved";
  workflowId: string | null;
  resolution: string | null;
  comments: Array<{ comment: string; isInternal: boolean; postedAt: string }>;
}

export class Ticket extends Aggregate<TicketState> {
  static type = "Ticket" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(ReceiveTicket, (_state, cmd) => {
      return [new TicketReceived(cmd.id, cmd.title, cmd.description, cmd.source, cmd.fields, cmd.receivedAt)];
    });

    this._registerCommandHandler(AnalyzeTicket, (state, cmd) => {
      if (!state.id) throw new Error("Ticket does not exist");
      if (state.status === "resolved") throw new Error("Cannot analyze a resolved ticket");
      return [new TicketAnalyzed(cmd.ticketId, cmd.extractedFields, cmd.analysisResult, cmd.analyzedAt)];
    });

    this._registerCommandHandler(MatchToWorkflow, (state, cmd) => {
      if (!state.id) throw new Error("Ticket does not exist");
      if (state.status === "resolved") throw new Error("Cannot match a resolved ticket");
      return [new TicketMatchedToWorkflow(cmd.ticketId, cmd.workflowId, cmd.confidence, cmd.matchedAt)];
    });

    this._registerCommandHandler(EscalateTicket, (state, cmd) => {
      if (!state.id) throw new Error("Ticket does not exist");
      if (state.status === "resolved") throw new Error("Cannot escalate a resolved ticket");
      return [new TicketEscalated(cmd.ticketId, cmd.reason, cmd.escalatedAt)];
    });

    this._registerCommandHandler(ResolveTicket, (state, cmd) => {
      if (!state.id) throw new Error("Ticket does not exist");
      if (state.status === "resolved") throw new Error("Ticket already resolved");
      return [new TicketResolved(cmd.ticketId, cmd.resolution, cmd.resolvedAt)];
    });

    this._registerCommandHandler(PostComment, (state, cmd) => {
      if (!state.id) throw new Error("Ticket does not exist");
      return [new TicketCommentPosted(cmd.ticketId, cmd.comment, cmd.isInternal, cmd.postedAt)];
    });

    // Event handlers
    this._registerEventHandler(TicketReceived, (_state, e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      source: e.source,
      fields: e.fields,
      status: "received" as const,
      workflowId: null,
      resolution: null,
      comments: [],
    }));

    this._registerEventHandler(TicketAnalyzed, (state, e) => ({
      ...state,
      fields: { ...state.fields, ...e.extractedFields },
      status: "analyzed" as const,
    }));

    this._registerEventHandler(TicketMatchedToWorkflow, (state, e) => ({
      ...state,
      workflowId: e.workflowId,
      status: "matched" as const,
    }));

    this._registerEventHandler(TicketEscalated, (state, _e) => ({
      ...state,
      status: "escalated" as const,
    }));

    this._registerEventHandler(TicketResolved, (state, e) => ({
      ...state,
      resolution: e.resolution,
      status: "resolved" as const,
    }));

    this._registerEventHandler(TicketCommentPosted, (state, e) => ({
      ...state,
      comments: [...state.comments, { comment: e.comment, isInternal: e.isInternal, postedAt: e.postedAt }],
    }));
  }
}
