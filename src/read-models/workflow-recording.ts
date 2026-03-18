import {
  RecordingStarted,
  ActionAdded,
  RecordingAnnotated,
  SkillGenerated,
  RecordingCompleted,
  RecordingFailed,
} from "../domain/workflow-recording/events";

export interface WorkflowRecordingRecord {
  recordingId: string;
  name: string;
  sourceUrl: string;
  description: string;
  status: "recording" | "annotating" | "generating" | "completed" | "failed";
  actionsCount: number;
  skillId: string | null;
  skillName: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export class WorkflowRecordingStore {
  private readonly records = new Map<string, WorkflowRecordingRecord>();

  apply(event: unknown): void {
    const e = event as Record<string, unknown>;
    const type = (event as { constructor: { type: string } }).constructor?.type;

    switch (type) {
      case RecordingStarted.type:
        this.records.set(e.recordingId as string, {
          recordingId: e.recordingId as string,
          name: e.name as string,
          sourceUrl: e.sourceUrl as string,
          description: "",
          status: "recording",
          actionsCount: 0,
          skillId: null,
          skillName: null,
          startedAt: e.startedAt as string,
          completedAt: null,
          error: null,
        });
        break;
      case ActionAdded.type: {
        const rec = this.records.get(e.recordingId as string);
        if (rec) {
          rec.actionsCount += 1;
        }
        break;
      }
      case RecordingAnnotated.type: {
        const rec = this.records.get(e.recordingId as string);
        if (rec) {
          rec.status = "annotating";
          rec.description = e.description as string;
        }
        break;
      }
      case SkillGenerated.type: {
        const rec = this.records.get(e.recordingId as string);
        if (rec) {
          rec.status = "generating";
          rec.skillId = e.skillId as string;
          rec.skillName = e.skillName as string;
        }
        break;
      }
      case RecordingCompleted.type: {
        const rec = this.records.get(e.recordingId as string);
        if (rec) {
          rec.status = "completed";
          rec.completedAt = e.completedAt as string;
        }
        break;
      }
      case RecordingFailed.type: {
        const rec = this.records.get(e.recordingId as string);
        if (rec) {
          rec.status = "failed";
          rec.error = e.error as string;
        }
        break;
      }
    }
  }

  get(recordingId: string): WorkflowRecordingRecord | undefined {
    const rec = this.records.get(recordingId);
    return rec ? { ...rec } : undefined;
  }

  list(options?: { status?: string }): WorkflowRecordingRecord[] {
    const all = [...this.records.values()];
    if (options?.status) {
      return all.filter((r) => r.status === options.status).map((r) => ({ ...r }));
    }
    return all.map((r) => ({ ...r }));
  }

  getAll(): WorkflowRecordingRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }
}
