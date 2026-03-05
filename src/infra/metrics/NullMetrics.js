export default class NullMetrics {
  capture() {
    //nothing
  }
  compute() {
    return {};
  }
  time(key, fn) {
    return fn();
  }
}
