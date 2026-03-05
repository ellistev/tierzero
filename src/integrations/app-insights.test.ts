import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APP_INSIGHTS_APP_ID,
  SUBSCRIPTION,
  KQL_JOB_TO_TRANSACTION,
  KQL_REG_TO_TRANSACTION,
} from "./app-insights";

describe("App Insights constants", () => {
  it("has the correct App Insights app ID", () => {
    assert.equal(APP_INSIGHTS_APP_ID, "3c39e0b5-8be0-444f-9563-1fbbcb3a447f");
  });

  it("targets SGI-INS-PRD subscription", () => {
    assert.equal(SUBSCRIPTION, "SGI-INS-PRD");
  });
});

describe("KQL templates", () => {
  it("job-to-transaction template contains TARGET_JOB placeholder", () => {
    assert.ok(KQL_JOB_TO_TRANSACTION.includes("TARGET_JOB"));
  });

  it("job-to-transaction queries the correct cloud role", () => {
    assert.ok(KQL_JOB_TO_TRANSACTION.includes("AF.VehicleRegistration.ACL.Host-prd"));
  });

  it("job-to-transaction queries RegistrationTransactionIssuedIntegrationEventV3", () => {
    assert.ok(KQL_JOB_TO_TRANSACTION.includes("RegistrationTransactionIssuedIntegrationEventV3"));
  });

  it("job-to-transaction projects RegistrationTransactionId", () => {
    assert.ok(KQL_JOB_TO_TRANSACTION.includes("RegistrationTransactionId"));
  });

  it("reg-to-transaction template contains TARGET_REG_ID placeholder", () => {
    assert.ok(KQL_REG_TO_TRANSACTION.includes("TARGET_REG_ID"));
  });

  it("reg-to-transaction limits to 1 result", () => {
    assert.ok(KQL_REG_TO_TRANSACTION.includes("take 1"));
  });
});
