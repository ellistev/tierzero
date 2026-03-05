export class Snapshot {
  constructor(streamId, streamRevision, memento) {
    this.streamId = streamId;
    this.streamRevision = streamRevision;
    this.memento = memento;
  }
}
