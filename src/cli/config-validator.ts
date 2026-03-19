/**
 * Config Validator for orchestrator.json.
 *
 * Validates required fields, recognized agent types, cron expressions,
 * and port availability. Returns a list of validation errors.
 */

import { createLogger } from "../infra/logger";

const log = createLogger("config-validator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface OrchestratorConfig {
  adapters?: {
    github?: {
      owner?: string;
      repo?: string;
      token?: string;
      label?: string;
      interval?: number;
      trustedAuthors?: string[];
      requireTrustedAuthor?: boolean;
    };
    webhook?: {
      port?: number;
    };
  };
  agents?: Record<string, {
    type?: string;
    capabilities?: string[];
    maxConcurrent?: number;
  }>;
  scheduler?: {
    timezone?: string;
    jobs?: Array<{
      id?: string;
      name?: string;
      schedule?: string;
      enabled?: boolean;
      taskTemplate?: Record<string, unknown>;
      maxConsecutiveFailures?: number;
    }>;
  };
  apiPort?: number;
  maxConcurrent?: number;
  taskTimeoutMs?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Known agent types and capabilities
// ---------------------------------------------------------------------------

const KNOWN_AGENT_TYPES = new Set([
  "claude-code",
  "native",
  "implementer",
  "reviewer",
  "monitor",
  "communicator",
  "researcher",
]);

const KNOWN_CAPABILITIES = new Set([
  "code",
  "communication",
  "research",
  "operations",
  "monitoring",
]);

// ---------------------------------------------------------------------------
// Cron validation
// ---------------------------------------------------------------------------

/**
 * Basic cron expression validation (5-field format).
 * Checks that each field is syntactically valid.
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges: Array<{ min: number; max: number }> = [
    { min: 0, max: 59 },  // minute
    { min: 0, max: 23 },  // hour
    { min: 1, max: 31 },  // day of month
    { min: 1, max: 12 },  // month
    { min: 0, max: 7 },   // day of week (0 and 7 = Sunday)
  ];

  for (let i = 0; i < 5; i++) {
    if (!isValidCronField(parts[i], ranges[i].min, ranges[i].max)) {
      return false;
    }
  }
  return true;
}

function isValidCronField(field: string, min: number, max: number): boolean {
  // Handle comma-separated lists
  const parts = field.split(",");
  for (const part of parts) {
    if (!isValidCronPart(part, min, max)) return false;
  }
  return true;
}

function isValidCronPart(part: string, min: number, max: number): boolean {
  // Wildcard
  if (part === "*") return true;

  // Step: */N or N-M/S
  if (part.includes("/")) {
    const [range, stepStr] = part.split("/");
    const step = Number(stepStr);
    if (isNaN(step) || step < 1) return false;
    if (range === "*") return true;
    return isValidCronRange(range, min, max);
  }

  // Range: N-M
  if (part.includes("-")) {
    return isValidCronRange(part, min, max);
  }

  // Single value
  const val = Number(part);
  return !isNaN(val) && val >= min && val <= max;
}

function isValidCronRange(range: string, min: number, max: number): boolean {
  const [startStr, endStr] = range.split("-");
  const start = Number(startStr);
  const end = Number(endStr);
  return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
}

// ---------------------------------------------------------------------------
// Port availability check
// ---------------------------------------------------------------------------

