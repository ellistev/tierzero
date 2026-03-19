/**
 * Knowledge Store interfaces.
 *
 * Defines the contract for storing and retrieving knowledge entries
 * that agents accumulate across tasks.
 */

export interface KnowledgeEntry {
  id: string;
  type: "solution" | "pattern" | "error" | "decision" | "context";
  title: string;
  content: string;
  source: {
    taskId: string;
    agentName: string;
    timestamp: string;
  };
  tags: string[];
  relatedFiles: string[];
  embedding?: number[];
  confidence: number;
  usageCount: number;
  lastUsedAt: string | null;
  supersededBy: string | null;
  createdAt: string;
}

export interface SearchOptions {
  limit?: number;
  minConfidence?: number;
  types?: KnowledgeEntry["type"][];
  tags?: string[];
  maxAge?: number;
}

export interface KnowledgeStats {
  totalEntries: number;
  byType: Record<string, number>;
  mostUsed: KnowledgeEntry[];
  recentlyAdded: KnowledgeEntry[];
  averageConfidence: number;
}

export interface KnowledgeStore {
  add(
    entry: Omit<KnowledgeEntry, "id" | "embedding" | "usageCount" | "lastUsedAt" | "createdAt">
  ): Promise<string>;

  search(query: string, options?: SearchOptions): Promise<KnowledgeEntry[]>;

  findByTags(tags: string[], matchAll?: boolean): Promise<KnowledgeEntry[]>;

  findByFiles(filePaths: string[]): Promise<KnowledgeEntry[]>;

  get(id: string): Promise<KnowledgeEntry | null>;

  recordUsage(id: string): Promise<void>;

  supersede(oldId: string, newId: string): Promise<void>;

  stats(): Promise<KnowledgeStats>;
}
