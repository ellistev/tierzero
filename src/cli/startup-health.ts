/**
 * Startup Health Check for the orchestrator.
 *
 * Runs dependency checks on startup and prints a summary with
 * green/red status per component. Fails fast if critical deps missing.
 */

import { createLogger } from "../infra/logger";
import { validateConfig, type OrchestratorConfig, type ValidationError } from "./config-validator";

const log = createLogger("startup-health");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
const fmt = {
  bold:  (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:   (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:   (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow:(s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  component: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

export interface StartupHealthResult {
  checks: HealthCheckResult[];
  critical: boolean; // true = a critical dependency is missing
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export async function checkCodexCLI(options?: {
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}): Promise<HealthCheckResult> {
  try {
    const exec = options?.execFn ?? defaultExec;
    const { stdout } = await exec("codex --version");
    return { component: "Codex CLI", status: "ok", message: `Installed (${stdout.trim()})` };
  } catch {
    return { component: "Codex CLI", status: "warn", message: "Not installed or not in PATH" };
  }
}

export async function checkCodexAuth(options?: {
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}): Promise<HealthCheckResult> {
  try {
    const exec = options?.execFn ?? defaultExec;
    await exec("codex login status");
    return { component: "Codex Auth", status: "ok", message: "Authenticated" };
  } catch {
    return { component: "Codex Auth", status: "warn", message: "Not authenticated (run 'codex login')" };
  }
}

export async function checkClaudeCodeCLI(options?: {
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}): Promise<HealthCheckResult> {
  try {
    const exec = options?.execFn ?? defaultExec;
    const { stdout } = await exec("claude --version");
    return { component: "Claude Code CLI", status: "ok", message: `Installed (${stdout.trim()})` };
  } catch {
    return { component: "Claude Code CLI", status: "warn", message: "Not installed or not in PATH" };
  }
}

export async function checkClaudeCodeAuth(options?: {
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}): Promise<HealthCheckResult> {
  try {
    const exec = options?.execFn ?? defaultExec;
    await exec("claude auth status");
    return { component: "Claude Code Auth", status: "ok", message: "Authenticated" };
  } catch {
    return { component: "Claude Code Auth", status: "warn", message: "Not authenticated (run 'claude auth login')" };
  }
}

export async function checkGitHubToken(token?: string): Promise<HealthCheckResult> {
  const t = token ?? process.env.GITHUB_TOKEN;
  if (!t) {
    return { component: "GitHub Token", status: "fail", message: "No token provided (set GITHUB_TOKEN or config)" };
  }
  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${t}` },
    });
    if (resp.status === 200) {
      const data = await resp.json() as { login?: string };
      return { component: "GitHub Token", status: "ok", message: `Valid (user: ${data.login ?? "unknown"})` };
    }
    return { component: "GitHub Token", status: "fail", message: `Invalid (HTTP ${resp.status})` };
  } catch (e) {
    return { component: "GitHub Token", status: "warn", message: `Cannot reach GitHub API: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function checkConnector(name: string, test: () => Promise<boolean>): Promise<HealthCheckResult> {
  try {
    const ok = await test();
    return { component: `Connector: ${name}`, status: ok ? "ok" : "fail", message: ok ? "Connected" : "Connection failed" };
  } catch (e) {
    return { component: `Connector: ${name}`, status: "fail", message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Default exec helper
// ---------------------------------------------------------------------------

async function defaultExec(cmd: string): Promise<{ stdout: string; stderr: string }> {
  const { execSync } = await import("child_process");
  const stdout = execSync(cmd, { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
  return { stdout, stderr: "" };
}

// ---------------------------------------------------------------------------
// Main startup health check
// ---------------------------------------------------------------------------

export async function runStartupHealthCheck(
  config: OrchestratorConfig,
  options?: {
    execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
    skipNetwork?: boolean;
  },
): Promise<StartupHealthResult> {
  const checks: HealthCheckResult[] = [];
  let critical = false;

  // 1. Config validation
  const configResult = validateConfig(config);
  if (configResult.valid) {
    checks.push({ component: "Config", status: "ok", message: "Valid" });
  } else {
    checks.push({
      component: "Config",
      status: "fail",
      message: configResult.errors.map(e => `${e.field}: ${e.message}`).join("; "),
    });
    critical = true;
  }

  const configuredAgentTypes = new Set(
    Object.values(config.agents ?? {})
      .map((agent) => agent?.type)
      .filter((type): type is string => typeof type === "string"),
  );

  if (configuredAgentTypes.size === 0 || configuredAgentTypes.has("codex")) {
    const cliCheck = await checkCodexCLI({ execFn: options?.execFn });
    checks.push(cliCheck);

    if (cliCheck.status === "ok") {
      const authCheck = await checkCodexAuth({ execFn: options?.execFn });
      checks.push(authCheck);
    }
  }

  if (configuredAgentTypes.has("claude-code")) {
    const cliCheck = await checkClaudeCodeCLI({ execFn: options?.execFn });
    checks.push(cliCheck);

    if (cliCheck.status === "ok") {
      const authCheck = await checkClaudeCodeAuth({ execFn: options?.execFn });
      checks.push(authCheck);
    }
  }

  // 4. GitHub token (if GitHub adapter configured)
  if (config.adapters?.github && !options?.skipNetwork) {
    const ghToken = config.adapters.github.token ?? process.env.GITHUB_TOKEN;
    const ghCheck = await checkGitHubToken(ghToken);
    checks.push(ghCheck);
    if (ghCheck.status === "fail") critical = true;
  }

  return { checks, critical };
}

// ---------------------------------------------------------------------------
// Print startup summary
// ---------------------------------------------------------------------------

export function printStartupSummary(result: StartupHealthResult): void {
  log.info("");
  log.info(fmt.bold("Startup Health Check"));
  log.info(fmt.dim("─".repeat(50)));

  for (const check of result.checks) {
    const icon = check.status === "ok"
      ? fmt.green("[OK]")
      : check.status === "warn"
        ? fmt.yellow("[WARN]")
        : fmt.red("[FAIL]");
    log.info(`  ${icon} ${fmt.bold(check.component)}: ${check.message}`);
  }

  log.info(fmt.dim("─".repeat(50)));

  if (result.critical) {
    log.error(fmt.red("Critical dependency check failed. Fix errors above before starting."));
  } else {
    const warns = result.checks.filter(c => c.status === "warn").length;
    if (warns > 0) {
      log.warn(fmt.yellow(`${warns} warning(s) — orchestrator will start but some features may be limited.`));
    } else {
      log.info(fmt.green("All checks passed."));
    }
  }
  log.info("");
}
