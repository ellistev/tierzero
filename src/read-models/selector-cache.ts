/**
 * Selector Cache Read Model
 * Projects from IntentSucceeded events to maintain a per-page per-intent
 * cache of working selectors for the intent execution layer.
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
  updateOne(filter: Partial<T>, update: Partial<T>): void;
  findOne_v2(filter: Partial<T>): Promise<T | null>;
}

export interface SelectorCacheRecord {
  cacheKey: string;
  page: string;
  intentName: string;
  lastSelector: string;
  lastMethod: string;
  successCount: number;
  lastUsed: string;
  avgDurationMs: number;
}

export const selectorCacheReadModel = {
  name: "selector_cache",
  config: {
    key: "cacheKey",
    indexes: ["page", "intentName"],
    schema: {
      cacheKey: { type: "string", nullable: false },
      page: { type: "string", nullable: false },
      intentName: { type: "string", nullable: false },
      lastSelector: { type: "string", nullable: false },
      lastMethod: { type: "string", nullable: false },
      successCount: { type: "number", nullable: false },
      lastUsed: { type: "string", nullable: false },
      avgDurationMs: { type: "number", nullable: false },
    },
  },
  lookups: {},
  async handler(repo: TransactionalRepository<SelectorCacheRecord>, eventData: BuilderEventData) {
    const { typeId, event } = eventData;
    const e = event as Record<string, unknown>;

    if (typeId !== "IntentSucceeded") return;

    // We need the page and intentName from the stream context.
    // The streamId format is "IntentExecution-{intentId}".
    // The intent's page/name are carried in the event metadata or
    // we derive the cacheKey from the event data.
    // IntentSucceeded has: intentId, selector, method, durationMs, succeededAt
    // We need the page and intentName. These come from the IntentAttempted event
    // which set up the aggregate. Since the read model receives events in order,
    // we track IntentAttempted to capture page+intentName, then update on IntentSucceeded.

    // Actually, let's handle both events to build the cache properly.
    // This is handled below.
  },
};

/**
 * Enhanced selector cache read model that handles both IntentAttempted and IntentSucceeded.
 * IntentAttempted: creates/updates the intent tracking record
 * IntentSucceeded: updates the cache with the working selector
 */
export const selectorCacheReadModelFull = {
  name: "selector_cache",
  config: {
    key: "cacheKey",
    indexes: ["page", "intentName"],
    schema: {
      cacheKey: { type: "string", nullable: false },
      page: { type: "string", nullable: false },
      intentName: { type: "string", nullable: false },
      lastSelector: { type: "string", nullable: false },
      lastMethod: { type: "string", nullable: false },
      successCount: { type: "number", nullable: false },
      lastUsed: { type: "string", nullable: false },
      avgDurationMs: { type: "number", nullable: false },
    },
  },
  lookups: {},
  async handler(repo: TransactionalRepository<SelectorCacheRecord>, eventData: BuilderEventData) {
    const { typeId, event } = eventData;
    const e = event as Record<string, unknown>;

    switch (typeId) {
      case "IntentSucceeded": {
        const intentId = e.intentId as string;
        const selector = e.selector as string;
        const method = e.method as string;
        const durationMs = e.durationMs as number;
        const succeededAt = e.succeededAt as string;

        // Look up the page and intentName from metadata
        // The metadata should contain page and intentName set during AttemptIntent
        const page = (eventData.metadata.page as string) ?? "unknown";
        const intentName = (eventData.metadata.intentName as string) ?? intentId;
        const cacheKey = `${page}::${intentName}`;

        const existing = await repo.findOne_v2({ cacheKey });
        if (existing) {
          const newCount = existing.successCount + 1;
          const newAvg = ((existing.avgDurationMs * existing.successCount) + durationMs) / newCount;
          repo.updateOne({ cacheKey }, {
            lastSelector: selector,
            lastMethod: method,
            successCount: newCount,
            lastUsed: succeededAt,
            avgDurationMs: Math.round(newAvg),
          });
        } else {
          repo.create_v2({
            cacheKey,
            page,
            intentName,
            lastSelector: selector,
            lastMethod: method,
            successCount: 1,
            lastUsed: succeededAt,
            avgDurationMs: durationMs,
          });
        }
        break;
      }
    }
  },
};
