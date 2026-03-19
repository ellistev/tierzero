import {
  DeployInitiated,
  DeploySucceeded,
  DeployFailed,
  RollbackInitiated,
  RollbackCompleted,
} from "../domain/deployment/events";

export interface DeploymentRecord {
  deployId: string;
  environment: string;
  version: string;
  strategy: string;
  status: 'initiated' | 'succeeded' | 'failed' | 'rolling_back' | 'rolled_back';
  healthCheckPassed: boolean;
  error: string | null;
  initiatedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  restoredVersion: string | null;
}

export type DeploymentEvent =
  | DeployInitiated
  | DeploySucceeded
  | DeployFailed
  | RollbackInitiated
  | RollbackCompleted;

export interface DeploymentListOptions {
  environment?: string;
  status?: DeploymentRecord['status'];
  version?: string;
  limit?: number;
  offset?: number;
}

export class DeploymentStore {
  private records = new Map<string, DeploymentRecord>();

  apply(event: DeploymentEvent): void {
    if (event instanceof DeployInitiated) {
      this.records.set(event.deployId, {
        deployId: event.deployId,
        environment: event.environment,
        version: event.version,
        strategy: event.strategy,
        status: 'initiated',
        healthCheckPassed: false,
        error: null,
        initiatedAt: event.initiatedAt,
        completedAt: null,
        durationMs: null,
        restoredVersion: null,
      });
      return;
    }

    const id = event.deployId;
    const record = this.records.get(id);
    if (!record) return;

    if (event instanceof DeploySucceeded) {
      record.status = 'succeeded';
      record.healthCheckPassed = event.healthCheckPassed;
      record.completedAt = event.completedAt;
      record.durationMs = new Date(event.completedAt).getTime() - new Date(record.initiatedAt).getTime();
    } else if (event instanceof DeployFailed) {
      record.status = 'failed';
      record.error = event.error;
      record.completedAt = event.failedAt;
      record.durationMs = new Date(event.failedAt).getTime() - new Date(record.initiatedAt).getTime();
    } else if (event instanceof RollbackInitiated) {
      record.status = 'rolling_back';
    } else if (event instanceof RollbackCompleted) {
      record.status = 'rolled_back';
      record.restoredVersion = event.restoredVersion;
      record.completedAt = event.completedAt;
      record.durationMs = new Date(event.completedAt).getTime() - new Date(record.initiatedAt).getTime();
    }
  }

  get(deployId: string): DeploymentRecord | undefined {
    const r = this.records.get(deployId);
    return r ? { ...r } : undefined;
  }

  list(options?: DeploymentListOptions): DeploymentRecord[] {
    let results = [...this.records.values()];
    if (options?.environment) {
      results = results.filter(r => r.environment === options.environment);
    }
    if (options?.status) {
      results = results.filter(r => r.status === options.status);
    }
    if (options?.version) {
      results = results.filter(r => r.version === options.version);
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit).map(r => ({ ...r }));
  }

  getByEnvironment(environment: string): DeploymentRecord[] {
    return this.list({ environment });
  }

  getAll(): DeploymentRecord[] {
    return this.list();
  }

  stats(environment?: string): { total: number; succeeded: number; failed: number; rolledBack: number; avgDurationMs: number } {
    let records = [...this.records.values()];
    if (environment) {
      records = records.filter(r => r.environment === environment);
    }
    const total = records.length;
    const succeeded = records.filter(r => r.status === 'succeeded').length;
    const failed = records.filter(r => r.status === 'failed').length;
    const rolledBack = records.filter(r => r.status === 'rolled_back').length;
    const durations = records.filter(r => r.durationMs !== null).map(r => r.durationMs!);
    const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return { total, succeeded, failed, rolledBack, avgDurationMs };
  }
}
