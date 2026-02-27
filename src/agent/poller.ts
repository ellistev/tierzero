/**
 * TicketPoller: continuous polling loop that feeds open tickets into the agent.
 *
 * Design goals:
 *  - Single poll() method that is safe to call in unit tests without timers.
 *  - start(intervalMs) wires it into setInterval for production use.
 *  - processedIds set is shared across poll cycles so tickets are never re-run.
 *  - batchSize caps per-cycle work so a large backlog doesn't block the interval.
 */

import type { TicketConnector } from "../connectors/connector";
import type { Ticket } from "../connectors/types";
import type { AgentGraph, AgentState } from "./agent";

export interface PollResult {
  ticketsFound: number;
  ticketsProcessed: number;
  errors: Array<{ ticketId: string; error: string }>;
}

export interface PollerOptions {
  connector: TicketConnector;
  agent: AgentGraph;
  /**
   * Shared set of already-processed ticket IDs.
   * Injected here so callers can inspect or pre-seed it; defaults to an empty set.
   */
  processedIds?: Set<string>;
  /**
   * Max tickets to process per poll cycle. 0 = unlimited. Default: 0.
   * Useful to throttle work when a large backlog exists.
   */
  batchSize?: number;
  /** Called just before the agent is invoked for a ticket. */
  onTicketStart?: (ticket: Ticket) => void;
  /** Called after the agent successfully finishes a ticket. */
  onTicketDone?: (ticket: Ticket, state: AgentState) => void;
  /** Called when the agent throws for a ticket (ticket stays in processedIds). */
  onTicketError?: (ticket: Ticket, error: unknown) => void;
  /** Called after every poll cycle with a summary. */
  onCycleDone?: (result: PollResult) => void;
}

export class TicketPoller {
  private readonly processedIds: Set<string>;
  private readonly batchSize: number;
  private readonly connector: TicketConnector;
  private readonly agent: AgentGraph;
  private readonly onTicketStart: (ticket: Ticket) => void;
  private readonly onTicketDone: (ticket: Ticket, state: AgentState) => void;
  private readonly onTicketError: (ticket: Ticket, error: unknown) => void;
  private readonly onCycleDone: (result: PollResult) => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: PollerOptions) {
    this.connector = options.connector;
    this.agent = options.agent;
    this.processedIds = options.processedIds ?? new Set();
    this.batchSize = options.batchSize ?? 0;
    this.onTicketStart = options.onTicketStart ?? (() => {});
    this.onTicketDone = options.onTicketDone ?? (() => {});
    this.onTicketError = options.onTicketError ?? (() => {});
    this.onCycleDone = options.onCycleDone ?? (() => {});
  }

  /**
   * Run a single poll cycle.
   * - Fetches open tickets from the connector.
   * - Skips tickets already in processedIds.
   * - Marks each ticket as processed *before* running the agent (re-entry guard).
   * - Returns a PollResult summary.
   */
  async poll(): Promise<PollResult> {
    const result: PollResult = { ticketsFound: 0, ticketsProcessed: 0, errors: [] };

    const { tickets } = await this.connector.listTickets({ status: "open" });
    const fresh = tickets.filter(t => !this.processedIds.has(t.id));
    const batch = this.batchSize > 0 ? fresh.slice(0, this.batchSize) : fresh;

    result.ticketsFound = fresh.length;

    for (const ticket of batch) {
      // Mark before running so a thrown error doesn't re-queue the ticket
      this.processedIds.add(ticket.id);
      this.onTicketStart(ticket);

      try {
        const state = await this.agent.run(ticket);
        result.ticketsProcessed++;
        this.onTicketDone(ticket, state);
      } catch (err) {
        result.errors.push({ ticketId: ticket.id, error: String(err) });
        this.onTicketError(ticket, err);
      }
    }

    this.onCycleDone(result);
    return result;
  }

  /**
   * Start polling on a fixed interval. Runs an immediate first cycle, then
   * repeats every intervalMs milliseconds.
   * Returns a stop function (equivalent to calling stop()).
   */
  start(intervalMs: number): () => void {
    // Fire immediately, then on interval
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalMs);
    return () => this.stop();
  }

  /** Cancel the polling interval. Safe to call multiple times. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** Read-only view of the processed IDs set. */
  get processed(): ReadonlySet<string> {
    return this.processedIds;
  }
}
