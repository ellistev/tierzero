/**
 * Structured Logger.
 *
 * Outputs JSON when LOG_FORMAT=json, pretty-printed text when interactive.
 * Supports log levels (debug, info, warn, error) configurable via LOG_LEVEL.
 * Supports file output with rotation via LOG_FILE.
 */

import { appendFileSync, renameSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export interface LoggerOptions {
  /** Log level threshold (default: from LOG_LEVEL env or "info") */
  level?: LogLevel;
  /** Output format (default: from LOG_FORMAT env, "json" or "pretty") */
  format?: "json" | "pretty";
  /** Component name for this logger */
  component?: string;
  /** File path for log output (default: from LOG_FILE env) */
  logFile?: string;
  /** Max file size in bytes before rotation (default: 10MB) */
  maxFileSize?: number;
  /** Number of rotated files to keep (default: 5) */
  maxFiles?: number;
  /** Custom write function (for testing) */
  write?: (line: string, level: LogLevel) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[2m",    // dim
  info: "\x1b[36m",    // cyan
  warn: "\x1b[33m",    // yellow
  error: "\x1b[31m",   // red
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

// ---------------------------------------------------------------------------
// File rotation
// ---------------------------------------------------------------------------

function rotateFile(filePath: string, maxFiles: number): void {
  // Shift existing rotated files: .4 -> .5, .3 -> .4, etc.
  for (let i = maxFiles - 1; i >= 1; i--) {
    try {
      renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`);
    } catch {
      // File may not exist
    }
  }
  // Rotate current file to .1
  try {
    renameSync(filePath, `${filePath}.1`);
  } catch {
    // File may not exist
  }
}

function writeToFile(
  filePath: string,
  line: string,
  maxFileSize: number,
  maxFiles: number,
): void {
  try {
    // Ensure directory exists
    mkdirSync(dirname(filePath), { recursive: true });

    // Check rotation
    try {
      const stats = statSync(filePath);
      if (stats.size >= maxFileSize) {
        rotateFile(filePath, maxFiles);
      }
    } catch {
      // File doesn't exist yet
    }

    appendFileSync(filePath, line + "\n", "utf-8");
  } catch {
    // Best effort - don't crash on log file errors
  }
}

// ---------------------------------------------------------------------------
// StructuredLogger
// ---------------------------------------------------------------------------

export class StructuredLogger implements Logger {
  private readonly level: LogLevel;
  private readonly format: "json" | "pretty";
  private readonly component: string;
  private readonly logFile: string | null;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;
  private readonly writeFn: ((line: string, level: LogLevel) => void) | null;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? "info";
    this.format = opts.format ?? (process.env.LOG_FORMAT === "json" ? "json" : "pretty");
    this.component = opts.component ?? "app";
    this.logFile = opts.logFile ?? process.env.LOG_FILE ?? null;
    this.maxFileSize = opts.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.maxFiles = opts.maxFiles ?? 5;
    this.writeFn = opts.write ?? null;
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  child(component: string): Logger {
    return new StructuredLogger({
      level: this.level,
      format: this.format,
      component,
      logFile: this.logFile,
      maxFileSize: this.maxFileSize,
      maxFiles: this.maxFiles,
      write: this.writeFn ?? undefined,
    });
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level,
      component: this.component,
      msg,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };

    // JSON line for file output and JSON format
    const jsonLine = JSON.stringify(entry);

    // Write to file (always JSON)
    if (this.logFile) {
      writeToFile(this.logFile, jsonLine, this.maxFileSize, this.maxFiles);
    }

    // Write to console
    if (this.writeFn) {
      this.writeFn(this.format === "json" ? jsonLine : this.formatPretty(level, timestamp, msg, data), level);
    } else if (this.format === "json") {
      if (level === "error") {
        process.stderr.write(jsonLine + "\n");
      } else {
        process.stdout.write(jsonLine + "\n");
      }
    } else {
      const pretty = this.formatPretty(level, timestamp, msg, data);
      if (level === "error") {
        process.stderr.write(pretty + "\n");
      } else {
        process.stdout.write(pretty + "\n");
      }
    }
  }

  private formatPretty(level: LogLevel, timestamp: string, msg: string, data?: Record<string, unknown>): string {
    const isTTY = process.stdout.isTTY;
    const time = DIM + timestamp.slice(11, 23) + RESET;
    const lvl = isTTY
      ? LEVEL_COLORS[level] + level.toUpperCase().padEnd(5) + RESET
      : level.toUpperCase().padEnd(5);
    const comp = isTTY
      ? DIM + `[${this.component}]` + RESET
      : `[${this.component}]`;

    let line = isTTY
      ? `${time} ${lvl} ${comp} ${msg}`
      : `${timestamp.slice(11, 23)} ${level.toUpperCase().padEnd(5)} [${this.component}] ${msg}`;

    if (data && Object.keys(data).length > 0) {
      line += " " + (isTTY ? DIM : "") + JSON.stringify(data) + (isTTY ? RESET : "");
    }

    return line;
  }
}

// ---------------------------------------------------------------------------
// Singleton + factory
// ---------------------------------------------------------------------------

let _rootLogger: StructuredLogger | null = null;

/** Get or create the root logger singleton */
export function getRootLogger(opts?: LoggerOptions): StructuredLogger {
  if (!_rootLogger) {
    _rootLogger = new StructuredLogger(opts);
  }
  return _rootLogger;
}

/** Create a child logger for a specific component */
export function createLogger(component: string, opts?: LoggerOptions): Logger {
  if (opts) {
    return new StructuredLogger({ ...opts, component });
  }
  return getRootLogger().child(component);
}

/** Reset the root logger (for testing) */
export function resetRootLogger(): void {
  _rootLogger = null;
}
