import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { TaskAggregate } from "../domain/task/TaskAggregate";
import { SubmitTask, AssignTask, StartTask, CompleteTask, FailTask, EscalateTask, RetryTask } from "../domain/task/commands";
import type { TaskEvent } from "../domain/task/events";
import { AgentRegistry, type TaskSource, type NormalizedTask, type TaskResult } from "./agent-registry";

export interface TaskRouterConfig {
  registry: AgentRegistry;
  maxRetries?: number;
  logger?: { log: (msg: string) => void; error: (msg: string) => void };
}

const defaultLogger = {
  log: (msg: string) => console.log(`[task-router] ${msg}`),
  error: (msg: string) => console.error(`[task-router] ${msg}`),
};

/**
 * Central orchestrator that accepts TaskSource from any adapter,
 * normalizes to NormalizedTask, routes to agents, and tracks lifecycle.
 */
export class TaskRouter extends EventEmitter {
  private readonly registry: AgentRegistry;
  private readonly maxRetries: number;
  private readonly logger: { log: (msg: string) => void; error: (msg: string) => void };
  private readonly aggregates = new Map<string, TaskAggregate>();
  private readonly tasks = new Map<string, NormalizedTask>();
  private readonly priorityQueue: string[] = []; // taskIds ordered by priority

  constructor(config: TaskRouterConfig) {
    super();
    this.registry = config.registry;
    this.maxRetries = config.maxRetries ?? 3;
    this.logger = config.logger ?? defaultLogger;
  }

  /** Submit a new task from any source */
  submit(source: TaskSource, title: string, description: string, category: NormalizedTask['category']): NormalizedTask {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const priority = source.priority ?? "normal";

    const aggregate = new TaskAggregate();
    const events = aggregate.execute(new SubmitTask(
      taskId, source.type, source.id, source.payload,
      source.receivedAt, priority, source.metadata,
      title, description, category, now
    )) as TaskEvent[];

    for (const event of events) {
      aggregate.hydrate(event);
      this.emit("event", event);
    }

    this.aggregates.set(taskId, aggregate);

    const task: NormalizedTask = {
      taskId,
      source,
      title,
      description,
      category,
      priority: priority as NormalizedTask['priority'],
      assignedAgent: null,
      status: "queued",
      createdAt: now,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      retryCount: 0,
      maxRetries: this.maxRetries,
    };

    this.tasks.set(taskId, task);
    this.enqueue(taskId, task.priority);
    this.logger.log(`Task submitted: ${taskId} [${category}] "${title}"`);

    // Try to route immediately
    this.tryRoute(taskId);

    return task;
  }

