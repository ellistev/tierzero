import { Aggregate } from "../../infra/aggregate";
import { StartWorkflowExecution, StartStep, CompleteStep, FailStep, SkipStep, CompleteExecution, FailExecution } from "./commands";
import { WorkflowExecutionStarted, WorkflowStepStarted, WorkflowStepCompleted, WorkflowStepFailed, WorkflowStepSkipped, WorkflowExecutionCompleted, WorkflowExecutionFailed } from "./events";

interface StepRecord {
  name: string;
  status: "started" | "completed" | "failed" | "skipped";
  detail: string;
}

interface WorkflowExecutionState extends Record<string, unknown> {
  executionId: string;
  ticketId: string;
  workflowId: string;
  status: "running" | "completed" | "failed";
  steps: StepRecord[];
  currentStep: string | null;
}

export class WorkflowExecution extends Aggregate<WorkflowExecutionState> {
  static type = "WorkflowExecution" as const;

  constructor() {
    super();

    this._registerCommandHandler(StartWorkflowExecution, (_state, cmd) => {
      return [new WorkflowExecutionStarted(cmd.executionId, cmd.ticketId, cmd.workflowId, cmd.startedAt)];
    });

    this._registerCommandHandler(StartStep, (state, cmd) => {
      if (!state.executionId) throw new Error("Execution does not exist");
      if (state.status !== "running") throw new Error("Execution is not running");
      return [new WorkflowStepStarted(cmd.executionId, cmd.stepName, cmd.detail, cmd.startedAt)];
    });

    this._registerCommandHandler(CompleteStep, (state, cmd) => {
      if (!state.executionId) throw new Error("Execution does not exist");
      if (state.status !== "running") throw new Error("Execution is not running");
      return [new WorkflowStepCompleted(cmd.executionId, cmd.stepName, cmd.detail, cmd.completedAt)];
    });

    this._registerCommandHandler(FailStep, (state, cmd) => {
      if (!state.executionId) throw new Error("Execution does not exist");
      if (state.status !== "running") throw new Error("Execution is not running");
      return [new WorkflowStepFailed(cmd.executionId, cmd.stepName, cmd.error, cmd.failedAt)];
    });

    this._registerCommandHandler(SkipStep, (state, cmd) => {
      if (!state.executionId) throw new Error("Execution does not exist");
      if (state.status !== "running") throw new Error("Execution is not running");
      return [new WorkflowStepSkipped(cmd.executionId, cmd.stepName, cmd.reason, cmd.skippedAt)];
    });

    this._registerCommandHandler(CompleteExecution, (state, cmd) => {
      if (!state.executionId) throw new Error("Execution does not exist");
      if (state.status !== "running") throw new Error("Execution is not running");
      return [new WorkflowExecutionCompleted(cmd.executionId, cmd.summary, cmd.data, cmd.completedAt)];
    });

    this._registerCommandHandler(FailExecution, (state, cmd) => {
      if (!state.executionId) throw new Error("Execution does not exist");
      if (state.status !== "running") throw new Error("Execution is not running");
      return [new WorkflowExecutionFailed(cmd.executionId, cmd.error, cmd.failedAt)];
    });

    // Event handlers
    this._registerEventHandler(WorkflowExecutionStarted, (_state, e) => ({
      executionId: e.executionId,
      ticketId: e.ticketId,
      workflowId: e.workflowId,
      status: "running" as const,
      steps: [],
      currentStep: null,
    }));

    this._registerEventHandler(WorkflowStepStarted, (state, e) => ({
      ...state,
      currentStep: e.stepName,
      steps: [...state.steps, { name: e.stepName, status: "started" as const, detail: e.detail }],
    }));

    this._registerEventHandler(WorkflowStepCompleted, (state, e) => ({
      ...state,
      currentStep: null,
      steps: state.steps.map((s) => s.name === e.stepName ? { ...s, status: "completed" as const, detail: e.detail } : s),
    }));

    this._registerEventHandler(WorkflowStepFailed, (state, e) => ({
      ...state,
      currentStep: null,
      steps: state.steps.map((s) => s.name === e.stepName ? { ...s, status: "failed" as const, detail: e.error } : s),
    }));

    this._registerEventHandler(WorkflowStepSkipped, (state, e) => ({
      ...state,
      steps: [...state.steps, { name: e.stepName, status: "skipped" as const, detail: e.reason }],
    }));

    this._registerEventHandler(WorkflowExecutionCompleted, (state, _e) => ({
      ...state,
      status: "completed" as const,
      currentStep: null,
    }));

    this._registerEventHandler(WorkflowExecutionFailed, (state, _e) => ({
      ...state,
      status: "failed" as const,
      currentStep: null,
    }));
  }
}
