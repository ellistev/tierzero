import type { ReadModelDefinition, StoredEvent, ReadModelRepo } from "../infra/interfaces";

const STATS_KEY = "global";

export const ticketStatsReadModel: ReadModelDefinition = {
  config: {
    table: "ticket_stats",
    key: "id",
    schema: {
      id: "TEXT PRIMARY KEY",
      total: "INTEGER",
      byStatus: "TEXT",
      byWorkflow: "TEXT",
      totalResolved: "INTEGER",
      totalEscalated: "INTEGER",
    },
  },
  handler(repo: ReadModelRepo, event: StoredEvent) {
    function ensureStats(): Record<string, unknown> {
      let stats = repo.findOne(STATS_KEY);
      if (!stats) {
        stats = { id: STATS_KEY, total: 0, byStatus: {}, byWorkflow: {}, totalResolved: 0, totalEscalated: 0 };
        repo.create(stats);
      }
      return stats;
    }

    const d = event.data;
    switch (event.type) {
      case "TicketReceived": {
        const stats = ensureStats();
        const byStatus = (stats.byStatus as Record<string, number>) || {};
        byStatus["received"] = (byStatus["received"] || 0) + 1;
        repo.updateOne(STATS_KEY, { total: (stats.total as number) + 1, byStatus });
        break;
      }
      case "TicketAnalyzed": {
        const stats = ensureStats();
        const byStatus = (stats.byStatus as Record<string, number>) || {};
        byStatus["received"] = Math.max(0, (byStatus["received"] || 0) - 1);
        byStatus["analyzed"] = (byStatus["analyzed"] || 0) + 1;
        repo.updateOne(STATS_KEY, { byStatus });
        break;
      }
      case "TicketMatchedToWorkflow": {
        const stats = ensureStats();
        const byStatus = (stats.byStatus as Record<string, number>) || {};
        byStatus["analyzed"] = Math.max(0, (byStatus["analyzed"] || 0) - 1);
        byStatus["matched"] = (byStatus["matched"] || 0) + 1;
        const byWorkflow = (stats.byWorkflow as Record<string, number>) || {};
        byWorkflow[d.workflowId as string] = (byWorkflow[d.workflowId as string] || 0) + 1;
        repo.updateOne(STATS_KEY, { byStatus, byWorkflow });
        break;
      }
      case "TicketEscalated": {
        const stats = ensureStats();
        const byStatus = (stats.byStatus as Record<string, number>) || {};
        // Decrement previous status (could be received, analyzed, or matched)
        byStatus["escalated"] = (byStatus["escalated"] || 0) + 1;
        repo.updateOne(STATS_KEY, { byStatus, totalEscalated: (stats.totalEscalated as number) + 1 });
        break;
      }
      case "TicketResolved": {
        const stats = ensureStats();
        const byStatus = (stats.byStatus as Record<string, number>) || {};
        byStatus["resolved"] = (byStatus["resolved"] || 0) + 1;
        repo.updateOne(STATS_KEY, { byStatus, totalResolved: (stats.totalResolved as number) + 1 });
        break;
      }
    }
  },
};
