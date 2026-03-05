# SGI ID Lookup / Query Helper

## Purpose
Look up identifiers across SGI systems when you have one ID and need another.

## Available Lookups

### Registration ID -> RegistrationTransactionId
Use the KQL query against App Insights to find the latest transaction for a given registration.

### Job Number -> RegistrationTransactionId
Use the standard KQL query filtering by QuoteNumber to find the transaction that issued a specific job.

### RegistrationTransactionId -> QuoteId
Search Data Explorer with Stream Type `poc46/registration-transaction` and the transaction ID. Expand the `registration-transaction-quotes-set` event to find the quoteIds array.

### Job Number -> Plate Number
Chain: Job Number -> RegistrationTransactionId (via KQL) -> Data Explorer -> plate GUID -> plate stream -> plate number. See the Plate Lookup runbook for details.

## Common Patterns
- All KQL queries target `AF.VehicleRegistration.ACL.Host-prd` cloud role
- All queries look for `RegistrationTransactionIssuedIntegrationEventV3` events
- Data Explorer is at `https://drive.sgicloud.ca/registration-admin?tab=data-explorer`
- App Insights app ID: `3c39e0b5-8be0-444f-9563-1fbbcb3a447f`
- Subscription: SGI-INS-PRD
- Queries should use `--offset 90d` to search far enough back
