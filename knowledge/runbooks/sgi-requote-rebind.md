# SGI Requote Rebind Procedure

## Trigger
ServiceNow incidents assigned to DRIVE Alerts groups with short description containing "Bind Failure" and description containing the error signature "Cannot access payment info".

## Symptoms
- Customer's vehicle registration quote failed to bind in Guidewire
- The ACL Command Queue shows Failed status for:
  - SendBoundQuoteToDrive
  - SendPaymentRequestToInsurCloud
  - SendPaymentToDrive
- The ticket description contains a JSON error payload with a "JobNumber" field (the old/failed job number)
- A JSON attachment is present on the ticket containing the requote response with a new job number

## Required Information
1. **Old Job Number** - extracted from the ticket description JSON (`"JobNumber": "XXXXXXX"`)
2. **New Job Number** - extracted from the JSON attachment at path `quoteCompositeResponse.responses[0].body.data.attributes.jobNumber`
3. **RegistrationTransactionId** - looked up via Azure App Insights KQL query using the old job number
4. **QuoteId** - found in the Data Explorer by searching the registration-transaction stream for the `registration-transaction-quotes-set` event

## Step-by-Step Resolution

### Step 1: Query Azure App Insights
Run a KQL query against App Insights (app ID: 3c39e0b5-8be0-444f-9563-1fbbcb3a447f) in the SGI-INS-PRD subscription:

```kql
let targetJobNumber = "{OLD_JOB_NUMBER}";
customEvents
| where cloud_RoleName == "AF.VehicleRegistration.ACL.Host-prd"
| where timestamp >= datetime(2025-11-01 06:00:00.00)
| where name == "RegistrationTransactionIssuedIntegrationEventV3"
| extend EventData = todynamic(tostring(customDimensions.EventData))
| mv-expand quote = EventData.quotes
| extend QuoteNumber = tostring(quote.guidewireJobReference.jobNumber)
| where QuoteNumber == targetJobNumber
| project
    RequestTime = timestamp,
    QuoteNumber,
    RegistrationId = tostring(EventData.registrationId),
    RegistrationTransactionId = tostring(EventData.registrationTransactionId),
    TransactionType = tostring(EventData.transactionType)
| order by RequestTime desc
```

This returns the `RegistrationTransactionId` needed for the next steps.

### Step 2: Verify ACL Command Queue
Navigate to the ACL Command Queue at `https://drive.sgicloud.ca/registration-admin?tab=acl-command-queue`.
- Filter by Correlation ID = the RegistrationTransactionId
- Confirm the expected failure pattern:
  - SendBoundQuoteToDrive: Failed
  - SendPaymentRequestToInsurCloud: Failed
  - SendPaymentToDrive: Failed
- If all three are Failed, this is the standard pattern and can proceed automatically
- If the pattern doesn't match, escalate for manual review

### Step 3: Find QuoteId in Data Explorer
Navigate to Data Explorer at `https://drive.sgicloud.ca/registration-admin?tab=data-explorer`.
- Service Context: "Registration Service"
- Stream Type: `poc46/registration-transaction`
- Stream Id: the RegistrationTransactionId
- Click "Get Data"
- Expand the `registration-transaction-quotes-set` event row
- Extract the quoteId from the `quoteIds` array in the event data

### Step 4: Append Correction Event
In Data Explorer:
- Search for Stream Type: `poc46/quote`, Stream Id: the QuoteId
- Click "Append Correction Event To Stream"
- Paste the full JSON content from the ticket's attachment (the requote JSON file)
- Click Submit

### Step 5: Manually Bind Quote
- Click the "Manually Bind Quote" button in the Data Explorer
- Wait for the bind to complete by polling the ACL Command Queue
- A new "Completed" SendBoundQuoteToDrive entry should appear (timeout: 3 minutes)

### Step 6: Payment Repair
Navigate to Payment Repair at `https://drive.sgicloud.ca/registration-admin?tab=payment-repair`.
- Enter the NEW job number in the "Job Numbers" field
- Click "Submit Repair Request"
- Wait for completion by polling ACL Command Queue for a Completed SendPaymentToDrive entry

### Step 7: Update ServiceNow Ticket
Post an Additional Comment (customer visible) on the ServiceNow ticket:
> requote bound, and payments sent to gwbc

### Step 8: Mark Complete
The ticket can be resolved after the comment is posted.

## Escalation Criteria
- ACL Command Queue failure pattern doesn't match the expected three failures
- KQL query returns no results for the old job number
- No JSON attachment on the ticket
- Bind or payment times out after 3 minutes
- Any unexpected errors during the correction event append

## Tools Required
- Azure CLI (`az`) authenticated to SGI-INS-PRD subscription
- Access to drive.sgicloud.ca (Registration Admin)
- Access to sgico.service-now.com
- Browser automation capability (ServiceNow uses shadow DOM iframes)

## Notes
- ServiceNow's modern UI wraps forms in shadow DOM with nested iframes. To interact with ticket fields programmatically, you must traverse shadow roots to find the `incident.do` iframe.
- The JSON attachment download from ServiceNow requires using `fetch()` inside the iframe context due to CORS restrictions.
- ServiceNow form submission uses `g_form.setValue('comments', message)` followed by `gsftSubmit()`.
