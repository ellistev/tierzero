/**
 * Dead Letter Queue.
 *
 * Failed tasks after max retries are persisted to disk for later
 * inspection and manual retry. Each dead letter is a JSON file
 * stored in `.tierzero/dead-letters/`.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "./logger";

const log = createLogger("dead-letter");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadLetter {
  id: string;
  /** Original task or operation identifier */
  taskId?: string;
  /** What operation failed */
  operation: string;
  /** The error that caused the failure */
  error: string;
  /** Error stack trace */
  stack?: string;
  /** Number of retries attempted before giving up */
  retries: number;
  /** Arbitrary context about the failed operation */
  payload: Record<string, unknown>;
  /** When the dead letter was created */
  createdAt: string;
  /** Whether this dead letter has been retried */
  retriedAt?: string;
  /** Status: pending (awaiting retry), retried, or discarded */
  status: "pending" | "retried" | "discarded";
}

export interface DeadLetterQueueOptions {
  /** Directory to store dead letters (default: .tierzero/dead-letters) */
  directory?: string;
  /** Callback when a new dead letter is added (for alerting) */
  onDeadLetter?: (letter: DeadLetter) => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DeadLetterQueue {
  private readonly dir: string;
  private readonly onDeadLetter?: (letter: DeadLetter) => void;

  constructor(options?: DeadLetterQueueOptions) {
    this.dir = options?.directory ?? join(process.cwd(), ".tierzero", "dead-letters");
    this.onDeadLetter = options?.onDeadLetter;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Add a failed task to the dead letter queue */
  add(entry: {
    taskId?: string;
    operation: string;
    error: Error;
    retries: number;
    payload?: Record<string, unknown>;
  }): DeadLetter {
    const letter: DeadLetter = {
      id: randomUUID(),
      taskId: entry.taskId,
      operation: entry.operation,
      error: entry.error.message,
      stack: entry.error.stack,
      retries: entry.retries,
      payload: entry.payload ?? {},
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    const filePath = join(this.dir, `${letter.id}.json`);
    writeFileSync(filePath, JSON.stringify(letter, null, 2), "utf-8");

    log.warn("Dead letter created", {
      id: letter.id,
      operation: letter.operation,
      error: letter.error,
      retries: letter.retries,
    });

    if (this.onDeadLetter) {
      this.onDeadLetter(letter);
    }

    return letter;
  }

  /** Get a dead letter by ID */
  get(id: string): DeadLetter | null {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as DeadLetter;
  }

  /** List all dead letters, optionally filtered by status */
  list(status?: DeadLetter["status"]): DeadLetter[] {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const letters: DeadLetter[] = files.map((f) =>
      JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as DeadLetter
    );

    if (status) {
      return letters.filter((l) => l.status === status);
    }

    // Sort by createdAt descending
    return letters.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Mark a dead letter as retried */
  markRetried(id: string): DeadLetter | null {
    const letter = this.get(id);
    if (!letter) return null;

    letter.status = "retried";
    letter.retriedAt = new Date().toISOString();

    const filePath = join(this.dir, `${id}.json`);
    writeFileSync(filePath, JSON.stringify(letter, null, 2), "utf-8");

    log.info("Dead letter marked as retried", { id });
    return letter;
  }

  /** Discard a dead letter */
  discard(id: string): boolean {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) return false;

    const letter = this.get(id);
    if (letter) {
      letter.status = "discarded";
      writeFileSync(filePath, JSON.stringify(letter, null, 2), "utf-8");
    }

    log.info("Dead letter discarded", { id });
    return true;
  }

  /** Remove a dead letter file entirely */
  remove(id: string): boolean {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }

  /** Count dead letters by status */
  counts(): Record<DeadLetter["status"], number> {
    const all = this.list();
    return {
      pending: all.filter((l) => l.status === "pending").length,
      retried: all.filter((l) => l.status === "retried").length,
      discarded: all.filter((l) => l.status === "discarded").length,
    };
  }
}
