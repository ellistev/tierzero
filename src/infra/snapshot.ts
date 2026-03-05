export class Snapshot {
  constructor(
    public readonly streamId: string,
    public readonly streamRevision: number,
    public readonly memento: Record<string, unknown>
  ) {}
}

export interface ISnapshotStore {
  get(streamId: string): Promise<Snapshot>
  add(snapshot: Snapshot): Promise<void>
}
