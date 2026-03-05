/**
 * Azure Application Insights integration.
 * Executes KQL queries via Azure CLI.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export const APP_INSIGHTS_APP_ID = "3c39e0b5-8be0-444f-9563-1fbbcb3a447f";
export const SUBSCRIPTION = "SGI-INS-PRD";

// ---------------------------------------------------------------------------
// KQL Templates
// ---------------------------------------------------------------------------

export const KQL_JOB_TO_TRANSACTION = `let targetJobNumber = "TARGET_JOB";
customEvents
| where cloud_RoleName == "AF.VehicleRegistration.ACL.Host-prd"
| where timestamp >= datetime(2025-11-01 06:00:00.00)
| where name == "RegistrationTransactionIssuedIntegrationEventV3"
| extend EventData = todynamic(tostring(customDimensions.EventData))
| mv-expand quote = EventData.quotes
| extend QuoteNumber = tostring(quote.guidewireJobReference.jobNumber)
| where QuoteNumber == targetJobNumber
| project
    RequestTime              = timestamp,
    QuoteNumber,
    RegistrationId           = tostring(EventData.registrationId),
    RegistrationTransactionId= tostring(EventData.registrationTransactionId),
    TransactionType          = tostring(EventData.transactionType),
    EventData
| order by RequestTime desc`;

export const KQL_REG_TO_TRANSACTION = `let targetRegistrationId = "TARGET_REG_ID";
customEvents
| where cloud_RoleName == "AF.VehicleRegistration.ACL.Host-prd"
| where timestamp >= datetime(2025-11-01 06:00:00.00)
| where name == "RegistrationTransactionIssuedIntegrationEventV3"
| extend EventData = todynamic(tostring(customDimensions.EventData))
| where tostring(EventData.registrationId) == targetRegistrationId
| project
    RequestTime              = timestamp,
    RegistrationId           = tostring(EventData.registrationId),
    RegistrationTransactionId= tostring(EventData.registrationTransactionId),
    TransactionType          = tostring(EventData.transactionType)
| order by RequestTime desc
| take 1`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KqlResult {
  registrationTransactionId: string;
  quoteNumber: string;
  time: string;
  registrationId?: string;
  transactionType?: string;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

/**
 * Execute a KQL query against App Insights via az CLI.
 * Writes query to temp file to avoid shell escaping issues.
 */
export function executeKql(query: string, options?: { offsetDays?: number }): Record<string, unknown>[] {
  const offset = options?.offsetDays ?? 90;

  execSync(`az account set --subscription "${SUBSCRIPTION}"`, { stdio: "pipe" });

  const tmpFile = path.join(process.cwd(), `_tmp_query_${Date.now()}.kql`);
  fs.writeFileSync(tmpFile, query, "utf-8");

  try {
    const result = execSync(
      `az monitor app-insights query --app "${APP_INSIGHTS_APP_ID}" --analytics-query @${tmpFile} --offset ${offset}d --output json`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: "cmd.exe" }
    );

    const data = JSON.parse(result);
    if (!data.tables || data.tables.length === 0 || data.tables[0].rows.length === 0) {
      return [];
    }

    const table = data.tables[0];
    const columns: string[] = table.columns.map((c: { name: string }) => c.name);
    return table.rows.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, idx) => { obj[col] = row[idx]; });
      return obj;
    });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Look up RegistrationTransactionId from a job number.
 */
export function queryByJobNumber(jobNumber: string): KqlResult | null {
  const query = KQL_JOB_TO_TRANSACTION.replace("TARGET_JOB", jobNumber);
  const rows = executeKql(query);

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    registrationTransactionId: r.RegistrationTransactionId as string,
    quoteNumber: r.QuoteNumber as string,
    time: r.RequestTime as string,
    registrationId: r.RegistrationId as string,
    transactionType: r.TransactionType as string,
    raw: r,
  };
}

/**
 * Look up RegistrationTransactionId from a registration ID.
 */
export function queryByRegistrationId(registrationId: string): KqlResult | null {
  const query = KQL_REG_TO_TRANSACTION.replace("TARGET_REG_ID", registrationId);
  const rows = executeKql(query);

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    registrationTransactionId: r.RegistrationTransactionId as string,
    quoteNumber: "",
    time: r.RequestTime as string,
    registrationId: r.RegistrationId as string,
    transactionType: r.TransactionType as string,
    raw: r,
  };
}
