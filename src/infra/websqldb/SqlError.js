export default class SqlError extends Error {
  constructor(inner, message, sql, args) {
    super();
    this.inner = inner;
    this.name = "SqlError";
    this.message = `${message}: SQL '${sql}' ARGS [${args}]: ${inner.message}`;
  }
}
