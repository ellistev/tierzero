import type { CommMessage } from "../channel";

export function taskEscalated(data: { title: string; taskId: string; reason: string }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] Task Escalated: ${data.title}`,
    body: `Task "${data.title}" has been escalated and requires human attention.\n\nReason: ${data.reason}\n\nTask ID: ${data.taskId}`,
    priority: "high",
  };
}
