import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

import { RecursiveCharacterTextSplitter, MarkdownTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Chroma } from "@langchain/community/vectorstores/chroma";
// PDFLoader requires: npm install pdf-parse
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import type { Document } from "@langchain/core/documents";
import type { Where } from "chromadb";
import { htmlToMarkdown } from "../ingest/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileType = "markdown" | "text" | "json" | "pdf" | "csv" | "yaml" | "html" | "xml";

export interface IndexerConfig {
  /** Absolute path to the folder of documents to index */
  knowledgeDir: string;
  /** ChromaDB collection name. Default: "knowledge" */
  collectionName?: string;
  /** ChromaDB server URL. Default: http://localhost:8000 */
  chromaUrl?: string;
  /** Falls back to process.env.OPENAI_API_KEY */
  openAIApiKey?: string;
  /** Characters per chunk. Default: 1000 */
  chunkSize?: number;
  /** Overlap between adjacent chunks. Default: 200 */
  chunkOverlap?: number;
}

/** Metadata stored alongside every chunk in ChromaDB */
export interface ChunkMetadata {
  source: string;       // relative path from knowledgeDir, e.g. "runbooks/restart.md"
  filename: string;     // basename, e.g. "restart.md"
  fileType: FileType;
  chunkIndex: number;   // 0-based position within the source file
  totalChunks: number;
  contentHash: string;  // SHA-256 of raw file bytes; used for change detection
  indexedAt: string;    // ISO-8601
}

export interface IndexResult {
  filesProcessed: number;
  filesSkipped: number;  // unchanged since last run
  chunksAdded: number;
  chunksDeleted: number; // from files that were re-indexed
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

// Sidecar persisted to knowledge/.index-state.json
interface FileIndexEntry {
  hash: string;
  chunkCount: number;
  indexedAt: string;
}
type IndexState = Record<string, FileIndexEntry>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXT_TO_TYPE: Record<string, FileType> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".text": "text",
  ".json": "json",
  ".pdf": "pdf",
  ".csv": "csv",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
};

const STATE_FILENAME = ".index-state.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

interface ScannedFile {
  absPath: string;
  relPath: string;
  fileType: FileType;
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip hidden
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadMarkdownOrText(absPath: string): Promise<Document[]> {
  // TextLoader/JSONLoader moved out of @langchain/community in v1.x -- read directly
  const content = await fs.readFile(absPath, "utf-8");
  return [{ pageContent: content, metadata: { source: absPath } }];
}

async function loadJson(absPath: string): Promise<Document[]> {
  // JSONLoader extracts string leaf values by default, which loses structure.
  // Pretty-printing the whole file gives the LLM readable key:value context.
  const raw = await fs.readFile(absPath, "utf-8");
  const parsed = JSON.parse(raw);
  const content = JSON.stringify(parsed, null, 2);
  return [{ pageContent: content, metadata: { source: absPath } }];
}

async function loadPdf(absPath: string): Promise<Document[]> {
  // PDFLoader splits by page by default -- each page becomes one Document.
  const loader = new PDFLoader(absPath, { splitPages: true });
  return loader.load();
}

async function loadHtml(absPath: string): Promise<Document[]> {
  const raw = await fs.readFile(absPath, "utf-8");
  const content = htmlToMarkdown(raw);
  return [{ pageContent: content, metadata: { source: absPath } }];
}

async function loadFile(absPath: string, fileType: FileType): Promise<Document[]> {
  switch (fileType) {
    case "markdown": return loadMarkdownOrText(absPath);
    case "text":     return loadMarkdownOrText(absPath);
    case "json":     return loadJson(absPath);
    case "pdf":      return loadPdf(absPath);
    case "csv":      return loadMarkdownOrText(absPath);
    case "yaml":     return loadMarkdownOrText(absPath);
    case "html":     return loadHtml(absPath);
    case "xml":      return loadMarkdownOrText(absPath);
  }
}

// ---------------------------------------------------------------------------
// Splitters
// ---------------------------------------------------------------------------

function makeSplitter(fileType: FileType, chunkSize: number, chunkOverlap: number) {
  if (fileType === "markdown" || fileType === "html") {
    // MarkdownTextSplitter respects headers as natural split boundaries
    // HTML is converted to markdown before splitting
    return new MarkdownTextSplitter({ chunkSize, chunkOverlap });
  }
  if (fileType === "yaml") {
    // Split on YAML document boundaries first, then blank lines
    return new RecursiveCharacterTextSplitter({
      chunkSize, chunkOverlap,
      separators: ["\n---\n", "\n\n", "\n", " ", ""],
    });
  }
  if (fileType === "xml") {
    // Split between closing/opening tags to avoid mid-element breaks
    return new RecursiveCharacterTextSplitter({
      chunkSize, chunkOverlap,
      separators: [">\n<", ">\n", "\n\n", "\n", " ", ""],
    });
  }
  return new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
}

// ---------------------------------------------------------------------------
// KnowledgeIndexer
// ---------------------------------------------------------------------------

export class KnowledgeIndexer {
  private readonly config: Required<IndexerConfig>;
  private vectorStore: Chroma | null = null;

