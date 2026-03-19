import { EventEmitter } from "events";
import type { Scheduler } from "../scheduler/scheduler";
import type { TaskRouter } from "../orchestrator/task-router";
import type { AgentSupervisor } from "../orchestrator/supervisor";

/**
 * Central event bus that connects domain event producers (Scheduler, Supervisor, etc.)
 * to consumers (read models, metrics, monitoring).
 */
export class EventBus extends EventEmitter {
  private connectedScheduler: Scheduler | null = null;
  private connectedRouter: TaskRouter | null = null;
  private connectedSupervisor: AgentSupervisor | null = null;

  /** Subscribe a handler to all events of a given type */
  subscribe(eventType: string, handler: (data: unknown) => void): void {
    this.on("event", (event) => {
      const typeName = event?.constructor?.type ?? event?.type;
      if (typeName === eventType) {
        handler(event);
      }
    });
  }

  /** Publish an event from any subsystem */
  publish(eventType: string, data: unknown): void {
    this.emit(eventType, data);
    this.emit("event", data);
  }

  /** Forward all TaskRouter domain events through the bus */
  connectRouter(router: TaskRouter): void {
    this.connectedRouter = router;
    router.on("event", (event) => {
      this.emit("router:event", event);
      this.emit("event", event);
    });
  }

  disconnectRouter(): void {
    if (this.connectedRouter) {
      this.connectedRouter.removeAllListeners("event");
      this.connectedRouter = null;
    }
  }

  /** Forward all Supervisor domain events through the bus */
  connectSupervisor(supervisor: AgentSupervisor): void {
    this.connectedSupervisor = supervisor;
    supervisor.on("event", (event) => {
      this.emit("supervisor:event", event);
      this.emit("event", event);
    });
  }

  disconnectSupervisor(): void {
    if (this.connectedSupervisor) {
      this.connectedSupervisor.removeAllListeners("event");
      this.connectedSupervisor = null;
    }
  }

  /** Forward all Scheduler domain events through the bus */
  connectScheduler(scheduler: Scheduler): void {
    this.connectedScheduler = scheduler;
    scheduler.on("event", (event) => {
      this.emit("scheduler:event", event);
      this.emit("event", event);
    });
  }

  disconnectScheduler(): void {
    if (this.connectedScheduler) {
      this.connectedScheduler.removeAllListeners("event");
      this.connectedScheduler = null;
    }
  }
}
