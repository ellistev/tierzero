import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeadLetterQueue } from "./dead-letter";

describe("DeadLetterQueue", () => {
  let dir: string;
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dlq-test-"));
    dlq = new DeadLetterQueue({ directory: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a dead letter and retrieves it by ID", () => {
    const letter = dlq.add({
      taskId: "task-1",
      operation: "github.createPR",
      error: new Error("GitHub 503 Service Unavailable"),
      retries: 3,
      payload: { owner: "test", repo: "repo" },
    });

    assert.ok(letter.id);
    assert.equal(letter.taskId, "task-1");
    assert.equal(letter.operation, "github.createPR");
    assert.equal(letter.error, "GitHub 503 Service Unavailable");
    assert.equal(letter.retries, 3);
    assert.equal(letter.status, "pending");
    assert.deepEqual(letter.payload, { owner: "test", repo: "repo" });

    const retrieved = dlq.get(letter.id);
    assert.ok(retrieved);
    assert.equal(retrieved.id, letter.id);
    assert.equal(retrieved.operation, letter.operation);
  });

  it("returns null for non-existent ID", () => {
    assert.equal(dlq.get("non-existent-id"), null);
  });

  it("lists all dead letters sorted by creation time", () => {
    dlq.add({ operation: "op1", error: new Error("err1"), retries: 1 });
    dlq.add({ operation: "op2", error: new Error("err2"), retries: 2 });
    dlq.add({ operation: "op3", error: new Error("err3"), retries: 3 });

    const all = dlq.list();
    assert.equal(all.length, 3);
  });

  it("filters by status", () => {
    const l1 = dlq.add({ operation: "op1", error: new Error("err1"), retries: 1 });
    dlq.add({ operation: "op2", error: new Error("err2"), retries: 2 });

    dlq.markRetried(l1.id);

    const pending = dlq.list("pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].operation, "op2");

    const retried = dlq.list("retried");
    assert.equal(retried.length, 1);
    assert.equal(retried[0].id, l1.id);
  });

  it("marks a dead letter as retried", () => {
    const letter = dlq.add({ operation: "op1", error: new Error("err1"), retries: 1 });

    const updated = dlq.markRetried(letter.id);
    assert.ok(updated);
    assert.equal(updated.status, "retried");
    assert.ok(updated.retriedAt);

    // Verify persisted
    const retrieved = dlq.get(letter.id);
    assert.equal(retrieved!.status, "retried");
  });

  it("returns null when marking non-existent letter as retried", () => {
    assert.equal(dlq.markRetried("nope"), null);
  });

  it("discards a dead letter", () => {
    const letter = dlq.add({ operation: "op1", error: new Error("err1"), retries: 1 });

    const result = dlq.discard(letter.id);
    assert.ok(result);

    const retrieved = dlq.get(letter.id);
    assert.equal(retrieved!.status, "discarded");
  });

  it("returns false when discarding non-existent letter", () => {
    assert.equal(dlq.discard("nope"), false);
  });

  it("removes a dead letter file entirely", () => {
    const letter = dlq.add({ operation: "op1", error: new Error("err1"), retries: 1 });

    assert.ok(dlq.remove(letter.id));
    assert.equal(dlq.get(letter.id), null);
    assert.equal(dlq.remove(letter.id), false);
  });

  it("returns correct counts", () => {
    const l1 = dlq.add({ operation: "op1", error: new Error("err1"), retries: 1 });
    const l2 = dlq.add({ operation: "op2", error: new Error("err2"), retries: 2 });
    dlq.add({ operation: "op3", error: new Error("err3"), retries: 3 });

    dlq.markRetried(l1.id);
    dlq.discard(l2.id);

    const counts = dlq.counts();
    assert.equal(counts.pending, 1);
    assert.equal(counts.retried, 1);
    assert.equal(counts.discarded, 1);
  });

  it("calls onDeadLetter callback when adding", () => {
    const received: unknown[] = [];
    const dlqWithCallback = new DeadLetterQueue({
      directory: dir,
      onDeadLetter: (letter) => received.push(letter),
    });

    dlqWithCallback.add({ operation: "op1", error: new Error("err1"), retries: 1 });

    assert.equal(received.length, 1);
  });

  it("stores error stack trace", () => {
    const err = new Error("test error");
    const letter = dlq.add({ operation: "op1", error: err, retries: 1 });

    assert.ok(letter.stack);
    assert.match(letter.stack, /Error: test error/);
  });
});
