/**
 * Tickets Read Model
 * Queryable view of ticket data, projected from ticket events
 */

// Simplified types matching the infra pattern
interface BuilderEventData {
  streamId: string;
  eventNumber: number;
  position: unknown;
  event: unknown;
  eventId: string;
  typeId: string;
  creationTime: number;
  metadata: Record<string, unknown>;
}

interface TransactionalRepository<T> {
  create_v2(record: T): void;
  upsert(record: T): void;
  updateOne(filter: Partial<T>, update: Partial<T>): void;
  findOne_v2(filter: Partial<T>): Promise<T | null>;
}

export interface TicketRecord {
  id: string;
  title: string;
  description: string;
  source: string;
  status: string;
  workflowId: string | null;
  confidence: number | null;
  resolution: string | null;
  escalationReason: string | null;
  receivedAt: string;
  analyzedAt: string | null;
  matchedAt: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
}

export const ticketsReadModel = {
  name: "tickets",
  config: {
    key: "id",
    indexes: ["status", "workflowId"],
    schema: {
      id: { type: "string", nullable: false, maxLength: 64 },
      title: { type: "string", nullable: false },
      description: { type: "string", nullable: true },
      source: { type: "string", nullable: false },
      status: { type: "string", nullable: false, maxLength: 32 },
      workflowId: { type: "string", nullable: true, maxLength: 64 },
      confidence: { type: "number", nullable: true },
      resolution: { type: "string", nullable: true },
      escalationReason: { type: "string", nullable: true },
      receivedAt: { type: "string", nullable: false },
      analyzedAt: { type: "string", nullable: true },
      matchedAt: { type: "string", nullable: true },
      resolvedAt: { type: "string", nullable: true },
      escalatedAt: { type: "string", nullable: true },
    },
  },
  lookups: {},
  async handler(repo: TransactionalRepository<TicketRecord>, eventData: BuilderEventData) {
    const { typeId, event } = eventData;
    const e = event as Record<string, unknown>;

    switch (typeId) {
      case "TicketReceived":
        repo.upsert({
          id: e.id as string,
          title: e.title as string,
          description: e.description as string,
          source: e.source as string,
          status: "received",
          workflowId: null,
          confidence: null,
          resolution: null,
          escalationReason: null,
          receivedAt: e.receivedAt as string,
          analyzedAt: null,
          matchedAt: null,
          resolvedAt: null,
          escalatedAt: null,
        });
        break;
      case "TicketAnalyzed":
        repo.updateOne({ id: e.ticketId as string }, { status: "analyzed", analyzedAt: e.analyzedAt as string });
        break;
      case "TicketMatchedToWorkflow":
        repo.updateOne({ id: e.ticketId as string }, {
          status: "matched",
          workflowId: e.workflowId as string,
          confidence: e.confidence as number,
          matchedAt: e.matchedAt as string,
        });
        break;
      case "TicketEscalated":
        repo.updateOne({ id: e.ticketId as string }, {
          status: "escalated",
          escalationReason: e.reason as string,
          escalatedAt: e.escalatedAt as string,
        });
        break;
      case "TicketResolved":
        repo.updateOne({ id: e.ticketId as string }, {
          status: "resolved",
          resolution: e.resolution as string,
          resolvedAt: e.resolvedAt as string,
        });
        break;
    }
  },
};
