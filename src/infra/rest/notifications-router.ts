import { Router } from "express";
import type { NotificationStore, NotificationRecord } from "../../read-models/notifications";
import type { NotificationManager, NotificationRule } from "../../comms/notification-manager";

export interface NotificationsRouterDeps {
  store: NotificationStore;
  manager: NotificationManager;
}

export function notificationsRouter(deps: NotificationsRouterDeps): Router {
  const { store, manager } = deps;
  const router = Router();

  // GET /api/notifications - list notifications
  router.get("/api/notifications", (req, res) => {
    const channelName = req.query.channel as string | undefined;
    const status = req.query.status as NotificationRecord['status'] | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const records = store.list({ channelName, status, limit, offset });
    res.json(records);
  });

  // GET /api/notifications/rules - list notification rules
  router.get("/api/notifications/rules", (_req, res) => {
    res.json(manager.getRules());
  });

  // POST /api/notifications/rules - create notification rule
  router.post("/api/notifications/rules", (req, res) => {
    const body = req.body as Partial<NotificationRule>;
    if (!body.id || !body.trigger || !body.channels || !body.template) {
      res.status(400).json({ message: "Missing required fields: id, trigger, channels, template" });
      return;
    }

    const rule: NotificationRule = {
      id: body.id,
      trigger: body.trigger,
      filter: body.filter,
      channels: body.channels,
      template: body.template,
      enabled: body.enabled ?? true,
    };

    manager.addRule(rule);
    res.status(201).json(rule);
  });

  // POST /api/notifications/send - send ad-hoc notification
  router.post("/api/notifications/send", async (req, res) => {
    const { channel, message } = req.body as { channel?: string; message?: unknown };
    if (!channel || !message) {
      res.status(400).json({ message: "Missing required fields: channel, message" });
      return;
    }

    const result = await manager.send(channel, message as Parameters<typeof manager.send>[1]);
    res.status(result.success ? 200 : 502).json(result);
  });

  // GET /api/notifications/channels - list channels with health
  router.get("/api/notifications/channels", async (_req, res) => {
    const channels = manager.getChannels();
    const results = await Promise.all(
      channels.map(async ch => {
        const health = await ch.healthCheck();
        return {
          name: ch.name,
          type: ch.type,
          ...health,
        };
      })
    );
    res.json(results);
  });

  return router;
}
