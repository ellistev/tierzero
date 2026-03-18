import {
  PipelineStarted,
  AgentWorkCompleted,
  TestsRan,
  TestFixApplied,
  PRCreated,
  PipelineCompleted,
  PipelineFailed,
} from "../domain/issue-pipeline/events";

export interface PipelineRunRecord {
  pipelineId: string;
  issueNumber: number;
  title: string;
  branch: string;
  status: 'started' | 'agent_done' | 'tests_passing' | 'tests_failing' | 'pr_created' | 'completed' | 'failed';
  summary: string;
  filesChanged: string[];
  testsRun: number;
  testsPassed: number;
  testAttempts: number;
  prNumber: number | null;
  prUrl: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export type PipelineEvent =
  | PipelineStarted
  | AgentWorkCompleted
  | TestsRan
  | TestFixApplied
  | PRCreated
  | PipelineCompleted
  | PipelineFailed;

export interface ListOptions {
  status?: PipelineRunRecord['status'];
  limit?: number;
  offset?: number;
}

export class PipelineRunStore {
  private records = new Map<string, PipelineRunRecord>();

  apply(event: PipelineEvent): void {
    if (event instanceof PipelineStarted) {
      this.records.set(event.pipelineId, {
        pipelineId: event.pipelineId,
        issueNumber: event.issueNumber,
        title: event.title,
        branch: event.branch,
        status: 'started',
        summary: '',
        filesChanged: [],
        testsRun: 0,
        testsPassed: 0,
        testAttempts: 0,
        prNumber: null,
        prUrl: null,
        error: null,
        startedAt: event.startedAt,
        completedAt: null,
        durationMs: null,
      });
      return;
    }

    const id = event.pipelineId;
    const record = this.records.get(id);
    if (!record) return;

    if (event instanceof AgentWorkCompleted) {
      record.status = 'agent_done';
      record.summary = event.summary;
      record.filesChanged = event.filesChanged;
    } else if (event instanceof TestsRan) {
      record.status = event.passed ? 'tests_passing' : 'tests_failing';
      record.testsRun = event.total;
      record.testsPassed = event.passing;
      record.testAttempts = event.attempt;
    } else if (event instanceof TestFixApplied) {
      record.summary = record.summary
        ? `${record.summary}\n${event.summary}`
        : event.summary;
      const merged = new Set([...record.filesChanged, ...event.filesChanged]);
      record.filesChanged = [...merged];
    } else if (event instanceof PRCreated) {
      record.status = 'pr_created';
      record.prNumber = event.prNumber;
      record.prUrl = event.prUrl;
    } else if (event instanceof PipelineCompleted) {
      record.status = 'completed';
      record.completedAt = event.completedAt;
      record.durationMs = new Date(event.completedAt).getTime() - new Date(record.startedAt).getTime();
    } else if (event instanceof PipelineFailed) {
      record.status = 'failed';
      record.error = event.error;
      record.completedAt = event.failedAt;
      record.durationMs = new Date(event.failedAt).getTime() - new Date(record.startedAt).getTime();
    }
  }

  get(pipelineId: string): PipelineRunRecord | undefined {
    const r = this.records.get(pipelineId);
    return r ? { ...r, filesChanged: [...r.filesChanged] } : undefined;
  }

  list(options?: ListOptions): PipelineRunRecord[] {
    let results = [...this.records.values()];
    if (options?.status) {
      results = results.filter(r => r.status === options.status);
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit).map(r => ({ ...r, filesChanged: [...r.filesChanged] }));
  }

  getAll(): PipelineRunRecord[] {
    return this.list();
  }
}
