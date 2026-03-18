import { Aggregate } from "../../infra/aggregate";
import { StartRecording, AddAction, AnnotateRecording, GenerateSkill, CompleteRecording, FailRecording } from "./commands";
import { RecordingStarted, ActionAdded, RecordingAnnotated, SkillGenerated, RecordingCompleted, RecordingFailed } from "./events";

interface WorkflowRecordingState extends Record<string, unknown> {
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

export class WorkflowRecordingAggregate extends Aggregate<WorkflowRecordingState> {
  static type = "WorkflowRecordingAggregate" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(StartRecording, (_state, cmd) => {
      return [new RecordingStarted(cmd.recordingId, cmd.name, cmd.sourceUrl, cmd.startedAt)];
    });

    this._registerCommandHandler(AddAction, (state, cmd) => {
      if (!state.recordingId) throw new Error("Recording does not exist");
      if (state.status !== "recording") throw new Error("Recording not in recording state");
      return [new ActionAdded(cmd.recordingId, cmd.actionIndex, cmd.addedAt)];
    });

    this._registerCommandHandler(AnnotateRecording, (state, cmd) => {
      if (!state.recordingId) throw new Error("Recording does not exist");
      if (state.status !== "recording") throw new Error("Recording not in recording state");
      return [new RecordingAnnotated(cmd.recordingId, cmd.description, cmd.annotatedAt)];
    });

    this._registerCommandHandler(GenerateSkill, (state, cmd) => {
      if (!state.recordingId) throw new Error("Recording does not exist");
      if (state.status !== "annotating") throw new Error("Recording not in annotating state");
      return [new SkillGenerated(cmd.recordingId, cmd.skillId, cmd.skillName, cmd.generatedAt)];
    });

    this._registerCommandHandler(CompleteRecording, (state, cmd) => {
      if (!state.recordingId) throw new Error("Recording does not exist");
      if (state.status === "completed" || state.status === "failed") throw new Error("Recording already finished");
      return [new RecordingCompleted(cmd.recordingId, cmd.completedAt)];
    });

    this._registerCommandHandler(FailRecording, (state, cmd) => {
      if (!state.recordingId) throw new Error("Recording does not exist");
      if (state.status === "completed" || state.status === "failed") throw new Error("Recording already finished");
      return [new RecordingFailed(cmd.recordingId, cmd.error, cmd.failedAt)];
    });

    // Event handlers
    this._registerEventHandler(RecordingStarted, (_state, e) => ({
      recordingId: e.recordingId,
      name: e.name,
      sourceUrl: e.sourceUrl,
      description: "",
      status: "recording" as const,
      actionsCount: 0,
      skillId: null,
      skillName: null,
      startedAt: e.startedAt,
      completedAt: null,
      error: null,
    }));

    this._registerEventHandler(ActionAdded, (state, _e) => ({
      ...state,
      actionsCount: (state.actionsCount as number) + 1,
    }));

    this._registerEventHandler(RecordingAnnotated, (state, e) => ({
      ...state,
      status: "annotating" as const,
      description: e.description,
    }));

    this._registerEventHandler(SkillGenerated, (state, e) => ({
      ...state,
      status: "generating" as const,
      skillId: e.skillId,
      skillName: e.skillName,
    }));

    this._registerEventHandler(RecordingCompleted, (state, _e) => ({
      ...state,
      status: "completed" as const,
      completedAt: _e.completedAt,
    }));

    this._registerEventHandler(RecordingFailed, (state, e) => ({
      ...state,
      status: "failed" as const,
      error: e.error,
    }));
  }
}
