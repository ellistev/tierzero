import { Aggregate } from "../../infra/aggregate";
import { SubmitTask, AssignTask, StartTask, CompleteTask, FailTask, EscalateTask, RetryTask } from "./commands";
import { TaskSubmitted, TaskAssigned, TaskStarted, TaskCompleted, TaskFailed, TaskEscalated, TaskRetried } from "./events";

interface TaskState extends Record<string, unknown> {
  taskId: string;
  sourceType: string;
  sourceId: string;
  payload: unknown;
  receivedAt: string;
  priority: string;
  metadata: Record<string, unknown> | undefined;
  title: string;
  description: string;
  category: string;
  assignedAgent: string | null;
  status: "queued" | "assigned" | "running" | "completed" | "failed" | "escalated";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
}

export class TaskAggregate extends Aggregate<TaskState> {
  static type = "TaskAggregate" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(SubmitTask, (_state, cmd) => {
      return [new TaskSubmitted(
        cmd.taskId, cmd.sourceType, cmd.sourceId, cmd.payload,
        cmd.receivedAt, cmd.priority, cmd.metadata,
        cmd.title, cmd.description, cmd.category, cmd.createdAt
      )];
    });

    this._registerCommandHandler(AssignTask, (state, cmd) => {
      if (!state.taskId) throw new Error("Task does not exist");
      if (state.status !== "queued") throw new Error("Task not in queued state");
      return [new TaskAssigned(cmd.taskId, cmd.agentName, cmd.assignedAt)];
    });

    this._registerCommandHandler(StartTask, (state, cmd) => {
      if (!state.taskId) throw new Error("Task does not exist");
      if (state.status !== "assigned") throw new Error("Task not in assigned state");
      return [new TaskStarted(cmd.taskId, cmd.startedAt)];
    });

    this._registerCommandHandler(CompleteTask, (state, cmd) => {
      if (!state.taskId) throw new Error("Task does not exist");
      if (state.status !== "running") throw new Error("Task not in running state");
      return [new TaskCompleted(cmd.taskId, cmd.result, cmd.completedAt)];
    });

    this._registerCommandHandler(FailTask, (state, cmd) => {
      if (!state.taskId) throw new Error("Task does not exist");
      if (state.status !== "running") throw new Error("Task not in running state");
      return [new TaskFailed(cmd.taskId, cmd.error, cmd.failedAt)];
    });

    this._registerCommandHandler(EscalateTask, (state, cmd) => {
      if (!state.taskId) throw new Error("Task does not exist");
      if (state.status === "completed" || state.status === "escalated") throw new Error("Task already finished");
      return [new TaskEscalated(cmd.taskId, cmd.reason, cmd.escalatedAt)];
    });

    this._registerCommandHandler(RetryTask, (state, cmd) => {
      if (!state.taskId) throw new Error("Task does not exist");
      if (state.status !== "failed") throw new Error("Task not in failed state");
      return [new TaskRetried(cmd.taskId, cmd.retryCount, cmd.retriedAt)];
    });

    // Event handlers
    this._registerEventHandler(TaskSubmitted, (_state, e) => ({
      taskId: e.taskId,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      payload: e.payload,
      receivedAt: e.receivedAt,
      priority: e.priority,
      metadata: e.metadata,
      title: e.title,
      description: e.description,
      category: e.category,
      assignedAgent: null,
      status: "queued" as const,
      createdAt: e.createdAt,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      retryCount: 0,
      maxRetries: 3,
    }));

    this._registerEventHandler(TaskAssigned, (state, e) => ({
      ...state,
      status: "assigned" as const,
      assignedAgent: e.agentName,
    }));

    this._registerEventHandler(TaskStarted, (state, e) => ({
      ...state,
      status: "running" as const,
      startedAt: e.startedAt,
    }));

    this._registerEventHandler(TaskCompleted, (state, e) => ({
      ...state,
      status: "completed" as const,
      result: e.result,
      completedAt: e.completedAt,
    }));

    this._registerEventHandler(TaskFailed, (state, e) => ({
      ...state,
      status: "failed" as const,
      error: e.error,
      completedAt: e.failedAt,
    }));

    this._registerEventHandler(TaskEscalated, (state, e) => ({
      ...state,
      status: "escalated" as const,
      error: e.reason,
      completedAt: e.escalatedAt,
    }));

    this._registerEventHandler(TaskRetried, (state, e) => ({
      ...state,
      status: "queued" as const,
      retryCount: e.retryCount,
      error: null,
      completedAt: null,
      assignedAgent: null,
      startedAt: null,
      result: null,
    }));
  }
}
