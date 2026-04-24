import { ChromaKnowledgeStore } from "./chroma-store";
import { InMemoryKnowledgeStore } from "./in-memory-store";
import type { KnowledgeStore } from "./store";

export interface KnowledgeStoreConfig {
  enabled?: boolean;
  backend?: "memory" | "chroma";
  chroma?: {
    collectionName?: string;
    chromaUrl?: string;
    openAIApiKey?: string;
  };
}

export async function createKnowledgeStore(
  config: KnowledgeStoreConfig = {},
): Promise<KnowledgeStore | undefined> {
  if (config.enabled === false) return undefined;

  const backend = config.backend ?? "memory";

  switch (backend) {
    case "memory":
      return new InMemoryKnowledgeStore();

    case "chroma":
      return new ChromaKnowledgeStore({
        collectionName: config.chroma?.collectionName,
        chromaUrl: config.chroma?.chromaUrl,
        openAIApiKey: config.chroma?.openAIApiKey,
      });

    default: {
      const exhaustive: never = backend;
      throw new Error(`Unsupported knowledge backend: ${exhaustive}`);
    }
  }
}
