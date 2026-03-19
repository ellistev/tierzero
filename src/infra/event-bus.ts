import { EventEmitter } from "events";
import type { Scheduler } from "../scheduler/scheduler";

/**
 * Central event bus that connects domain event producers (Scheduler, Supervisor, etc.)
 * to consumers (read models, metrics, monitoring).
 */
export class EventBus extends EventEmitter {
  private connectedScheduler: Scheduler | null = null;

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
