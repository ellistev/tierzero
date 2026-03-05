/**
 * Mock ServiceNow REST API server for TierZero demos.
 * 
 * Implements the exact endpoints that ServiceNowConnector calls,
 * returning data in the sysparm_display_value=all format.
 * 
 * Pre-populated with realistic tickets that match our knowledge base runbooks.
 */

import express from "express";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Types matching ServiceNow's sysparm_display_value=all format
// ---------------------------------------------------------------------------

interface SNField {
  value: string;
  display_value: string;
}

function field(value: string, displayValue?: string): SNField {
  return { value, display_value: displayValue ?? value };
}

// ---------------------------------------------------------------------------
// In-memory data store
// ---------------------------------------------------------------------------

interface StoredIncident {
  sys_id: SNField;
  number: SNField;
  short_description: SNField;
  description: SNField;
  state: SNField;
  priority: SNField;
  caller_id: SNField;
  assigned_to: SNField;
  assignment_group: SNField;
  sys_created_on: SNField;
  sys_updated_on: SNField;
  resolved_at: SNField;
  due_date: SNField;
  sys_class_name: SNField;
  [key: string]: unknown;
}

interface StoredJournal {
  sys_id: string;
  element: string; // "comments" or "work_notes"
  value: string;
  sys_created_by: string;
  sys_created_on: string;
  element_id: string; // the incident sys_id
}

