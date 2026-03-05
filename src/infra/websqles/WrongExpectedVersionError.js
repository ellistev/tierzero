export default class WrongExpectedVersionError extends Error {
  constructor(expectedVersion, currentVersion) {
    super();
    this.name = 'WrongExpectedVersionError';
    this.message = `expected version ${expectedVersion} got ${currentVersion}`;
  }
}