  /** Get a task by ID */
  getTask(taskId: string): NormalizedTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Retry a failed task */
  retry(taskId: string): NormalizedTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.status !== "failed") return null;

    const aggregate = this.aggregates.get(taskId);
    if (!aggregate) return null;

    const retryCount = task.retryCount + 1;
    const now = new Date().toISOString();

    const events = aggregate.execute(new RetryTask(taskId, retryCount, now)) as TaskEvent[];
    for (const event of events) {
      aggregate.hydrate(event);
      this.emit("event", event);
    }

    task.status = "queued";
    task.retryCount = retryCount;
    task.error = null;
    task.completedAt = null;
    task.assignedAgent = null;
    task.startedAt = null;
    task.result = null;

    this.enqueue(taskId, task.priority);
    this.logger.log(`Task retried: ${taskId} (attempt ${retryCount})`);

    this.tryRoute(taskId);
    return task;
  }

  /** Try to route a queued task to an available agent */
  private tryRoute(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "queued") return;

    const agent = this.registry.findAgent(task.category);
    if (!agent) return;

    const aggregate = this.aggregates.get(taskId)!;
    const now = new Date().toISOString();

    // Assign
    const assignEvents = aggregate.execute(new AssignTask(taskId, agent.name, now)) as TaskEvent[];
    for (const event of assignEvents) {
      aggregate.hydrate(event);
      this.emit("event", event);
    }
    task.status = "assigned";
    task.assignedAgent = agent.name;

    // Start
    const startEvents = aggregate.execute(new StartTask(taskId, now)) as TaskEvent[];
    for (const event of startEvents) {
      aggregate.hydrate(event);
      this.emit("event", event);
    }
    task.status = "running";
    task.startedAt = now;

    this.registry.markRunning(agent.name);
    this.removeFromQueue(taskId);

    this.logger.log(`Task ${taskId} assigned to ${agent.name}, starting execution`);

    // Execute asynchronously
    this.executeTask(task, agent).catch((err) => {
      this.logger.error(`Unexpected error executing task ${taskId}: ${err}`);
    });
  }

  private async executeTask(task: NormalizedTask, agent: { name: string; execute: (t: NormalizedTask) => Promise<TaskResult> }): Promise<void> {
    const aggregate = this.aggregates.get(task.taskId)!;

    try {
      const result = await agent.execute(task);
      const now = new Date().toISOString();

      if (result.success) {
        const events = aggregate.execute(new CompleteTask(task.taskId, result.output, now)) as TaskEvent[];
        for (const event of events) {
          aggregate.hydrate(event);
          this.emit("event", event);
        }
        task.status = "completed";
        task.result = result.output;
        task.completedAt = now;
        this.logger.log(`Task ${task.taskId} completed successfully`);
      } else {
        const events = aggregate.execute(new FailTask(task.taskId, result.error ?? "Unknown error", now)) as TaskEvent[];
        for (const event of events) {
          aggregate.hydrate(event);
          this.emit("event", event);
        }
        task.status = "failed";
        task.error = result.error ?? "Unknown error";
        task.completedAt = now;
        this.logger.log(`Task ${task.taskId} failed: ${task.error}`);

        this.handleFailure(task);
      }
    } catch (err) {
      const now = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const events = aggregate.execute(new FailTask(task.taskId, errorMsg, now)) as TaskEvent[];
      for (const event of events) {
        aggregate.hydrate(event);
        this.emit("event", event);
      }
      task.status = "failed";
      task.error = errorMsg;
      task.completedAt = now;
      this.logger.error(`Task ${task.taskId} threw: ${errorMsg}`);

      this.handleFailure(task);
    } finally {
      this.registry.markDone(agent.name);
    }
  }

  private handleFailure(task: NormalizedTask): void {
    if (task.retryCount < task.maxRetries) {
      this.retry(task.taskId);
    } else {
      // Escalate
      const aggregate = this.aggregates.get(task.taskId)!;
      const now = new Date().toISOString();

      // Task is in 'failed' state, need to retry first then escalate?
      // Actually escalate can happen from failed state per our aggregate
      const events = aggregate.execute(new EscalateTask(
        task.taskId,
        `Max retries (${task.maxRetries}) exceeded. Last error: ${task.error}`,
        now
      )) as TaskEvent[];
      for (const event of events) {
        aggregate.hydrate(event);
        this.emit("event", event);
      }
      task.status = "escalated";
      task.completedAt = now;
      this.logger.error(`Task ${task.taskId} escalated after ${task.maxRetries} retries`);
    }
  }

  /** Drain the queue: try to route all queued tasks */
  drainQueue(): void {
    for (const taskId of [...this.priorityQueue]) {
      this.tryRoute(taskId);
    }
  }

  private enqueue(taskId: string, priority: NormalizedTask['priority']): void {
    const rank = { critical: 0, high: 1, normal: 2, low: 3 };
    const taskRank = rank[priority] ?? 2;
    let insertIdx = this.priorityQueue.length;
    for (let i = 0; i < this.priorityQueue.length; i++) {
      const existingTask = this.tasks.get(this.priorityQueue[i]);
      if (existingTask) {
        const existingRank = rank[existingTask.priority] ?? 2;
        if (taskRank < existingRank) {
          insertIdx = i;
          break;
        }
      }
    }
    this.priorityQueue.splice(insertIdx, 0, taskId);
  }

  private removeFromQueue(taskId: string): void {
    const idx = this.priorityQueue.indexOf(taskId);
    if (idx !== -1) this.priorityQueue.splice(idx, 1);
  }
}
