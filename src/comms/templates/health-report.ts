import type { CommMessage } from "../channel";

export function healthReport(data: { channels: { name: string; ok: boolean; error?: string }[]; timestamp: string }): CommMessage {
  const lines = data.channels.map(ch =>
    `  ${ch.ok ? "OK" : "FAIL"} - ${ch.name}${ch.error ? ` (${ch.error})` : ""}`
  );
  const allOk = data.channels.every(ch => ch.ok);

  return {
    to: [],
    subject: `[TierZero] Health Report: ${allOk ? "All Systems OK" : "Issues Detected"}`,
    body: `System Health Report (${data.timestamp})\n\nChannels:\n${lines.join("\n")}\n\nOverall: ${allOk ? "Healthy" : "Degraded"}`,
    priority: allOk ? "low" : "high",
  };
}
