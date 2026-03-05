export class CachedAggregate {
  constructor(streamId, streamRevision, lastSnapshotRevision, aggregate) {
    this.streamId = streamId;
    this.streamRevision = streamRevision;
    this.lastSnapshotRevision = lastSnapshotRevision;
    this.aggregate = aggregate;
  }
}
