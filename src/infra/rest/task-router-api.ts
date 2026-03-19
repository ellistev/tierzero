import { Router } from "express";
import type { TaskQueueStore, TaskQueueRecord } from "../../read-models/task-queue";
import type { TaskRouter } from "../../orchestrator/task-router";
import type { AgentRegistry } from "../../orchestrator/agent-registry";

export interface TaskRouterApiDeps {
  store: TaskQueueStore;
  router: TaskRouter;
  registry: AgentRegistry;
}

export function taskRouterApi(deps: TaskRouterApiDeps): Router {
  const { store, router: taskRouter, registry } = deps;
  const api = Router();

  // GET /api/tasks - list tasks
  api.get("/api/tasks", (req, res) => {
    const status = req.query.status as TaskQueueRecord['status'] | undefined;
    const category = req.query.category as string | undefined;
    const priority = req.query.priority as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const tasks = store.list({ status, category, priority, limit, offset });
    res.json(tasks);
  });

  // GET /api/tasks/:taskId - single task
  api.get("/api/tasks/:taskId", (req, res) => {
    const task = store.get(req.params.taskId);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    res.json(task);
  });

  // POST /api/tasks - manual task submission
  api.post("/api/tasks", (req, res) => {
    const body = req.body ?? {};
    const title = body.title;
    const description = body.description ?? "";
    const category = body.category ?? "operations";
    const priority = body.priority ?? "normal";

    if (!title) {
      res.status(400).json({ message: "title is required" });
      return;
    }

    const source = {
      type: "manual" as const,
      id: `manual-${Date.now()}`,
      payload: body,
      receivedAt: new Date().toISOString(),
      priority: priority as 'critical' | 'high' | 'normal' | 'low',
      metadata: body.metadata,
    };

    const task = taskRouter.submit(source, title, description, category);
    res.status(201).json(task);
  });

  // POST /api/tasks/:taskId/retry - retry a failed task
  api.post("/api/tasks/:taskId/retry", (req, res) => {
    const task = taskRouter.retry(req.params.taskId);
    if (!task) {
      res.status(404).json({ message: "Task not found or not in failed state" });
      return;
    }
    res.json(task);
  });

  // GET /api/agents - list registered agents
  api.get("/api/agents", (_req, res) => {
    const agents = registry.listAgents();
    res.json(agents);
  });

  return api;
}
