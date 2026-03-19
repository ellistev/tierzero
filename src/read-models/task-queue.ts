import {
  TaskSubmitted,
  TaskAssigned,
  TaskStarted,
  TaskCompleted,
  TaskFailed,
  TaskEscalated,
  TaskRetried,
  type TaskEvent,
} from "../domain/task/events";

export interface TaskQueueRecord {
  taskId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  assignedAgent: string | null;
  status: 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'escalated';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  durationMs: number | null;
}

export interface TaskQueueListOptions {
  status?: TaskQueueRecord['status'];
  category?: string;
  priority?: string;
  sourceType?: string;
  assignedAgent?: string;
  limit?: number;
  offset?: number;
}

export class TaskQueueStore {
  private records = new Map<string, TaskQueueRecord>();

  apply(event: TaskEvent): void {
    if (event instanceof TaskSubmitted) {
      this.records.set(event.taskId, {
        taskId: event.taskId,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        title: event.title,
        description: event.description,
        category: event.category,
        priority: event.priority,
        assignedAgent: null,
        status: 'queued',
        createdAt: event.createdAt,
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        retryCount: 0,
        maxRetries: 3,
        durationMs: null,
      });
      return;
    }

    const id = event.taskId;
    const record = this.records.get(id);
    if (!record) return;

    if (event instanceof TaskAssigned) {
      record.status = 'assigned';
      record.assignedAgent = event.agentName;
    } else if (event instanceof TaskStarted) {
      record.status = 'running';
      record.startedAt = event.startedAt;
    } else if (event instanceof TaskCompleted) {
      record.status = 'completed';
      record.result = event.result;
      record.completedAt = event.completedAt;
      if (record.startedAt) {
        record.durationMs = new Date(event.completedAt).getTime() - new Date(record.startedAt).getTime();
      }
    } else if (event instanceof TaskFailed) {
      record.status = 'failed';
      record.error = event.error;
      record.completedAt = event.failedAt;
      if (record.startedAt) {
        record.durationMs = new Date(event.failedAt).getTime() - new Date(record.startedAt).getTime();
      }
    } else if (event instanceof TaskEscalated) {
      record.status = 'escalated';
      record.error = event.reason;
      record.completedAt = event.escalatedAt;
      if (record.startedAt) {
        record.durationMs = new Date(event.escalatedAt).getTime() - new Date(record.startedAt).getTime();
      }
    } else if (event instanceof TaskRetried) {
      record.status = 'queued';
      record.retryCount = event.retryCount;
      record.error = null;
      record.completedAt = null;
      record.assignedAgent = null;
      record.startedAt = null;
      record.result = null;
      record.durationMs = null;
    }
  }

  get(taskId: string): TaskQueueRecord | undefined {
    const r = this.records.get(taskId);
    return r ? { ...r } : undefined;
  }

  list(options?: TaskQueueListOptions): TaskQueueRecord[] {
    let results = [...this.records.values()];
    if (options?.status) results = results.filter(r => r.status === options.status);
    if (options?.category) results = results.filter(r => r.category === options.category);
    if (options?.priority) results = results.filter(r => r.priority === options.priority);
    if (options?.sourceType) results = results.filter(r => r.sourceType === options.sourceType);
    if (options?.assignedAgent) results = results.filter(r => r.assignedAgent === options.assignedAgent);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit).map(r => ({ ...r }));
  }

  getAll(): TaskQueueRecord[] {
    return this.list();
  }
}
