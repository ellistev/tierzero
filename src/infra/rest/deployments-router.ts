import { Router } from "express";
import type { DeploymentStore, DeploymentRecord } from "../../read-models/deployments";
import type { Deployer, DeployConfig } from "../../deploy/deployer";

export interface DeploymentsRouterDeps {
  store: DeploymentStore;
  deployer?: Deployer;
}

export function deploymentsRouter(deps: DeploymentsRouterDeps): Router {
  const { store, deployer } = deps;
  const router = Router();

  // GET /api/deployments - list deployments
  router.get("/api/deployments", (req, res) => {
    const environment = req.query.environment as string | undefined;
    const status = req.query.status as DeploymentRecord['status'] | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const records = store.list({ environment, status, limit, offset });
    res.json(records);
  });

  // GET /api/deployments/:deployId - single deploy details
  router.get("/api/deployments/:deployId", (req, res) => {
    const record = store.get(req.params.deployId);
    if (!record) {
      res.status(404).json({ message: "Deployment not found" });
      return;
    }
    res.json(record);
  });

  // POST /api/deployments - trigger a deployment
  router.post("/api/deployments", async (req, res) => {
    if (!deployer) {
      res.status(501).json({ message: "No deployer configured" });
      return;
    }

    const { environment, version, config } = req.body as {
      environment?: string;
      version?: string;
      config?: DeployConfig;
    };

    if (!environment || !version) {
      res.status(400).json({ message: "Missing required fields: environment, version" });
      return;
    }

    const deployConfig: DeployConfig = {
      strategy: config?.strategy ?? 'direct',
      rollbackOnFailure: config?.rollbackOnFailure ?? true,
      ...config,
    };

    const result = await deployer.deploy({ environment, version, config: deployConfig });
    res.status(result.success ? 201 : 502).json(result);
  });

  // POST /api/deployments/:deployId/rollback - trigger rollback
  router.post("/api/deployments/:deployId/rollback", async (req, res) => {
    if (!deployer) {
      res.status(501).json({ message: "No deployer configured" });
      return;
    }

    try {
      const result = await deployer.rollback(req.params.deployId);
      res.json(result);
    } catch (err) {
      res.status(404).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/deployments/environments/:env/status - environment status
  router.get("/api/deployments/environments/:env/status", async (req, res) => {
    if (!deployer) {
      const records = store.getByEnvironment(req.params.env);
      const latest = records[records.length - 1];
      if (!latest) {
        res.status(404).json({ message: "No deployments found for this environment" });
        return;
      }
      res.json({
        environment: req.params.env,
        currentVersion: latest.version,
        previousVersion: "",
        lastDeployedAt: latest.initiatedAt,
        healthy: latest.status === "succeeded",
      });
      return;
    }

    const status = await deployer.status(req.params.env);
    res.json(status);
  });

  return router;
}
