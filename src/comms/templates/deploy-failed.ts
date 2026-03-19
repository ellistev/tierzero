import type { CommMessage } from "../channel";

export function deployFailed(data: { environment: string; error: string; rolledBack: boolean }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] Deploy Failed: ${data.environment}`,
    body: `Deploy to ${data.environment} FAILED: ${data.error}. Rolled back: ${data.rolledBack}`,
    priority: "high",
  };
}
