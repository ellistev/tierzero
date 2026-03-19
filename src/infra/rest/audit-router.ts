/**
 * Audit REST API.
 *
 * GET /api/audit        - query audit trail (filter by action, actor, target, date range)
 * GET /api/audit/export - download full audit log
 */

import { Router } from "express";
import type { AuditTrail } from "../audit";

export interface AuditRouterDeps {
  audit: AuditTrail;
}

export function auditRouter(deps: AuditRouterDeps): Router {
  const { audit } = deps;
  const api = Router();

  // GET /api/audit - query audit trail
  api.get("/api/audit", (req, res) => {
    const action = req.query.action as string | undefined;
    const actor = req.query.actor as string | undefined;
    const target = req.query.target as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const entries = audit.query({ action, actor, target, from, to, limit, offset });
    res.json(entries);
  });

  // GET /api/audit/export - download full audit log
  api.get("/api/audit/export", (_req, res) => {
    const raw = audit.readRaw();
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Content-Disposition", "attachment; filename=audit.log");
    res.send(raw);
  });

  return api;
}
