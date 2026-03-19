import type { CommMessage } from "../channel";

export function agentHung(data: { agentName: string; taskId: string; lastHeartbeat: string }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] Agent Hung: ${data.agentName}`,
    body: `Agent "${data.agentName}" has stopped responding.\n\nLast heartbeat: ${data.lastHeartbeat}\nTask ID: ${data.taskId}`,
    priority: "high",
  };
}
