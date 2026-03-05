# SGI Plate Number Lookup

## Trigger
When a support request needs a plate number and only a job number or registration ID is available.

## Procedure

### Step 1: Get RegistrationTransactionId
If starting from a job number, query Azure App Insights using the standard KQL query to get the RegistrationTransactionId.

If starting from a Registration ID, use this query:
```kql
let targetRegistrationId = "{REGISTRATION_ID}";
customEvents
| where cloud_RoleName == "AF.VehicleRegistration.ACL.Host-prd"
| where timestamp >= datetime(2025-11-01 06:00:00.00)
| where name == "RegistrationTransactionIssuedIntegrationEventV3"
| extend EventData = todynamic(tostring(customDimensions.EventData))
| where tostring(EventData.registrationId) == targetRegistrationId
| project
    RequestTime = timestamp,
    RegistrationId = tostring(EventData.registrationId),
    RegistrationTransactionId = tostring(EventData.registrationTransactionId),
    TransactionType = tostring(EventData.transactionType)
| order by RequestTime desc
| take 1
```

### Step 2: Search Data Explorer
Navigate to `https://drive.sgicloud.ca/registration-admin?tab=data-explorer`:
- Service Context: "Registration Service"
- Stream Type: `poc46/registration-transaction`
- Stream Id: the RegistrationTransactionId
- Click "Get Data"

### Step 3: Extract Plate Information
Try these strategies in order:

**Strategy A: baseline-registration-attributes-set**
- Expand the `baseline-registration-attributes-set` event
- Look for `registrationPlate` field containing a GUID (36-character UUID)
- If found, search the plate stream:
  - Stream Type: `poc46/registration-plate`
  - Stream Id: the plate GUID
  - Look for `plateNumber` or `plateSearchValue` in the results

**Strategy B: registration-plate-attribute-set**
- If Strategy A fails, look for `registration-plate-attribute-set` event
- Expand it and look for `plateSearchValue` directly

### Output
Return: Job Number, RegistrationTransactionId, RegistrationPlate GUID (if found), Plate Number.

## Escalation
If neither strategy yields a plate number, escalate to manual lookup.
