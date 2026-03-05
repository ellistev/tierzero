import type { ReadModelDefinition, StoredEvent, ReadModelRepo } from "../infra/interfaces";

export const ticketsReadModel: ReadModelDefinition = {
  config: {
    table: "tickets",
    key: "id",
    schema: {
      id: "TEXT PRIMARY KEY",
      title: "TEXT",
      description: "TEXT",
      source: "TEXT",
      fields: "TEXT",
      status: "TEXT",
      workflowId: "TEXT",
      confidence: "REAL",
      resolution: "TEXT",
      escalationReason: "TEXT",
      receivedAt: "TEXT",
      analyzedAt: "TEXT",
      matchedAt: "TEXT",
      resolvedAt: "TEXT",
      escalatedAt: "TEXT",
    },
    indexes: [["status"], ["workflowId"]],
  },
  handler(repo: ReadModelRepo, event: StoredEvent) {
    const d = event.data;
    switch (event.type) {
      case "TicketReceived":
        repo.create({
          id: d.id,
          title: d.title,
          description: d.description,
          source: d.source,
          fields: d.fields,
          status: "received",
          workflowId: null,
          confidence: null,
          resolution: null,
          escalationReason: null,
          receivedAt: d.receivedAt,
          analyzedAt: null,
          matchedAt: null,
          resolvedAt: null,
          escalatedAt: null,
        });
        break;
      case "TicketAnalyzed":
        repo.updateOne(d.ticketId as string, { status: "analyzed", analyzedAt: d.analyzedAt });
        break;
      case "TicketMatchedToWorkflow":
        repo.updateOne(d.ticketId as string, { status: "matched", workflowId: d.workflowId, confidence: d.confidence, matchedAt: d.matchedAt });
        break;
      case "TicketEscalated":
        repo.updateOne(d.ticketId as string, { status: "escalated", escalationReason: d.reason, escalatedAt: d.escalatedAt });
        break;
      case "TicketResolved":
        repo.updateOne(d.ticketId as string, { status: "resolved", resolution: d.resolution, resolvedAt: d.resolvedAt });
        break;
    }
  },
};
