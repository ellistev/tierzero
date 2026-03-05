import { Aggregate } from "./aggregate";

export class CachedAggregate {
  constructor(
    public readonly streamId: string,
    public readonly streamRevision: number,
    public readonly lastSnapshotRevision: number,
    public readonly aggregate: Aggregate
  ) {}
}

export interface IAggregateCache {
  get(streamId: string): Promise<CachedAggregate>
  set(cachedAggregate: CachedAggregate): Promise<void>
}
