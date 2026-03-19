import { Router } from "express";
import type { ScheduledJobStore } from "../../read-models/scheduled-jobs";
import type { Scheduler } from "../../scheduler/scheduler";
import { nextRun } from "../../scheduler/cron";

export interface SchedulerRouterDeps {
  store: ScheduledJobStore;
  scheduler: Scheduler;
}

export function schedulerRouter(deps: SchedulerRouterDeps): Router {
  const { store, scheduler } = deps;
  const api = Router();

  // GET /api/scheduler/jobs - list all jobs with next run time
  api.get("/api/scheduler/jobs", (req, res) => {
    const enabled = req.query.enabled !== undefined
      ? req.query.enabled === "true"
      : undefined;
    const category = req.query.category as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const jobs = store.list({ enabled, category, limit, offset });
    res.json(jobs);
  });

  // GET /api/scheduler/jobs/:jobId - job details with run history
  api.get("/api/scheduler/jobs/:jobId", (req, res) => {
    const job = store.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    res.json(job);
  });

  // POST /api/scheduler/jobs - register a new job
  api.post("/api/scheduler/jobs", (req, res) => {
    const body = req.body ?? {};
    if (!body.id || !body.name || !body.schedule || !body.taskTemplate) {
      res.status(400).json({ message: "id, name, schedule, and taskTemplate are required" });
      return;
    }
    scheduler.addJob({
      id: body.id,
      name: body.name,
      description: body.description ?? "",
      schedule: body.schedule,
      timezone: body.timezone ?? "UTC",
      taskTemplate: body.taskTemplate,
      enabled: body.enabled ?? true,
      maxConcurrent: body.maxConcurrent ?? 1,
      catchUp: body.catchUp ?? false,
      maxConsecutiveFailures: body.maxConsecutiveFailures ?? 5,
    });
    const job = scheduler.getJob(body.id);
    res.status(201).json(job);
  });

  // PUT /api/scheduler/jobs/:jobId - update job
  api.put("/api/scheduler/jobs/:jobId", (req, res) => {
    const job = scheduler.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    const body = req.body ?? {};
    if (body.enabled === true && !job.enabled) {
      scheduler.enableJob(req.params.jobId);
    } else if (body.enabled === false && job.enabled) {
      scheduler.disableJob(req.params.jobId);
    }
    const updated = scheduler.getJob(req.params.jobId);
    res.json(updated);
  });

  // DELETE /api/scheduler/jobs/:jobId - remove job
  api.delete("/api/scheduler/jobs/:jobId", (req, res) => {
    const job = scheduler.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    scheduler.removeJob(req.params.jobId);
    res.status(204).end();
  });

  // POST /api/scheduler/jobs/:jobId/run - force-run a job now
  api.post("/api/scheduler/jobs/:jobId/run", async (req, res) => {
    try {
      await scheduler.runNow(req.params.jobId);
      res.json({ message: "Job triggered" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(404).json({ message });
    }
  });

  // GET /api/scheduler/upcoming - next 10 scheduled job triggers
  api.get("/api/scheduler/upcoming", (_req, res) => {
    const jobs = scheduler.listJobs().filter(j => j.enabled && j.nextRunAt);
    const upcoming: { jobId: string; name: string; nextRunAt: string }[] = [];

    for (const job of jobs) {
      // Get next few runs for this job
      let after = new Date();
      after.setUTCMinutes(after.getUTCMinutes() - 1); // start from now
      for (let i = 0; i < 3; i++) {
        try {
          const next = nextRun(job.schedule, after);
          upcoming.push({ jobId: job.id, name: job.name, nextRunAt: next.toISOString() });
          after = next;
        } catch { break; }
      }
    }

    upcoming.sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
    res.json(upcoming.slice(0, 10));
  });

  return api;
}
