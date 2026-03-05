import type { ReadModelDefinition, StoredEvent, ReadModelRepo } from "../infra/interfaces";

export const workflowExecutionsReadModel: ReadModelDefinition = {
  config: {
    table: "workflow_executions",
    key: "executionId",
    schema: {
      executionId: "TEXT PRIMARY KEY",
      ticketId: "TEXT",
      workflowId: "TEXT",
      status: "TEXT",
      steps: "TEXT",
      summary: "TEXT",
      error: "TEXT",
      startedAt: "TEXT",
      completedAt: "TEXT",
      failedAt: "TEXT",
    },
    indexes: [["ticketId"], ["workflowId"], ["status"]],
  },
  handler(repo: ReadModelRepo, event: StoredEvent) {
    const d = event.data;
    switch (event.type) {
      case "WorkflowExecutionStarted":
        repo.create({
          executionId: d.executionId,
          ticketId: d.ticketId,
          workflowId: d.workflowId,
          status: "running",
          steps: [],
          summary: null,
          error: null,
          startedAt: d.startedAt,
          completedAt: null,
          failedAt: null,
        });
        break;
      case "WorkflowStepStarted": {
        const exec = repo.findOne(d.executionId as string);
        if (exec) {
          const steps = (exec.steps as Array<Record<string, unknown>>) || [];
          steps.push({ name: d.stepName, status: "started", detail: d.detail });
          repo.updateOne(d.executionId as string, { steps });
        }
        break;
      }
      case "WorkflowStepCompleted": {
        const exec = repo.findOne(d.executionId as string);
        if (exec) {
          const steps = (exec.steps as Array<Record<string, unknown>>) || [];
          const idx = steps.findIndex((s) => s.name === d.stepName);
          if (idx >= 0) steps[idx] = { ...steps[idx], status: "completed", detail: d.detail };
          repo.updateOne(d.executionId as string, { steps });
        }
        break;
      }
      case "WorkflowStepFailed": {
        const exec = repo.findOne(d.executionId as string);
        if (exec) {
          const steps = (exec.steps as Array<Record<string, unknown>>) || [];
          const idx = steps.findIndex((s) => s.name === d.stepName);
          if (idx >= 0) steps[idx] = { ...steps[idx], status: "failed", detail: d.error };
          repo.updateOne(d.executionId as string, { steps });
        }
        break;
      }
      case "WorkflowStepSkipped": {
        const exec = repo.findOne(d.executionId as string);
        if (exec) {
          const steps = (exec.steps as Array<Record<string, unknown>>) || [];
          steps.push({ name: d.stepName, status: "skipped", detail: d.reason });
          repo.updateOne(d.executionId as string, { steps });
        }
        break;
      }
      case "WorkflowExecutionCompleted":
        repo.updateOne(d.executionId as string, { status: "completed", summary: d.summary, completedAt: d.completedAt });
        break;
      case "WorkflowExecutionFailed":
        repo.updateOne(d.executionId as string, { status: "failed", error: d.error, failedAt: d.failedAt });
        break;
    }
  },
};
