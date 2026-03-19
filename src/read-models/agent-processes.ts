import {
  AgentSpawned,
  AgentHeartbeatReceived,
  AgentCompleted,
  AgentFailed,
  AgentHung,
  AgentKilled,
  type AgentProcessEvent,
} from "../domain/agent-process/events";

export interface AgentProcessRecord {
  processId: string;
  agentName: string;
  taskId: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'killed' | 'hung';
  startedAt: string;
  lastHeartbeatAt: string;
  completedAt: string | null;
  durationMs: number | null;
  result: unknown | null;
  error: string | null;
  reason: string | null;
  progress: string;
}

export interface AgentProcessListOptions {
  status?: AgentProcessRecord['status'];
  agentName?: string;
  taskId?: string;
  limit?: number;
  offset?: number;
}

export interface AgentUtilizationSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  killed: number;
  hung: number;
}

export class AgentProcessStore {
  private records = new Map<string, AgentProcessRecord>();

  apply(event: AgentProcessEvent): void {
    if (event instanceof AgentSpawned) {
      this.records.set(event.processId, {
        processId: event.processId,
        agentName: event.agentName,
        taskId: event.taskId,
        status: 'starting',
        startedAt: event.spawnedAt,
        lastHeartbeatAt: event.spawnedAt,
        completedAt: null,
        durationMs: null,
        result: null,
        error: null,
        reason: null,
        progress: '',
      });
      return;
    }

    const id = event.processId;
    const record = this.records.get(id);
    if (!record) return;

    if (event instanceof AgentHeartbeatReceived) {
      record.lastHeartbeatAt = event.receivedAt;
      record.progress = event.progress;
      // If agent was starting, it's now running
      if (record.status === 'starting') record.status = 'running';
    } else if (event instanceof AgentCompleted) {
      record.status = 'completed';
      record.result = event.result;
      record.completedAt = event.completedAt;
      record.durationMs = event.durationMs;
    } else if (event instanceof AgentFailed) {
      record.status = 'failed';
      record.error = event.error;
      record.completedAt = event.failedAt;
      if (record.startedAt) {
        record.durationMs = new Date(event.failedAt).getTime() - new Date(record.startedAt).getTime();
      }
    } else if (event instanceof AgentHung) {
      record.status = 'hung';
      record.lastHeartbeatAt = event.lastHeartbeatAt;
    } else if (event instanceof AgentKilled) {
      record.status = 'killed';
      record.reason = event.reason;
      record.completedAt = event.killedAt;
      if (record.startedAt) {
        record.durationMs = new Date(event.killedAt).getTime() - new Date(record.startedAt).getTime();
      }
    }
  }

  get(processId: string): AgentProcessRecord | undefined {
    const r = this.records.get(processId);
    return r ? { ...r } : undefined;
  }

  list(options?: AgentProcessListOptions): AgentProcessRecord[] {
    let results = [...this.records.values()];
    if (options?.status) results = results.filter(r => r.status === options.status);
    if (options?.agentName) results = results.filter(r => r.agentName === options.agentName);
    if (options?.taskId) results = results.filter(r => r.taskId === options.taskId);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit).map(r => ({ ...r }));
  }

  getRunning(): AgentProcessRecord[] {
    return this.list().filter(r => r.status === 'running' || r.status === 'starting');
  }

  getHung(): AgentProcessRecord[] {
    return this.list({ status: 'hung' });
  }

  utilization(): AgentUtilizationSummary {
    const all = [...this.records.values()];
    return {
      total: all.length,
      running: all.filter(r => r.status === 'running' || r.status === 'starting').length,
      completed: all.filter(r => r.status === 'completed').length,
      failed: all.filter(r => r.status === 'failed').length,
      killed: all.filter(r => r.status === 'killed').length,
      hung: all.filter(r => r.status === 'hung').length,
    };
  }

  getAll(): AgentProcessRecord[] {
    return this.list();
  }
}
