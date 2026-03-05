/**
 * @implements ISnapshotStore
 */
export default class NullSnapshotStore {
  async add(snapshot) {
    return null;
  }

  async get(streamId) {
    //do nothing
  }
}