  constructor(config: IndexerConfig) {
    this.config = {
      collectionName: "knowledge",
      chromaUrl: "http://localhost:8000",
      openAIApiKey: process.env.OPENAI_API_KEY ?? "",
      chunkSize: 1000,
      chunkOverlap: 200,
      ...config,
    };
  }

  // Lazy-initialise the vector store so the constructor stays synchronous
  private async getVectorStore(): Promise<Chroma> {
    if (this.vectorStore) return this.vectorStore;

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: this.config.openAIApiKey,
      modelName: "text-embedding-3-small",
    });

    this.vectorStore = new Chroma(embeddings, {
      collectionName: this.config.collectionName,
      url: this.config.chromaUrl,
    });

    await this.vectorStore.ensureCollection();

    return this.vectorStore;
  }

  // ---------------------------------------------------------------------------
  // Scan
  // ---------------------------------------------------------------------------

  private async scanFiles(): Promise<ScannedFile[]> {
    let allPaths: string[];
    try {
      allPaths = await walkDir(this.config.knowledgeDir);
    } catch {
      return []; // knowledge dir doesn't exist yet
    }

    const results: ScannedFile[] = [];
    for (const absPath of allPaths) {
      const ext = path.extname(absPath).toLowerCase();
      const fileType = EXT_TO_TYPE[ext];
      if (!fileType) continue;

      // Skip the state sidecar itself
      if (path.basename(absPath) === STATE_FILENAME) continue;

      const relPath = path.relative(this.config.knowledgeDir, absPath).replace(/\\/g, "/");
      results.push({ absPath, relPath, fileType });
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // State sidecar
  // ---------------------------------------------------------------------------

  private statePath(): string {
    return path.join(this.config.knowledgeDir, STATE_FILENAME);
  }

  private async loadState(): Promise<IndexState> {
    try {
      const raw = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(raw) as IndexState;
    } catch {
      return {};
    }
  }

  private async saveState(state: IndexState): Promise<void> {
    await fs.mkdir(this.config.knowledgeDir, { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2), "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Walk knowledgeDir, chunk, embed, and upsert into ChromaDB.
   * Skips files whose content hash hasn't changed unless `force` is true.
   */
  async index(options: { force?: boolean } = {}): Promise<IndexResult> {
    const start = Date.now();
    const result: IndexResult = {
      filesProcessed: 0,
      filesSkipped: 0,
      chunksAdded: 0,
      chunksDeleted: 0,
      errors: [],
      durationMs: 0,
    };

    const store = await this.getVectorStore();
    const state = options.force ? {} : await this.loadState();
    const files = await this.scanFiles();

    for (const { absPath, relPath, fileType } of files) {
      try {
        const raw = await fs.readFile(absPath);
        const hash = sha256(raw);

        // Skip if unchanged
        if (!options.force && state[relPath]?.hash === hash) {
          result.filesSkipped++;
          continue;
        }

        // Delete stale chunks for this source before re-adding
        if (state[relPath]) {
          await store.delete({ filter: { source: { $eq: relPath } } as Where });
          result.chunksDeleted += state[relPath].chunkCount;
        }

        // Load -> split -> enrich metadata -> upsert
        const docs = await loadFile(absPath, fileType);
        const splitter = makeSplitter(fileType, this.config.chunkSize, this.config.chunkOverlap);
        const chunks = await splitter.splitDocuments(docs);

        const indexedAt = new Date().toISOString();
        const enriched: Document[] = chunks.map((chunk, i) => ({
          pageContent: chunk.pageContent,
          metadata: {
            ...chunk.metadata,
            source: relPath,
            filename: path.basename(relPath),
            fileType,
            chunkIndex: i,
            totalChunks: chunks.length,
            contentHash: hash,
            indexedAt,
          } satisfies ChunkMetadata,
        }));

        await store.addDocuments(enriched);

        state[relPath] = { hash, chunkCount: chunks.length, indexedAt };
        result.filesProcessed++;
        result.chunksAdded += chunks.length;

        console.log(`  [+] ${relPath} -> ${chunks.length} chunks`);
      } catch (err) {
        console.error(`  [!] ${relPath}: ${err}`);
        result.errors.push({ file: relPath, error: String(err) });
      }
    }

    await this.saveState(state);
    result.durationMs = Date.now() - start;
    return result;
  }

  /** Remove ALL documents from the collection and wipe the state sidecar */
  async clear(): Promise<void> {
    const store = await this.getVectorStore();
    // Fetch all stored IDs then delete in one shot.
    // ChromaDB v3 doesn't support a filter-free delete-all, so we get IDs first.
    const collection = await store.ensureCollection();
    const existing = await collection.get({ include: [] });
    if (existing.ids.length > 0) {
      await collection.delete({ ids: existing.ids });
    }
    await fs.rm(this.statePath(), { force: true });
    console.log(`Cleared collection "${this.config.collectionName}" (${existing.ids.length} chunks removed)`);
  }

  /** Summary of what's currently in the index */
  async stats(): Promise<{ totalChunks: number; sources: string[] }> {
    const state = await this.loadState();
    const sources = Object.keys(state);
    const totalChunks = sources.reduce((sum, k) => sum + state[k].chunkCount, 0);
    return { totalChunks, sources };
  }
}
