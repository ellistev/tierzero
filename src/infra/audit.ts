/**
 * Audit Trail.
 *
 * Every significant action is logged to an append-only audit file.
 * File: .tierzero/audit.log (one JSON object per line)
 */

import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  action: string;    // 'task.submitted' | 'agent.spawned' | 'pr.created' | 'deploy.initiated' | ...
  actor: string;     // 'watcher' | 'supervisor' | 'claude-code-agent' | 'user'
  target: string;    // issue number, PR number, task ID
  details: Record<string, unknown>;
  tenantId?: string;
}

export interface AuditQueryOptions {
  action?: string;
  actor?: string;
  target?: string;
  from?: string;  // ISO date
  to?: string;    // ISO date
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// AuditTrail
// ---------------------------------------------------------------------------

export class AuditTrail {
  private readonly filePath: string;

  constructor(filePath: string = ".tierzero/audit.log") {
    this.filePath = filePath;
  }

  /** Record an audit entry (append-only) */
  record(entry: Omit<AuditEntry, "timestamp"> & { timestamp?: string }): AuditEntry {
    const full: AuditEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      action: entry.action,
      actor: entry.actor,
      target: entry.target,
      details: entry.details,
      ...(entry.tenantId ? { tenantId: entry.tenantId } : {}),
    };

    this.appendEntry(full);
    return full;
  }

  /** Query audit entries with filters */
  query(options: AuditQueryOptions = {}): AuditEntry[] {
    const entries = this.readAll();
    let filtered = entries;

    if (options.action) {
      filtered = filtered.filter(e => e.action === options.action);
    }
    if (options.actor) {
      filtered = filtered.filter(e => e.actor === options.actor);
    }
    if (options.target) {
      filtered = filtered.filter(e => e.target === options.target);
    }
    if (options.from) {
      filtered = filtered.filter(e => e.timestamp >= options.from!);
    }
    if (options.to) {
      filtered = filtered.filter(e => e.timestamp <= options.to!);
    }

    // Apply offset and limit
    const offset = options.offset ?? 0;
    const limit = options.limit ?? filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  /** Read all entries (for export) */
  readAll(): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const content = readFileSync(this.filePath, "utf-8");
      return content
        .split("\n")
        .filter(line => line.trim().length > 0)
        .map(line => {
          try {
            return JSON.parse(line) as AuditEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is AuditEntry => e !== null);
    } catch {
      return [];
    }
  }

  /** Get the raw log file content (for export) */
  readRaw(): string {
    if (!existsSync(this.filePath)) return "";
    try {
      return readFileSync(this.filePath, "utf-8");
    } catch {
      return "";
    }
  }

  /** Get the file path */
  getFilePath(): string {
    return this.filePath;
  }

  private appendEntry(entry: AuditEntry): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Best effort
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _auditTrail: AuditTrail | null = null;

export function getAuditTrail(filePath?: string): AuditTrail {
  if (!_auditTrail) {
    _auditTrail = new AuditTrail(filePath);
  }
  return _auditTrail;
}

export function resetAuditTrail(): void {
  _auditTrail = null;
}
