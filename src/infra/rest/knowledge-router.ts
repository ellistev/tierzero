/**
 * REST API for the Knowledge Store.
 *
 * Endpoints:
 *   GET  /api/knowledge          - list entries (query: type, tags, limit)
 *   GET  /api/knowledge/search   - semantic search (?q=...)
 *   GET  /api/knowledge/stats    - usage statistics
 *   GET  /api/knowledge/:id      - single entry
 *   POST /api/knowledge          - manually add knowledge entry
 */

import { Router } from "express";
import type { KnowledgeStore } from "../../knowledge/store";

export interface KnowledgeRouterDeps {
  store: KnowledgeStore;
}

export function knowledgeRouter(deps: KnowledgeRouterDeps): Router {
  const { store } = deps;
  const api = Router();

  // GET /api/knowledge - list/filter entries
  api.get("/api/knowledge", async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const tagsParam = req.query.tags as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()) : undefined;

      if (tags && tags.length > 0) {
        const results = await store.findByTags(tags);
        const filtered = type ? results.filter((e) => e.type === type) : results;
        const limited = limit ? filtered.slice(0, limit) : filtered;
        res.json(limited);
      } else if (type) {
        const results = await store.search("", { types: [type as "solution"], limit: limit ?? 50 });
        res.json(results);
      } else {
        const stats = await store.stats();
        res.json(stats.recentlyAdded.slice(0, limit ?? 50));
      }
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // GET /api/knowledge/search - semantic search
  api.get("/api/knowledge/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q) {
        res.status(400).json({ message: "q query parameter is required" });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const results = await store.search(q, { limit });
      res.json(results);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // GET /api/knowledge/stats - usage statistics
  api.get("/api/knowledge/stats", async (_req, res) => {
    try {
      const stats = await store.stats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // GET /api/knowledge/:id - single entry
  api.get("/api/knowledge/:id", async (req, res) => {
    try {
      const entry = await store.get(req.params.id);
      if (!entry) {
        res.status(404).json({ message: "Knowledge entry not found" });
        return;
      }
      res.json(entry);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  // POST /api/knowledge - manually add entry
  api.post("/api/knowledge", async (req, res) => {
    try {
      const body = req.body ?? {};

      if (!body.title || !body.content || !body.type) {
        res.status(400).json({ message: "title, content, and type are required" });
        return;
      }

      const id = await store.add({
        type: body.type,
        title: body.title,
        content: body.content,
        source: body.source ?? { taskId: "manual", agentName: "user", timestamp: new Date().toISOString() },
        tags: body.tags ?? [],
        relatedFiles: body.relatedFiles ?? [],
        confidence: body.confidence ?? 0.8,
        supersededBy: null,
      });

      const entry = await store.get(id);
      res.status(201).json(entry);
    } catch (err) {
      res.status(500).json({ message: (err as Error).message });
    }
  });

  return api;
}
