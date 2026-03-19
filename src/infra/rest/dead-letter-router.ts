/**
 * Dead Letter Queue REST API.
 *
 * GET    /api/dead-letters           - list all dead letters (optional ?status= filter)
 * GET    /api/dead-letters/:id       - get a specific dead letter
 * POST   /api/dead-letters/:id/retry - mark a dead letter for retry
 * DELETE /api/dead-letters/:id       - discard a dead letter
 */

import { Router } from "express";
import type { DeadLetterQueue } from "../dead-letter";

export interface DeadLetterRouterDeps {
  deadLetterQueue: DeadLetterQueue;
  /** Optional callback invoked when a retry is requested */
  onRetry?: (id: string, letter: unknown) => Promise<void>;
}

export function deadLetterRouter(deps: DeadLetterRouterDeps): Router {
  const { deadLetterQueue, onRetry } = deps;
  const api = Router();

  // GET /api/dead-letters - list dead letters
  api.get("/api/dead-letters", (req, res) => {
    try {
      const status = req.query.status as "pending" | "retried" | "discarded" | undefined;
      const letters = deadLetterQueue.list(status);
      res.json({ items: letters, counts: deadLetterQueue.counts() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/dead-letters/:id - get a specific dead letter
  api.get("/api/dead-letters/:id", (req, res) => {
    try {
      const letter = deadLetterQueue.get(req.params.id);
      if (!letter) {
        res.status(404).json({ error: "Dead letter not found" });
        return;
      }
      res.json(letter);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/dead-letters/:id/retry - mark for retry
  api.post("/api/dead-letters/:id/retry", async (req, res) => {
    try {
      const letter = deadLetterQueue.markRetried(req.params.id);
      if (!letter) {
        res.status(404).json({ error: "Dead letter not found" });
        return;
      }

      if (onRetry) {
        await onRetry(req.params.id, letter);
      }

      res.json({ message: "Dead letter marked for retry", letter });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/dead-letters/:id - discard a dead letter
  api.delete("/api/dead-letters/:id", (req, res) => {
    try {
      const found = deadLetterQueue.discard(req.params.id);
      if (!found) {
        res.status(404).json({ error: "Dead letter not found" });
        return;
      }
      res.json({ message: "Dead letter discarded" });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return api;
}
