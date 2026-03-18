import { Router } from "express";
import type { PipelineRunStore, PipelineRunRecord } from "../../read-models/pipeline-run";

export function pipelineRunsRouter(store: PipelineRunStore): Router {
  const router = Router();

  router.get("/api/pipeline-runs", (req, res) => {
    const status = req.query.status as PipelineRunRecord['status'] | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const runs = store.list({ status, limit, offset });
    res.json(runs);
  });

  router.get("/api/pipeline-runs/:pipelineId", (req, res) => {
    const run = store.get(req.params.pipelineId);
    if (!run) {
      res.status(404).json({ message: "Pipeline run not found" });
      return;
    }
    res.json(run);
  });

  return router;
}
