/**
 * Init Command.
 *
 * Generates an orchestrator.json config file with sensible defaults.
 * Supports template-based generation (non-interactive) with CLI flags.
 */

import { createLogger } from "../infra/logger";
import { validateConfig, type OrchestratorConfig } from "./config-validator";

const log = createLogger("init");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
const fmt = {
  bold:  (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:   (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:  (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  yellow:(s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitOptions {
  owner?: string;
  repo?: string;
  agent?: string;
  interval?: number;
  output?: string;
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

export function generateConfig(options: InitOptions): OrchestratorConfig {
  const owner = options.owner ?? "your-org";
  const repo = options.repo ?? "your-repo";
  const agentType = options.agent ?? "codex";
  const interval = options.interval ?? 180;

  const config: OrchestratorConfig = {
    adapters: {
      github: {
        owner,
        repo,
        label: "tierzero-agent",
        interval,
        trustedAuthors: [owner],
        requireTrustedAuthor: true,
      },
    },
    agents: {
      "default-agent": {
        type: agentType,
        capabilities: ["code", "research"],
        maxConcurrent: 1,
      },
    },
    scheduler: {
      timezone: "UTC",
      jobs: [],
    },
    knowledge: {
      enabled: false,
      backend: "memory",
      extractor: {
        enabled: true,
        model: "gpt-4o-mini",
      },
    },
    codex: {
      path: "codex",
      model: "gpt-5.4",
      timeoutMs: 900_000,
    },
    apiPort: 3500,
    maxConcurrent: 3,
    taskTimeoutMs: 900_000,
    prReview: {
      enabled: true,
      minScore: 70,
      maxErrors: 0,
      maxWarnings: 5,
      useLLM: true,
      rules: ["no-console-log", "no-todo", "test-coverage", "no-any", "file-size", "no-secrets"],
    },
  };

  return config;
}

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function cmdInit(options: InitOptions): Promise<string> {
  const fs = await import("fs");

  const outputPath = options.output ?? "orchestrator.json";

  // Check if file already exists
  if (!options.force && fs.existsSync(outputPath)) {
    log.error(`${outputPath} already exists. Use --force to overwrite.`);
    return outputPath;
  }

  const config = generateConfig(options);

  // Validate the generated config
  const result = validateConfig(config);
  if (!result.valid) {
    log.warn(`Generated config has validation warnings:`);
    for (const err of result.errors) {
      log.warn(`  ${err.field}: ${err.message}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  log.info("");
  log.info(fmt.bold("TierZero Config Generated"));
  log.info(fmt.dim("─".repeat(50)));
  log.info(`  ${fmt.green("Created:")} ${outputPath}`);
  log.info("");
  log.info(fmt.bold("  Configuration:"));
  log.info(`    GitHub:    ${config.adapters?.github?.owner}/${config.adapters?.github?.repo}`);
  log.info(`    Agent:     ${Object.values(config.agents ?? {})[0]?.type ?? "codex"}`);
  log.info(`    Interval:  ${config.adapters?.github?.interval ?? 180}s`);
  log.info(`    Knowledge: ${config.knowledge?.enabled ? config.knowledge.backend : "disabled"}`);
  log.info(`    API Port:  ${config.apiPort ?? 3500}`);
  log.info("");
  log.info(fmt.bold("  Next steps:"));
  log.info(`    1. Set ${fmt.cyan("GITHUB_TOKEN")} environment variable`);
  log.info(`    2. Edit ${fmt.cyan(outputPath)} to match your project`);
  log.info(`    3. Run ${fmt.cyan("npx tsx src/cli.ts orchestrate")}`);
  log.info(fmt.dim("─".repeat(50)));
  log.info("");

  return outputPath;
}
