/**
 * Shared types for the code-implementation subsystem.
 *
 * When the agent decides a ticket is a bug fix or feature request, the
 * `Implementer` takes over: it reads the relevant codebase, asks a coding
 * LLM to plan and produce file edits, applies them, and optionally runs
 * tests — then reports back on the ticket.
 */

// ---------------------------------------------------------------------------
// Codebase configuration
// ---------------------------------------------------------------------------

/**
 * A registered codebase the agent is allowed to work on.
 * Users configure these via CLI flags or a config file.
 */
export interface CodebaseConfig {
  /** Human-readable name, e.g. "frontend", "api-server" */
  name: string;
  /** Absolute path on disk to the repo root */
  path: string;
  /** Glob patterns of files to include in context gathering (default: common source patterns) */
  includePatterns?: string[];
  /** Glob patterns to always exclude (default: node_modules, dist, .git, etc.) */
  excludePatterns?: string[];
  /** Shell command to run tests after applying changes. Empty = skip tests. */
  testCommand?: string;
  /** Branch name prefix for implementation branches (default: "tierzero/") */
  branchPrefix?: string;
  /**
   * Optional mapping from ticket project keys (e.g. "PROJ", "mygroup/myproject")
   * to this codebase. Helps the agent auto-select which codebase to use.
   */
  projectKeys?: string[];
  /** Max total characters of source to send as context to the coding LLM */
  maxContextChars?: number;
}

// ---------------------------------------------------------------------------
// Coding model abstraction
// ---------------------------------------------------------------------------

/** Supported LLM providers for code generation */
export type CodingProvider = "openai" | "anthropic" | "google";

export interface CodingModelConfig {
  provider: CodingProvider;
  /** Model name, e.g. "claude-sonnet-4-20250514", "gpt-4o", "gemini-2.5-pro" */
  model: string;
  /** API key — falls back to env vars if not set */
  apiKey?: string;
  /** Max tokens for the coding response */
  maxTokens?: number;
  /** Temperature for coding (default: 0 for determinism) */
  temperature?: number;
}

/** A message in the coding conversation */
export interface CodingMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Abstract interface for a coding LLM provider.
 * Each provider (OpenAI, Anthropic, Google) implements this.
 */
export interface CodingModel {
  readonly provider: CodingProvider;
  readonly modelName: string;
  /**
   * Send a conversation to the LLM and get back a text response.
   * The response should contain the structured edit plan.
   */
  chat(messages: CodingMessage[]): Promise<string>;
}

// ---------------------------------------------------------------------------
// File edits
// ---------------------------------------------------------------------------

/** A single file operation the LLM wants to perform */
export type FileEdit =
  | { action: "create"; path: string; content: string }
  | { action: "modify"; path: string; content: string }
  | { action: "delete"; path: string };

/** The structured plan returned by the coding LLM */
export interface ImplementationPlan {
  /** High-level summary of what will change and why */
  summary: string;
  /** Ordered list of file operations */
  edits: FileEdit[];
  /** Files the LLM read to inform the plan */
  filesRead: string[];
}

// ---------------------------------------------------------------------------
// Implementation result
// ---------------------------------------------------------------------------

export interface ImplementationResult {
  /** Whether the implementation succeeded end-to-end */
  success: boolean;
  /** What the agent did, in plain English */
  summary: string;
  /** Files created or modified */
  filesChanged: string[];
  /** Files deleted */
  filesDeleted: string[];
  /** Git branch name if a branch was created */
  branch?: string;
  /** Git commit hash if changes were committed */
  commitHash?: string;
  /** Test output if tests were run */
  testOutput?: string;
  /** Whether tests passed (undefined if not run) */
  testsPassed?: boolean;
  /** Error details if something failed */
  error?: string;
  /** Duration of the implementation step */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// File context entry (what we send to the LLM)
// ---------------------------------------------------------------------------

export interface FileContextEntry {
  /** Relative path from the codebase root */
  relativePath: string;
  /** Full file content */
  content: string;
  /** File size in bytes */
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Default patterns
// ---------------------------------------------------------------------------

export const DEFAULT_INCLUDE_PATTERNS = [
  "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
  "**/*.py", "**/*.rb", "**/*.go", "**/*.rs",
  "**/*.java", "**/*.kt", "**/*.cs",
  "**/*.css", "**/*.scss", "**/*.html", "**/*.vue", "**/*.svelte",
  "**/*.json", "**/*.yaml", "**/*.yml", "**/*.toml",
  "**/*.md", "**/*.txt",
  "**/*.sql", "**/*.sh", "**/*.bash",
  "**/Dockerfile", "**/docker-compose.yml",
];

export const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**",
  "**/vendor/**", "**/__pycache__/**", "**/.venv/**", "**/venv/**",
  "**/target/**", "**/bin/**", "**/obj/**",
  "**/*.min.js", "**/*.min.css", "**/*.map",
  "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml",
  "**/.env", "**/.env.*",
];

// ---------------------------------------------------------------------------
// Provider env var defaults
// ---------------------------------------------------------------------------

export const PROVIDER_ENV_KEYS: Record<CodingProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};
