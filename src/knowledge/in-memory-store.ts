/**
 * In-memory KnowledgeStore implementation for testing.
 * No ChromaDB dependency - uses simple string matching for search.
 */

import { randomUUID } from "node:crypto";
import { isScopeCompatible, normalizeKnowledgeScope, scoreScopeMatch } from "./scope";
import type { KnowledgeEntry, KnowledgeStore, KnowledgeStats, SearchOptions } from "./store";

export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly entries = new Map<string, KnowledgeEntry>();

  async add(
    entry: Omit<KnowledgeEntry, "id" | "embedding" | "usageCount" | "lastUsedAt" | "createdAt">
  ): Promise<string> {
    const id = randomUUID();
    const full: KnowledgeEntry = {
      ...entry,
      id,
      scope: normalizeKnowledgeScope(entry.scope),
      usageCount: 0,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.entries.set(id, full);
    return id;
  }

  async search(query: string, options: SearchOptions = {}): Promise<KnowledgeEntry[]> {
    const limit = options.limit ?? 5;
    const minConfidence = options.minConfidence ?? 0.5;
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);

    let results = Array.from(this.entries.values())
      .filter((e) => e.supersededBy === null)
      .filter((e) => e.confidence >= minConfidence)
      .filter((e) => isScopeCompatible(e.scope, options.scope));

    if (options.types && options.types.length > 0) {
      results = results.filter((e) => options.types!.includes(e.type));
    }

    if (options.tags && options.tags.length > 0) {
      results = results.filter((e) => options.tags!.some((t) => e.tags.includes(t)));
    }

    if (options.maxAge !== undefined) {
      const cutoff = Date.now() - options.maxAge * 24 * 60 * 60 * 1000;
      results = results.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
    }

    // Score by term overlap in title + content + tags
    const scored = results.map((e) => {
      const haystack = `${e.title} ${e.content} ${e.tags.join(" ")}`.toLowerCase();
      const matchCount = queryTerms.filter((t) => haystack.includes(t)).length;
      return {
        entry: e,
        queryScore: queryTerms.length > 0 ? matchCount / queryTerms.length : 0,
        scopeScore: scoreScopeMatch(e.scope, options.scope),
      };
    });

    return scored
      .filter((s) => s.queryScore > 0)
      .sort(
        (a, b) =>
          b.scopeScore - a.scopeScore ||
          b.queryScore - a.queryScore ||
          b.entry.usageCount - a.entry.usageCount,
      )
      .slice(0, limit)
      .map((s) => s.entry);
  }

  async findByTags(tags: string[], matchAll = false): Promise<KnowledgeEntry[]> {
    return Array.from(this.entries.values()).filter((e) => {
      if (e.supersededBy !== null) return false;
      return matchAll
        ? tags.every((t) => e.tags.includes(t))
        : tags.some((t) => e.tags.includes(t));
    });
  }

  async findByFiles(filePaths: string[]): Promise<KnowledgeEntry[]> {
    return Array.from(this.entries.values()).filter((e) => {
      if (e.supersededBy !== null) return false;
      return e.relatedFiles.some((f) => filePaths.includes(f));
    });
  }

  async get(id: string): Promise<KnowledgeEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async recordUsage(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.usageCount += 1;
    entry.lastUsedAt = new Date().toISOString();
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const old = this.entries.get(oldId);
    if (!old) return;
    old.supersededBy = newId;
  }

  async stats(): Promise<KnowledgeStats> {
    const all = Array.from(this.entries.values());
    const active = all.filter((e) => e.supersededBy === null);

    const byType: Record<string, number> = {};
    for (const e of active) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }

    const mostUsed = [...active]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);

    const recentlyAdded = [...active]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);

    const totalConfidence = active.reduce((sum, e) => sum + e.confidence, 0);

    return {
      totalEntries: active.length,
      byType,
      mostUsed,
      recentlyAdded,
      averageConfidence: active.length > 0 ? totalConfidence / active.length : 0,
    };
  }
}
