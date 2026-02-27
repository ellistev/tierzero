import { OpenAIEmbeddings } from "@langchain/openai";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import type { Document } from "@langchain/core/documents";
import type { Where } from "chromadb";
import type { ChunkMetadata, FileType } from "./indexer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrieverConfig {
  collectionName?: string;
  chromaUrl?: string;
  openAIApiKey?: string;
  /** Default number of chunks to return. Default: 5 */
  k?: number;
  /**
   * Drop chunks whose similarity score is below this threshold even if K
   * hasn't been reached yet. Range: 0-1 (cosine). Default: 0.5.
   *
   * Lower = more permissive (risk: noise). Higher = stricter (risk: empty results).
   * 0.5 is deliberately conservative -- a missing result is worse than a
   * slightly off-topic one when the caller is an LLM agent.
   */
  scoreThreshold?: number;
}

export interface MetadataFilter {
  /** Only return chunks of these file types */
  fileType?: FileType | FileType[];
  /**
   * Only return chunks whose source path starts with this prefix.
   * e.g. "runbooks/" restricts search to the runbooks folder.
   * Uses ChromaDB's $contains operator -- make the prefix specific enough
   * to avoid false matches on partial folder names.
   */
  sourcePrefix?: string;
  /** Raw ChromaDB where clause -- merged with the above if both are provided */
  where?: Where;
}

export interface SearchOptions {
  /** Override the instance default K for this query */
  k?: number;
  /** Override the instance default score threshold for this query */
  scoreThreshold?: number;
  filter?: MetadataFilter;
  /**
   * Use Maximal Marginal Relevance instead of plain similarity search.
   * MMR penalises chunks that are too similar to already-selected chunks,
   * so you get coverage across different source documents rather than
   * 5 excerpts from the same file.
   *
   * Trade-off: no scores are returned (ChromaDB computes MMR internally).
   * Use when the knowledge base has many similar documents (runbooks, SOPs).
   * Use plain similarity when you want the single most relevant passage fast.
   */
  mmr?: boolean;
  /**
   * MMR lambda -- balances relevance vs diversity.
   * 0.0 = maximise diversity, 1.0 = maximise relevance (equivalent to top-K).
   * Default: 0.5
   */
  mmrLambda?: number;
}

export interface RetrievedChunk {
  content: string;
  /**
   * Cosine similarity score 0-1. Higher = more relevant.
   * Will be NaN for MMR results (Chroma doesn't expose scores for MMR).
   */
  score: number;
  /** Relative path from knowledgeDir, e.g. "runbooks/restart.md" */
  source: string;
  metadata: ChunkMetadata;
}

export interface SearchResult {
  query: string;
  chunks: RetrievedChunk[];
  /** Number of chunks returned by Chroma before score threshold filtering */
  totalFound: number;
  /** Number of chunks after score threshold filtering */
  totalReturned: number;
}

// ---------------------------------------------------------------------------
// Filter compilation
// ---------------------------------------------------------------------------

/**
 * Compile our ergonomic MetadataFilter into a raw ChromaDB where clause.
 * ChromaDB supports: $eq, $ne, $in, $nin, $contains, $not_contains, $and, $or
 */
