import type { CommMessage } from "../channel";

export function taskFailed(data: { title: string; taskId: string; error: string; retryCount: number; maxRetries: number }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] Task Failed: ${data.title}`,
    body: `Task "${data.title}" failed after ${data.retryCount}/${data.maxRetries} retries.\n\nError: ${data.error}\n\nTask ID: ${data.taskId}`,
    priority: "high",
  };
}
