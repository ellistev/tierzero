/**
 * TierZero Skill System Types.
 * 
 * Skills are hot-loadable modules that provide capabilities to the agent.
 * Each skill lives in a folder with a skill.json manifest and an index.ts entry point.
 * 
 * Skills can be:
 * - Bundled (shipped in skills/ directory, committed to repo)
 * - Demo-specific (in demos/<client>/skills/, gitignored)
 * - External (installed via npm, or connected via MCP)
 */

export interface SkillManifest {
  /** Unique skill identifier */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description: string;
  /** Capabilities this skill provides (used for matching) */
  capabilities: string[];
  /** Configuration schema - keys injected from demo config */
  config?: Record<string, SkillConfigField>;
  /** MCP tools this skill exposes when running as MCP server */
  mcpTools?: string[];
  /** Other skills this skill depends on */
  dependencies?: string[];
  /** Entry point file (default: index.ts) */
  entry?: string;
}

export interface SkillConfigField {
  type: "string" | "number" | "boolean" | "string[]";
  required?: boolean;
  description?: string;
  default?: unknown;
  /** Reference to env var: "${ENV_VAR_NAME}" */
  env?: string;
}

/**
 * Runtime configuration passed to a skill on initialization.
 * Values come from the demo's config.yaml merged with env vars.
 */
export type SkillConfig = Record<string, unknown>;

/**
 * A loaded skill instance.
 * Skills must export a default function or class matching this interface.
 */
export interface SkillProvider {
  /** Skill manifest (from skill.json) */
  readonly manifest: SkillManifest;

  /**
   * Initialize the skill with runtime config.
   * Called once when the skill is loaded.
   */
  initialize(config: SkillConfig): Promise<void>;

  /**
   * Get a named capability/tool from this skill.
   * Returns a callable function or null if not provided.
   */
  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null;

  /**
   * List all available capabilities.
   */
  listCapabilities(): string[];

  /**
   * Clean up resources when skill is unloaded.
   */
  dispose?(): Promise<void>;
}

/**
 * Factory function that a skill's entry point must export as default.
 * The loader calls this to create the SkillProvider.
 */
export type SkillFactory = (manifest: SkillManifest) => SkillProvider;