function compileFilter(filter: MetadataFilter): Where | undefined {
  const clauses: Where[] = [];

  if (filter.fileType) {
    const types = Array.isArray(filter.fileType) ? filter.fileType : [filter.fileType];
    if (types.length === 1) {
      clauses.push({ fileType: { $eq: types[0] } });
    } else {
      clauses.push({ fileType: { $in: types } });
    }
  }

  if (filter.sourcePrefix) {
    // $contains is a substring match -- sourcePrefix should be specific enough
    // (e.g. "runbooks/" rather than just "run") to avoid false matches
    clauses.push({ source: { $contains: filter.sourcePrefix } });
  }

  if (filter.where) {
    clauses.push(filter.where);
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

/** Exposed for unit testing only. */
export const _compileFilter = compileFilter;

// ---------------------------------------------------------------------------
// KnowledgeRetriever
// ---------------------------------------------------------------------------

export class KnowledgeRetriever {
  private readonly config: Required<RetrieverConfig>;
  private vectorStore: Chroma | null = null;

  constructor(config: RetrieverConfig = {}) {
    this.config = {
      collectionName: "knowledge",
      chromaUrl: "http://localhost:8000",
      openAIApiKey: process.env.OPENAI_API_KEY ?? "",
      k: 5,
      scoreThreshold: 0.5,
      ...config,
    };
  }

  private async getVectorStore(): Promise<Chroma> {
    if (this.vectorStore) return this.vectorStore;

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: this.config.openAIApiKey,
      modelName: "text-embedding-3-small",
    });

    // TODO: verify constructor + ensureCollection API against installed version (same note as indexer.ts)
    this.vectorStore = new Chroma(embeddings, {
      collectionName: this.config.collectionName,
      url: this.config.chromaUrl,
    });

    return this.vectorStore;
  }

  // ---------------------------------------------------------------------------
  // Core search
  // ---------------------------------------------------------------------------

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const store = await this.getVectorStore();
    const k = options.k ?? this.config.k;
    const threshold = options.scoreThreshold ?? this.config.scoreThreshold;
    const where = options.filter ? compileFilter(options.filter) : undefined;

    if (options.mmr) {
      return this.mmrSearch(store, query, k, options.mmrLambda ?? 0.5, where);
    }

    // Fetch k results WITH scores so we can apply the threshold
    const raw: [Document, number][] =
      await store.similaritySearchWithScore(query, k, where);

    const totalFound = raw.length;

    const chunks: RetrievedChunk[] = raw
      .filter(([, score]) => score >= threshold)
      .map(([doc, score]) => ({
        content: doc.pageContent,
        score,
        source: (doc.metadata as ChunkMetadata).source ?? "",
        metadata: doc.metadata as ChunkMetadata,
      }));

    return { query, chunks, totalFound, totalReturned: chunks.length };
  }

  private async mmrSearch(
    store: Chroma,
    query: string,
    k: number,
    lambda: number,
    where: Where | undefined
  ): Promise<SearchResult> {
    // Fetch more candidates internally so MMR has room to diversify.
    // fetchK = 4*k is a common heuristic.
    const fetchK = k * 4;

    // maxMarginalRelevanceSearch is optional on VectorStore base class --
    // some adapters (including this version of Chroma) don't implement it.
    // Fall back to regular similarity search if unavailable.
    if (typeof store.maxMarginalRelevanceSearch !== "function") {
      const raw: [Document, number][] = await store.similaritySearchWithScore(query, k, where);
      const chunks: RetrievedChunk[] = raw.map(([doc, score]) => ({
        content: doc.pageContent,
        score,
        source: (doc.metadata as ChunkMetadata).source ?? "",
        metadata: doc.metadata as ChunkMetadata,
      }));
      return { query, chunks, totalFound: raw.length, totalReturned: chunks.length };
    }

    const docs = await store.maxMarginalRelevanceSearch(
      query,
      { k, fetchK, lambda, filter: where },
      undefined
    );

    const chunks: RetrievedChunk[] = docs.map((doc) => ({
      content: doc.pageContent,
      score: NaN, // Chroma doesn't expose per-chunk scores from MMR
      source: (doc.metadata as ChunkMetadata).source ?? "",
      metadata: doc.metadata as ChunkMetadata,
    }));

    return { query, chunks, totalFound: docs.length, totalReturned: chunks.length };
  }

  // ---------------------------------------------------------------------------
  // Convenience wrappers
  // ---------------------------------------------------------------------------

  /** Search restricted to a specific file type (e.g. only runbooks) */
  async searchByType(query: string, fileType: FileType | FileType[], options: Omit<SearchOptions, "filter"> = {}) {
    return this.search(query, { ...options, filter: { fileType } });
  }

  /** Search restricted to a source path prefix (e.g. "runbooks/", "policies/") */
  async searchByFolder(query: string, sourcePrefix: string, options: Omit<SearchOptions, "filter"> = {}) {
    return this.search(query, { ...options, filter: { sourcePrefix } });
  }

  // ---------------------------------------------------------------------------
  // Prompt formatting
  // ---------------------------------------------------------------------------

  /**
   * Format retrieved chunks into a context block ready to paste into an LLM prompt.
   *
   * Output example:
   *   --- runbooks/restart.md (score: 0.87) ---
   *   [chunk content]
   *
   *   --- policies/escalation.md (score: 0.81) ---
   *   [chunk content]
   */
  static formatForPrompt(result: SearchResult): string {
    if (result.chunks.length === 0) {
      return "(No relevant knowledge base entries found.)";
    }

    return result.chunks
      .map((chunk) => {
        const scoreLabel = isNaN(chunk.score) ? "MMR" : `score: ${chunk.score.toFixed(2)}`;
        return `--- ${chunk.source} (${scoreLabel}) ---\n${chunk.content}`;
      })
      .join("\n\n");
  }
}
