import Logger from "./Logger.js";

export default class NoOpLogger extends Logger {
  constructor() {
    super(0);
  }

  info() {
    // nothing to do here
  }

  debug() {
    // nothing to do here
  }

  warn() {
    // nothing to do here
  }

  error() {
    // nothing to do here
  }
}
