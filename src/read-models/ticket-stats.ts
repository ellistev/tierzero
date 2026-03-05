/**
 * Ticket Stats Read Model
 * Aggregated statistics projected from ticket events
 */

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

export interface TicketStatsRecord {
  id: string;
  total: number;
  totalReceived: number;
  totalAnalyzed: number;
  totalMatched: number;
  totalEscalated: number;
  totalResolved: number;
}

const STATS_KEY = "global";

export const ticketStatsReadModel = {
  name: "ticket_stats",
  config: {
    key: "id",
    schema: {
      id: { type: "string", nullable: false },
      total: { type: "number", nullable: false },
      totalReceived: { type: "number", nullable: false },
      totalAnalyzed: { type: "number", nullable: false },
      totalMatched: { type: "number", nullable: false },
      totalEscalated: { type: "number", nullable: false },
      totalResolved: { type: "number", nullable: false },
    },
  },
  lookups: {},
  async handler(repo: TransactionalRepository<TicketStatsRecord>, eventData: BuilderEventData) {
    const { typeId } = eventData;

    async function ensureStats(): Promise<TicketStatsRecord> {
      let stats = await repo.findOne_v2({ id: STATS_KEY });
      if (!stats) {
        stats = { id: STATS_KEY, total: 0, totalReceived: 0, totalAnalyzed: 0, totalMatched: 0, totalEscalated: 0, totalResolved: 0 };
        repo.create_v2(stats);
      }
      return stats;
    }

    switch (typeId) {
      case "TicketReceived": {
        const stats = await ensureStats();
        repo.updateOne({ id: STATS_KEY }, { total: stats.total + 1, totalReceived: stats.totalReceived + 1 });
        break;
      }
      case "TicketAnalyzed": {
        const stats = await ensureStats();
        repo.updateOne({ id: STATS_KEY }, { totalAnalyzed: stats.totalAnalyzed + 1 });
        break;
      }
      case "TicketMatchedToWorkflow": {
        const stats = await ensureStats();
        repo.updateOne({ id: STATS_KEY }, { totalMatched: stats.totalMatched + 1 });
        break;
      }
      case "TicketEscalated": {
        const stats = await ensureStats();
        repo.updateOne({ id: STATS_KEY }, { totalEscalated: stats.totalEscalated + 1 });
        break;
      }
      case "TicketResolved": {
        const stats = await ensureStats();
        repo.updateOne({ id: STATS_KEY }, { totalResolved: stats.totalResolved + 1 });
        break;
      }
    }
  },
};
