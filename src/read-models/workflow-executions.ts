/**
 * Workflow Executions Read Model
 * Projected from workflow execution events
 */

interface BuilderEventData {
  streamId: string;
  eventNumber: number;
  position: unknown;
  event: unknown;
  eventId: string;
  typeId: string;
  creationTime: number;
  metadata: Record<string, unknown>;
}

interface TransactionalRepository<T> {
  create_v2(record: T): void;
  updateOne(filter: Partial<T>, update: Partial<T>): void;
  findOne_v2(filter: Partial<T>): Promise<T | null>;
}

export interface WorkflowExecutionRecord {
  executionId: string;
  ticketId: string;
  workflowId: string;
  status: string;
  steps: string;
  summary: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

export const workflowExecutionsReadModel = {
  name: "workflow_executions",
  config: {
    key: "executionId",
    indexes: ["ticketId", "workflowId", "status"],
    schema: {
      executionId: { type: "string", nullable: false, maxLength: 128 },
      ticketId: { type: "string", nullable: false, maxLength: 64 },
      workflowId: { type: "string", nullable: false, maxLength: 64 },
      status: { type: "string", nullable: false, maxLength: 32 },
      steps: { type: "string", nullable: true },
      summary: { type: "string", nullable: true },
      error: { type: "string", nullable: true },
      startedAt: { type: "string", nullable: false },
      completedAt: { type: "string", nullable: true },
      failedAt: { type: "string", nullable: true },
    },
  },
  lookups: {},
  async handler(repo: TransactionalRepository<WorkflowExecutionRecord>, eventData: BuilderEventData) {
    const { typeId, event } = eventData;
    const e = event as Record<string, unknown>;

    switch (typeId) {
      case "WorkflowExecutionStarted":
        repo.create_v2({
          executionId: e.executionId as string,
          ticketId: e.ticketId as string,
          workflowId: e.workflowId as string,
          status: "running",
          steps: "[]",
          summary: null,
          error: null,
          startedAt: e.startedAt as string,
          completedAt: null,
          failedAt: null,
        });
        break;
      case "WorkflowStepStarted": {
        const exec = await repo.findOne_v2({ executionId: e.executionId as string });
        if (exec) {
          const steps = JSON.parse(exec.steps || "[]") as Array<Record<string, unknown>>;
          steps.push({ name: e.stepName, status: "started", detail: e.detail });
          repo.updateOne({ executionId: e.executionId as string }, { steps: JSON.stringify(steps) });
        }
        break;
      }
      case "WorkflowStepCompleted": {
        const exec = await repo.findOne_v2({ executionId: e.executionId as string });
        if (exec) {
          const steps = JSON.parse(exec.steps || "[]") as Array<Record<string, unknown>>;
          const idx = steps.findIndex((s) => s.name === e.stepName);
          if (idx >= 0) steps[idx] = { ...steps[idx], status: "completed", detail: e.detail };
          repo.updateOne({ executionId: e.executionId as string }, { steps: JSON.stringify(steps) });
        }
        break;
      }
      case "WorkflowStepFailed": {
        const exec = await repo.findOne_v2({ executionId: e.executionId as string });
        if (exec) {
          const steps = JSON.parse(exec.steps || "[]") as Array<Record<string, unknown>>;
          const idx = steps.findIndex((s) => s.name === e.stepName);
          if (idx >= 0) steps[idx] = { ...steps[idx], status: "failed", detail: e.error };
          repo.updateOne({ executionId: e.executionId as string }, { steps: JSON.stringify(steps) });
        }
        break;
      }
      case "WorkflowStepSkipped": {
        const exec = await repo.findOne_v2({ executionId: e.executionId as string });
        if (exec) {
          const steps = JSON.parse(exec.steps || "[]") as Array<Record<string, unknown>>;
          steps.push({ name: e.stepName, status: "skipped", detail: e.reason });
          repo.updateOne({ executionId: e.executionId as string }, { steps: JSON.stringify(steps) });
        }
        break;
      }
      case "WorkflowExecutionCompleted":
        repo.updateOne({ executionId: e.executionId as string }, {
          status: "completed",
          summary: e.summary as string,
          completedAt: e.completedAt as string,
        });
        break;
      case "WorkflowExecutionFailed":
        repo.updateOne({ executionId: e.executionId as string }, {
          status: "failed",
          error: e.error as string,
          failedAt: e.failedAt as string,
        });
        break;
    }
  },
};
