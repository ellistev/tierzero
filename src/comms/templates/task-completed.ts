import type { CommMessage } from "../channel";

export function taskCompleted(data: { title: string; taskId: string; result: string; durationMs: number }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] Task Completed: ${data.title}`,
    body: `Task "${data.title}" completed successfully in ${Math.round(data.durationMs / 1000)}s.\n\nResult: ${data.result}\n\nTask ID: ${data.taskId}`,
  };
}
