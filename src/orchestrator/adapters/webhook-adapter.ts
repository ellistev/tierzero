import express from "express";
import type { Server } from "http";
import type { InputAdapter } from "./types";
import type { TaskSource } from "../agent-registry";

export interface WebhookAdapterConfig {
  port?: number;
}

/**
 * Express endpoint POST /api/tasks that accepts arbitrary JSON
 * and converts it to TaskSource.
 */
export class WebhookAdapter implements InputAdapter {
  readonly name = "webhook";
  onTask: (source: TaskSource) => void = () => {};

  private readonly port: number;
  private server: Server | null = null;
  private app = express();

  constructor(config: WebhookAdapterConfig) {
    this.port = config.port ?? 3500;
    this.app.use(express.json());

    this.app.post("/api/tasks", (req, res) => {
      const body = req.body ?? {};
      const source: TaskSource = {
        type: (body.type as TaskSource['type']) ?? "webhook",
        id: body.id ?? `webhook-${Date.now()}`,
        payload: body.payload ?? body,
        receivedAt: new Date().toISOString(),
        priority: body.priority,
        metadata: body.metadata,
      };

      this.onTask(source);
      res.status(202).json({ accepted: true, sourceId: source.id });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Expose Express app for testing / composition with existing server */
  getApp() {
    return this.app;
  }
}