interface StoredAttachment {
  sys_id: string;
  table_sys_id: string;
  file_name: string;
  content_type: string;
  size_bytes: string;
  content: string; // actual file content
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const REQUOTE_JSON_ATTACHMENT = JSON.stringify({
  quoteCompositeResponse: {
    responses: [{
      body: {
        data: {
          attributes: {
            jobNumber: "9087654",
            policyNumber: "POL-2026-44821",
            effectiveDate: "2026-03-01",
            expirationDate: "2027-03-01",
            totalPremium: 1847.50,
          }
        }
      }
    }]
  }
}, null, 2);

const incidents: StoredIncident[] = [
  // 1. Bind Failure - matches sgi-requote-rebind runbook
  {
    sys_id: field("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"),
    number: field("INC0098001"),
    short_description: field("Bind Failure - DRIVE Alerts - Vehicle Registration Quote"),
    description: field(
      `DRIVE Alert: Quote bind failure detected for vehicle registration.\n\n` +
      `Error Details:\n` +
      `{\n` +
      `  "ErrorCode": "GW-BIND-4401",\n` +
      `  "ErrorMessage": "Cannot access payment info for the specified quote. The quote binding process failed during payment validation.",\n` +
      `  "JobNumber": "7654321",\n` +
      `  "RegistrationId": "reg-2026-55192",\n` +
      `  "Timestamp": "2026-03-04T14:22:18Z",\n` +
      `  "Component": "AF.VehicleRegistration.ACL.Host-prd",\n` +
      `  "CorrelationId": "tx-8a4f2c1e-9b3d-4e7f-a5c8-6d2e1f3a4b5c"\n` +
      `}\n\n` +
      `The ACL Command Queue shows three failed commands:\n` +
      `- SendBoundQuoteToDrive: Failed\n` +
      `- SendPaymentRequestToInsurCloud: Failed\n` +
      `- SendPaymentToDrive: Failed\n\n` +
      `Customer: Jane Smith (REG-2026-55192)\n` +
      `Vehicle: 2024 Toyota RAV4, VIN: 2T3P1RFV8RC123456\n\n` +
      `Please investigate and resolve. JSON requote response attached.`
    ),
    state: field("1", "New"),
    priority: field("2", "High"),
    caller_id: field("user-jane-smith", "Jane Smith"),
    assigned_to: field("", ""),
    assignment_group: field("5cb024f787fd42507ba77597cebb3582", "DRIVE Alerts - Registration"),
    sys_created_on: field("2026-03-04 14:25:00"),
    sys_updated_on: field("2026-03-04 14:25:00"),
    resolved_at: field(""),
    due_date: field("2026-03-05 14:25:00"),
    sys_class_name: field("incident"),
  },

  // 2. Password Reset - matches password-reset runbook
  {
    sys_id: field("b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"),
    number: field("INC0098002"),
    short_description: field("Account Locked Out - Cannot Login"),
    description: field(
      `Hi IT Support,\n\n` +
      `I've been locked out of my account since this morning. I tried logging in ` +
      `multiple times with what I thought was my password but it kept failing. ` +
      `Now the system says my account is locked.\n\n` +
      `My username is jthompson@company.com\n` +
      `I need to access the registration system urgently for a customer appointment at 2pm.\n\n` +
      `Can someone please unlock my account and reset my password?\n\n` +
      `Thanks,\nJohn Thompson\nRegistration Clerk - Branch 42`
    ),
    state: field("1", "New"),
    priority: field("3", "Medium"),
    caller_id: field("user-john-thompson", "John Thompson"),
    assigned_to: field("", ""),
    assignment_group: field("c0b068734779c25025adb5f8536d43aa", "IT Service Desk"),
    sys_created_on: field("2026-03-04 09:15:00"),
    sys_updated_on: field("2026-03-04 09:15:00"),
    resolved_at: field(""),
    due_date: field("2026-03-04 13:00:00"),
    sys_class_name: field("incident"),
  },

  // 3. VPN Issue - matches vpn-troubleshooting runbook
  {
    sys_id: field("c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"),
    number: field("INC0098003"),
    short_description: field("VPN Connection Failing - Remote Worker"),
    description: field(
      `I'm working from home and cannot connect to the VPN since this morning.\n\n` +
      `When I try to connect, I get the error: "The VPN connection failed due to unsuccessful domain name resolution."\n\n` +
      `I've tried:\n` +
      `- Restarting the VPN client\n` +
      `- Restarting my computer\n` +
      `- Connecting to a different WiFi network (my phone hotspot)\n\n` +
      `None of these worked. I'm on Windows 11 using GlobalProtect VPN client version 6.2.\n\n` +
      `My username: mgarcia\n` +
      `Location: Working from home in Saskatoon\n\n` +
      `I have a team meeting at 10am that I need VPN access for.\n\n` +
      `- Maria Garcia, Claims Adjuster`
    ),
    state: field("1", "New"),
    priority: field("3", "Medium"),
    caller_id: field("user-maria-garcia", "Maria Garcia"),
    assigned_to: field("", ""),
    assignment_group: field("c0b068734779c25025adb5f8536d43aa", "IT Service Desk"),
    sys_created_on: field("2026-03-04 08:30:00"),
    sys_updated_on: field("2026-03-04 08:45:00"),
    resolved_at: field(""),
    due_date: field("2026-03-04 10:00:00"),
    sys_class_name: field("incident"),
  },

  // 4. Disk Space Alert - matches disk-cleanup runbook
  {
    sys_id: field("d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1"),
    number: field("INC0098004"),
    short_description: field("Critical: Server Disk Space Below 5% - PROD-APP-03"),
    description: field(
      `AUTOMATED ALERT: Disk space critically low\n\n` +
      `Server: PROD-APP-03\n` +
      `Drive: C:\\\n` +
      `Current Usage: 96.2%\n` +
      `Available Space: 3.8 GB of 100 GB\n` +
      `Threshold: 5%\n\n` +
      `Alert triggered at: 2026-03-04 07:15:00 UTC\n\n` +
      `This server hosts the registration transaction processing service. ` +
      `If disk space reaches 100%, transactions will fail.\n\n` +
      `Previous cleanup was performed 45 days ago.\n` +
      `Common space consumers on this server:\n` +
      `- Log files in C:\\Logs (rotated weekly)\n` +
      `- Temp files in C:\\Windows\\Temp\n` +
      `- IIS logs in C:\\inetpub\\logs\n` +
      `- Application cache in C:\\AppData\\Cache`
    ),
    state: field("1", "New"),
    priority: field("2", "High"),
    caller_id: field("system-monitor", "System Monitor"),
    assigned_to: field("", ""),
    assignment_group: field("40b024f787fd42507ba77597cebb3551", "Infrastructure"),
    sys_created_on: field("2026-03-04 07:15:00"),
    sys_updated_on: field("2026-03-04 07:15:00"),
    resolved_at: field(""),
    due_date: field("2026-03-04 12:00:00"),
    sys_class_name: field("incident"),
  },

  // 5. Vague ticket - agent should request more info
  {
    sys_id: field("e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"),
    number: field("INC0098005"),
    short_description: field("System not working"),
    description: field(
      `The system is broken. It was working yesterday but today it's not working. ` +
      `Please fix ASAP.`
    ),
    state: field("1", "New"),
    priority: field("3", "Medium"),
    caller_id: field("user-bob-wilson", "Bob Wilson"),
    assigned_to: field("", ""),
    assignment_group: field("c0b068734779c25025adb5f8536d43aa", "IT Service Desk"),
    sys_created_on: field("2026-03-04 10:00:00"),
    sys_updated_on: field("2026-03-04 10:00:00"),
    resolved_at: field(""),
    due_date: field(""),
    sys_class_name: field("incident"),
  },

  // 6. Hardware failure - agent should escalate (no runbook)
  {
    sys_id: field("f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"),
    number: field("INC0098006"),
    short_description: field("Server Room UPS Beeping - Battery Failure Warning"),
    description: field(
      `The UPS unit in Server Room B (rack 3, unit 2) has been beeping continuously ` +
      `for the last 20 minutes. The front panel shows "BATTERY FAULT" with a red LED.\n\n` +
      `This UPS powers the following equipment:\n` +
      `- PROD-DB-01 (primary database server)\n` +
      `- PROD-DB-02 (replica database server)\n` +
      `- Network switch SW-CORE-02\n\n` +
      `If the UPS fails completely, these systems will lose power.\n\n` +
      `UPS Model: APC Smart-UPS 3000VA\n` +
      `Serial: AS1234567890\n` +
      `Last battery replacement: 2023-06-15\n\n` +
      `This needs immediate physical attention. I don't have authorization to ` +
      `open the UPS or replace batteries.\n\n` +
      `- Dave Chen, NOC Operator`
    ),
    state: field("1", "New"),
    priority: field("1", "Critical"),
    caller_id: field("user-dave-chen", "Dave Chen"),
    assigned_to: field("", ""),
    assignment_group: field("40b024f787fd42507ba77597cebb3551", "Infrastructure"),
    sys_created_on: field("2026-03-04 06:45:00"),
    sys_updated_on: field("2026-03-04 07:00:00"),
    resolved_at: field(""),
    due_date: field("2026-03-04 08:00:00"),
    sys_class_name: field("incident"),
  },
];

const journals: StoredJournal[] = [
  // Some existing comments on the VPN ticket
  {
    sys_id: "journal-001",
    element: "work_notes",
    value: "Auto-assigned to IT Service Desk queue. SLA clock started.",
    sys_created_by: "system",
    sys_created_on: "2026-03-04 08:30:00",
    element_id: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
  },
  // Existing comment on the bind failure
  {
    sys_id: "journal-002",
    element: "work_notes",
    value: "DRIVE Alert auto-generated. Three ACL command failures detected for registration transaction.",
    sys_created_by: "system",
    sys_created_on: "2026-03-04 14:25:30",
    element_id: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  },
];

const attachments: StoredAttachment[] = [
  // JSON attachment on the bind failure ticket
  {
    sys_id: "att-001",
    table_sys_id: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    file_name: "7654321.json",
    content_type: "application/json",
    size_bytes: String(REQUOTE_JSON_ATTACHMENT.length),
    content: REQUOTE_JSON_ATTACHMENT,
  },
];

let journalCounter = 100;

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------

app.use((req, _res, next) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  [${ts}] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Auth middleware (accept anything)
// ---------------------------------------------------------------------------

app.use("/api/now", (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    return res.status(401).json({ error: { message: "Authentication required" } });
  }
  next();
});

// ---------------------------------------------------------------------------
// GET /api/now/table/incident - List incidents
// ---------------------------------------------------------------------------

app.get("/api/now/table/incident", (req, res) => {
  const limit = parseInt(req.query.sysparm_limit as string) || 50;
  const offset = parseInt(req.query.sysparm_offset as string) || 0;
  const query = (req.query.sysparm_query as string) || "";

  let filtered = [...incidents];

  // Basic query filtering
  if (query) {
    // Support state filter
    const stateMatch = query.match(/state=(\d)/);
    if (stateMatch) {
      filtered = filtered.filter(i => i.state.value === stateMatch[1]);
    }
    const stateInMatch = query.match(/stateIN([\d,]+)/);
    if (stateInMatch) {
      const states = stateInMatch[1].split(",");
      filtered = filtered.filter(i => states.includes(i.state.value));
    }
  }

  const paged = filtered.slice(offset, offset + limit);

  res.setHeader("X-Total-Count", String(filtered.length));
  res.json({ result: paged });
});

// ---------------------------------------------------------------------------
// GET /api/now/table/incident/:sys_id - Get single incident
// ---------------------------------------------------------------------------

app.get("/api/now/table/incident/:sys_id", (req, res) => {
  const incident = incidents.find(i => i.sys_id.value === req.params.sys_id);
  if (!incident) {
    return res.status(404).json({ error: { message: "Record not found" } });
  }
  res.json({ result: incident });
});

// ---------------------------------------------------------------------------
// PATCH /api/now/table/incident/:sys_id - Update (add comment/work_note)
// ---------------------------------------------------------------------------

app.patch("/api/now/table/incident/:sys_id", (req, res) => {
  const incident = incidents.find(i => i.sys_id.value === req.params.sys_id);
  if (!incident) {
    return res.status(404).json({ error: { message: "Record not found" } });
  }

  const body = req.body;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Handle comments and work_notes
  for (const field of ["comments", "work_notes"]) {
    if (body[field]) {
      journalCounter++;
      const entry: StoredJournal = {
        sys_id: `journal-${journalCounter}`,
        element: field === "work_notes" ? "work_notes" : "comments",
        value: body[field],
        sys_created_by: "tierzero-agent",
        sys_created_on: now,
        element_id: req.params.sys_id,
      };
      journals.push(entry);
      console.log(`    -> ${field === "work_notes" ? "Internal note" : "Public comment"} added to ${incident.number.value}`);
      console.log(`       "${body[field].slice(0, 80)}${body[field].length > 80 ? "..." : ""}"`);
    }
  }

  // Update timestamp
  incident.sys_updated_on = { value: now, display_value: now };

  res.json({ result: incident });
});

// ---------------------------------------------------------------------------
// GET /api/now/table/sys_journal_field - Get comments
// ---------------------------------------------------------------------------

app.get("/api/now/table/sys_journal_field", (req, res) => {
  const query = (req.query.sysparm_query as string) || "";
  
  // Parse element_id from query
  const elementIdMatch = query.match(/element_id=([a-f0-9]+)/);
  const elementId = elementIdMatch ? elementIdMatch[1] : "";

  const filtered = journals
    .filter(j => j.element_id === elementId)
    .sort((a, b) => a.sys_created_on.localeCompare(b.sys_created_on));

  res.json({ result: filtered });
});

// ---------------------------------------------------------------------------
// GET /api/now/attachment - List attachments
// ---------------------------------------------------------------------------

app.get("/api/now/attachment", (req, res) => {
  const query = (req.query.sysparm_query as string) || "";
  const sysIdMatch = query.match(/table_sys_id=([a-f0-9]+)/);
  const tableId = sysIdMatch ? sysIdMatch[1] : "";

  const filtered = attachments
    .filter(a => a.table_sys_id === tableId)
    .map(a => ({
      sys_id: a.sys_id,
      file_name: a.file_name,
      download_link: `http://localhost:8888/api/now/attachment/${a.sys_id}/file`,
      size_bytes: a.size_bytes,
      content_type: a.content_type,
    }));

  res.json({ result: filtered });
});

// ---------------------------------------------------------------------------
// GET /api/now/attachment/:id/file - Download attachment
// ---------------------------------------------------------------------------

app.get("/api/now/attachment/:id/file", (req, res) => {
  const att = attachments.find(a => a.sys_id === req.params.id);
  if (!att) {
    return res.status(404).json({ error: { message: "Attachment not found" } });
  }
  res.setHeader("Content-Type", att.content_type);
  res.send(att.content);
});

// ---------------------------------------------------------------------------
// POST /api/now/attachment/file - Upload attachment
// ---------------------------------------------------------------------------

app.post("/api/now/attachment/file", (req, res) => {
  const tableId = req.query.table_sys_id as string;
  const fileName = req.query.file_name as string;
  
  const newAtt: StoredAttachment = {
    sys_id: `att-${Date.now()}`,
    table_sys_id: tableId,
    file_name: fileName || "upload.bin",
    content_type: req.headers["content-type"] || "application/octet-stream",
    size_bytes: "0",
    content: "",
  };
  attachments.push(newAtt);

  res.json({
    result: {
      sys_id: newAtt.sys_id,
      file_name: newAtt.file_name,
      download_link: `http://localhost:8888/api/now/attachment/${newAtt.sys_id}/file`,
      size_bytes: newAtt.size_bytes,
      content_type: newAtt.content_type,
    },
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.MOCK_SNOW_PORT || "8888");

export function startMockServer(port = PORT): Promise<ReturnType<typeof app.listen>> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`\n  Mock ServiceNow running on http://localhost:${port}`);
      console.log(`  ${incidents.length} incidents loaded, ${attachments.length} attachment(s)\n`);
      resolve(server);
    });
  });
}

// Run directly
if (process.argv[1]?.includes("mock-servicenow")) {
  startMockServer();
}