export async function isPortAvailable(port: number): Promise<boolean> {
  const net = await import("net");
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

// ---------------------------------------------------------------------------
// GitHub token validation
// ---------------------------------------------------------------------------

export async function isGitHubTokenValid(token: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validate orchestrator config synchronously (structural checks only).
 */
export function validateConfig(config: OrchestratorConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // Required top-level fields
  if (!config.adapters || typeof config.adapters !== "object") {
    errors.push({ field: "adapters", message: "Missing required field 'adapters'" });
  }

  // Validate GitHub adapter if present
  if (config.adapters?.github) {
    const gh = config.adapters.github;
    if (!gh.owner) errors.push({ field: "adapters.github.owner", message: "GitHub adapter requires 'owner'" });
    if (!gh.repo) errors.push({ field: "adapters.github.repo", message: "GitHub adapter requires 'repo'" });
    if (gh.interval !== undefined && (typeof gh.interval !== "number" || gh.interval < 1)) {
      errors.push({ field: "adapters.github.interval", message: "GitHub poll interval must be a positive number" });
    }
  }

  // Validate webhook adapter if present
  if (config.adapters?.webhook) {
    const wh = config.adapters.webhook;
    if (wh.port !== undefined && (typeof wh.port !== "number" || wh.port < 1 || wh.port > 65535)) {
      errors.push({ field: "adapters.webhook.port", message: "Webhook port must be between 1 and 65535" });
    }
  }

  // Validate API port
  if (config.apiPort !== undefined && (typeof config.apiPort !== "number" || config.apiPort < 1 || config.apiPort > 65535)) {
    errors.push({ field: "apiPort", message: "API port must be between 1 and 65535" });
  }

  // Validate agents if present
  if (config.agents) {
    for (const [name, agent] of Object.entries(config.agents)) {
      if (agent.type && !KNOWN_AGENT_TYPES.has(agent.type)) {
        errors.push({
          field: `agents.${name}.type`,
          message: `Unrecognized agent type '${agent.type}'. Known types: ${[...KNOWN_AGENT_TYPES].join(", ")}`,
        });
      }
      if (agent.capabilities) {
        for (const cap of agent.capabilities) {
          if (!KNOWN_CAPABILITIES.has(cap)) {
            errors.push({
              field: `agents.${name}.capabilities`,
              message: `Unrecognized capability '${cap}'. Known: ${[...KNOWN_CAPABILITIES].join(", ")}`,
            });
          }
        }
      }
      if (agent.maxConcurrent !== undefined && (typeof agent.maxConcurrent !== "number" || agent.maxConcurrent < 1)) {
        errors.push({
          field: `agents.${name}.maxConcurrent`,
          message: "maxConcurrent must be a positive number",
        });
      }
    }
  }

  // Validate scheduler jobs
  if (config.scheduler?.jobs) {
    for (let i = 0; i < config.scheduler.jobs.length; i++) {
      const job = config.scheduler.jobs[i];
      if (!job.id) {
        errors.push({ field: `scheduler.jobs[${i}].id`, message: "Scheduled job requires 'id'" });
      }
      if (job.schedule && !isValidCron(job.schedule)) {
        errors.push({
          field: `scheduler.jobs[${i}].schedule`,
          message: `Invalid cron expression '${job.schedule}'`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate orchestrator config with async checks (port availability, token validity).
 */
export async function validateConfigAsync(config: OrchestratorConfig): Promise<ValidationResult> {
  const result = validateConfig(config);
  const errors = [...result.errors];

  // Check port availability
  const apiPort = config.apiPort ?? 3500;
  if (apiPort >= 1 && apiPort <= 65535) {
    const available = await isPortAvailable(apiPort);
    if (!available) {
      errors.push({ field: "apiPort", message: `Port ${apiPort} is already in use` });
    }
  }

  if (config.adapters?.webhook?.port) {
    const whPort = config.adapters.webhook.port;
    if (whPort >= 1 && whPort <= 65535 && whPort !== apiPort) {
      const available = await isPortAvailable(whPort);
      if (!available) {
        errors.push({ field: "adapters.webhook.port", message: `Port ${whPort} is already in use` });
      }
    }
  }

  // Check GitHub token
  const ghToken = config.adapters?.github?.token ?? process.env.GITHUB_TOKEN;
  if (ghToken && config.adapters?.github) {
    const valid = await isGitHubTokenValid(ghToken);
    if (!valid) {
      errors.push({ field: "adapters.github.token", message: "GitHub token is invalid or expired" });
    }
  }

  return { valid: errors.length === 0, errors };
}
