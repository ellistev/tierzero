import { Router } from "express";
import type { AgentProcessStore, AgentProcessRecord } from "../../read-models/agent-processes";
import type { AgentSupervisor } from "../../orchestrator/supervisor";

export interface SupervisorRouterDeps {
  store: AgentProcessStore;
  supervisor: AgentSupervisor;
}

export function supervisorRouter(deps: SupervisorRouterDeps): Router {
  const { store, supervisor } = deps;
  const router = Router();

  // GET /api/agents/processes - list all agent processes
  router.get("/api/agents/processes", (req, res) => {
    const status = req.query.status as AgentProcessRecord['status'] | undefined;
    const agentName = req.query.agentName as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const processes = store.list({ status, agentName, limit });
    res.json(processes);
  });

  // GET /api/agents/processes/:processId - single process details with output buffer
  router.get("/api/agents/processes/:processId", (req, res) => {
    const record = store.get(req.params.processId);
    if (!record) {
      res.status(404).json({ message: "Agent process not found" });
      return;
    }
    // Attach live output from supervisor if available
    const liveProcess = supervisor.getProcess(req.params.processId);
    const output = liveProcess?.output ?? [];
    res.json({ ...record, output });
  });

  // POST /api/agents/processes/:processId/kill - force-kill a running agent
  router.post("/api/agents/processes/:processId/kill", async (req, res) => {
    const killed = await supervisor.killAgent(req.params.processId, "killed via API");
    if (!killed) {
      res.status(404).json({ message: "Agent process not found or not running" });
      return;
    }
    res.json({ message: "Agent killed" });
  });

  // GET /api/agents/utilization - current utilization summary
  router.get("/api/agents/utilization", (_req, res) => {
    const utilization = store.utilization();
    const concurrency = supervisor.concurrency.utilization();
    res.json({ ...utilization, concurrency });
  });

  return router;
}
