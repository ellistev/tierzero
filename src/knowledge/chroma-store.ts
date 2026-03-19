/**
 * ChromaDB-backed KnowledgeStore implementation.
 *
 * Uses OpenAI text-embedding-3-small for vector search via ChromaDB.
 * Collection: tierzero-knowledge
 */

import { randomUUID } from "node:crypto";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import type { Document } from "@langchain/core/documents";
import type { Where } from "chromadb";
import type { KnowledgeEntry, KnowledgeStore, KnowledgeStats, SearchOptions } from "./store";

export interface ChromaKnowledgeStoreConfig {
  collectionName?: string;
  chromaUrl?: string;
  openAIApiKey?: string;
}

/**
 * Metadata stored alongside each document in ChromaDB.
 * ChromaDB metadata values must be string | number | boolean.
 */
interface ChromaMetadata {
  entryId: string;
  type: string;
  title: string;
  tags: string;            // JSON-encoded string[]
  relatedFiles: string;    // JSON-encoded string[]
  confidence: number;
  usageCount: number;
  lastUsedAt: string;      // "" if null
  supersededBy: string;    // "" if null
  createdAt: string;
  taskId: string;
  agentName: string;
  sourceTimestamp: string;
}

export class ChromaKnowledgeStore implements KnowledgeStore {
  private readonly collectionName: string;
  private readonly chromaUrl: string;
  private readonly openAIApiKey: string;
  private vectorStore: Chroma | null = null;

  constructor(config: ChromaKnowledgeStoreConfig = {}) {
    this.collectionName = config.collectionName ?? "tierzero-knowledge";
    this.chromaUrl = config.chromaUrl ?? "http://localhost:8000";
    this.openAIApiKey = config.openAIApiKey ?? process.env.OPENAI_API_KEY ?? "";
  }

  private async getVectorStore(): Promise<Chroma> {
    if (this.vectorStore) return this.vectorStore;

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: this.openAIApiKey,
      modelName: "text-embedding-3-small",
    });

    this.vectorStore = new Chroma(embeddings, {
      collectionName: this.collectionName,
      url: this.chromaUrl,
    });

    await this.vectorStore.ensureCollection();
    return this.vectorStore;
  }

  async add(
    entry: Omit<KnowledgeEntry, "id" | "embedding" | "usageCount" | "lastUsedAt" | "createdAt">
  ): Promise<string> {
    const store = await this.getVectorStore();
    const id = randomUUID();
    const now = new Date().toISOString();

    const metadata: ChromaMetadata = {
      entryId: id,
      type: entry.type,
      title: entry.title,
      tags: JSON.stringify(entry.tags),
      relatedFiles: JSON.stringify(entry.relatedFiles),
      confidence: entry.confidence,
      usageCount: 0,
      lastUsedAt: "",
      supersededBy: "",
      createdAt: now,
      taskId: entry.source.taskId,
      agentName: entry.source.agentName,
      sourceTimestamp: entry.source.timestamp,
    };

    // Store content as the document text (what gets embedded)
    const searchableText = `${entry.title}\n\n${entry.content}`;
    await store.addDocuments([
      { pageContent: searchableText, metadata: metadata as unknown as Record<string, unknown> },
    ], { ids: [id] });

    return id;
  }

  async search(query: string, options: SearchOptions = {}): Promise<KnowledgeEntry[]> {
    const store = await this.getVectorStore();
    const limit = options.limit ?? 5;
    const minConfidence = options.minConfidence ?? 0.5;

    const where = this.buildWhereClause(options);

    const raw: [Document, number][] = await store.similaritySearchWithScore(
      query, limit * 2, where  // fetch extra to allow filtering
    );

    return raw
      .map(([doc]) => this.docToEntry(doc))
      .filter((e) => e.confidence >= minConfidence)
      .filter((e) => e.supersededBy === null)
      .filter((e) => {
        if (options.maxAge === undefined) return true;
        const cutoff = Date.now() - options.maxAge * 24 * 60 * 60 * 1000;
        return new Date(e.createdAt).getTime() >= cutoff;
      })
      .slice(0, limit);
  }

  async findByTags(tags: string[], matchAll = false): Promise<KnowledgeEntry[]> {
    const store = await this.getVectorStore();
    // ChromaDB doesn't support array contains well, so fetch broadly and filter
    const docs = await store.similaritySearch("", 100);
    return docs
      .map((d) => this.docToEntry(d))
      .filter((e) => e.supersededBy === null)
      .filter((e) =>
        matchAll
          ? tags.every((t) => e.tags.includes(t))
          : tags.some((t) => e.tags.includes(t))
      );
  }

  async findByFiles(filePaths: string[]): Promise<KnowledgeEntry[]> {
    const store = await this.getVectorStore();
    const docs = await store.similaritySearch("", 100);
    return docs
      .map((d) => this.docToEntry(d))
      .filter((e) => e.supersededBy === null)
      .filter((e) => e.relatedFiles.some((f) => filePaths.includes(f)));
  }

  async get(id: string): Promise<KnowledgeEntry | null> {
    const store = await this.getVectorStore();
    const where: Where = { entryId: { $eq: id } };
    const docs = await store.similaritySearch("", 1, where);
    if (docs.length === 0) return null;
    return this.docToEntry(docs[0]);
  }

  async recordUsage(id: string): Promise<void> {
    // ChromaDB doesn't support in-place metadata updates easily through LangChain.
    // For production use, maintain a sidecar store or use ChromaDB client directly.
    // This is a best-effort approach.
    const entry = await this.get(id);
    if (!entry) return;
    // Note: full update would require delete + re-add with updated metadata
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const entry = await this.get(oldId);
    if (!entry) return;
    // Note: full update would require delete + re-add with updated metadata
  }

  async stats(): Promise<KnowledgeStats> {
    const store = await this.getVectorStore();
    const docs = await store.similaritySearch("", 1000);
    const all = docs.map((d) => this.docToEntry(d));
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

  private buildWhereClause(options: SearchOptions): Where | undefined {
    const clauses: Where[] = [];

    if (options.types && options.types.length > 0) {
      if (options.types.length === 1) {
        clauses.push({ type: { $eq: options.types[0] } });
      } else {
        clauses.push({ type: { $in: options.types } });
      }
    }

    clauses.push({ supersededBy: { $eq: "" } });

    if (clauses.length === 0) return undefined;
    if (clauses.length === 1) return clauses[0];
    return { $and: clauses };
  }

  private docToEntry(doc: Document): KnowledgeEntry {
    const m = doc.metadata as unknown as ChromaMetadata;
    const tags: string[] = this.parseJsonArray(m.tags);
    const relatedFiles: string[] = this.parseJsonArray(m.relatedFiles);

    // Content is stored as "title\n\ncontent" - extract content portion
    const fullText = doc.pageContent;
    const titleEnd = fullText.indexOf("\n\n");
    const content = titleEnd >= 0 ? fullText.slice(titleEnd + 2) : fullText;

    return {
      id: m.entryId,
      type: m.type as KnowledgeEntry["type"],
      title: m.title,
      content,
      source: {
        taskId: m.taskId,
        agentName: m.agentName,
        timestamp: m.sourceTimestamp,
      },
      tags,
      relatedFiles,
      confidence: m.confidence,
      usageCount: m.usageCount,
      lastUsedAt: m.lastUsedAt || null,
      supersededBy: m.supersededBy || null,
      createdAt: m.createdAt,
    };
  }

  private parseJsonArray(val: string): string[] {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
