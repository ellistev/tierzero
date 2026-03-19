import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HealthChecker, type HealthCheckFetcher } from "./health-checker";

function mockFetcher(responses: Array<{ status: number; body: string } | Error>): HealthCheckFetcher {
  let call = 0;
  return async () => {
    const response = responses[call++];
    if (!response) throw new Error("No more mock responses");
    if (response instanceof Error) throw response;
    return {
      status: response.status,
      text: async () => response.body,
    };
  };
}

describe("HealthChecker", () => {
  describe("check", () => {
    it("returns healthy when status matches", async () => {
      const checker = new HealthChecker(mockFetcher([{ status: 200, body: "ok" }]));
      const result = await checker.check("http://localhost:3000/health");
      assert.equal(result.healthy, true);
      assert.equal(result.statusCode, 200);
      assert.ok(result.responseTimeMs >= 0);
      assert.ok(result.checkedAt);
    });

    it("returns unhealthy when status does not match", async () => {
      const checker = new HealthChecker(mockFetcher([{ status: 503, body: "error" }]));
      const result = await checker.check("http://localhost:3000/health");
      assert.equal(result.healthy, false);
      assert.equal(result.statusCode, 503);
      assert.ok(result.error);
    });

    it("checks expected body substring", async () => {
      const checker = new HealthChecker(mockFetcher([{ status: 200, body: '{"status":"healthy"}' }]));
      const result = await checker.check("http://localhost:3000/health", { expectedBody: "healthy" });
      assert.equal(result.healthy, true);
    });

    it("fails when expected body not found", async () => {
      const checker = new HealthChecker(mockFetcher([{ status: 200, body: '{"status":"degraded"}' }]));
      const result = await checker.check("http://localhost:3000/health", { expectedBody: "healthy" });
      assert.equal(result.healthy, false);
    });

    it("handles fetch errors", async () => {
      const checker = new HealthChecker(mockFetcher([new Error("ECONNREFUSED")]));
      const result = await checker.check("http://localhost:3000/health");
      assert.equal(result.healthy, false);
      assert.equal(result.statusCode, null);
      assert.ok(result.error?.includes("ECONNREFUSED"));
    });

    it("uses custom expectedStatus", async () => {
      const checker = new HealthChecker(mockFetcher([{ status: 204, body: "" }]));
      const result = await checker.check("http://localhost:3000/health", { expectedStatus: 204 });
      assert.equal(result.healthy, true);
      assert.equal(result.statusCode, 204);
    });
  });

  describe("waitForHealthy", () => {
    it("returns true when healthy on first try", async () => {
      const checker = new HealthChecker(mockFetcher([{ status: 200, body: "ok" }]));
      const result = await checker.waitForHealthy("http://localhost:3000/health", {
        maxWaitMs: 5000,
        intervalMs: 100,
        retries: 3,
      });
      assert.equal(result, true);
    });

    it("returns true after retries", async () => {
      const checker = new HealthChecker(mockFetcher([
        { status: 503, body: "starting" },
        { status: 503, body: "starting" },
        { status: 200, body: "ok" },
      ]));
      const result = await checker.waitForHealthy("http://localhost:3000/health", {
        maxWaitMs: 10000,
        intervalMs: 10,
        retries: 5,
      });
      assert.equal(result, true);
    });

    it("returns false when all retries exhausted", async () => {
      const checker = new HealthChecker(mockFetcher([
        { status: 503, body: "error" },
        { status: 503, body: "error" },
        { status: 503, body: "error" },
      ]));
      const result = await checker.waitForHealthy("http://localhost:3000/health", {
        maxWaitMs: 10000,
        intervalMs: 10,
        retries: 3,
      });
      assert.equal(result, false);
    });

    it("respects maxWaitMs timeout", async () => {
      let callCount = 0;
      const slowFetcher: HealthCheckFetcher = async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { status: 503, text: async () => "error" };
      };
      const checker = new HealthChecker(slowFetcher);
      const start = Date.now();
      const result = await checker.waitForHealthy("http://localhost:3000/health", {
        maxWaitMs: 100,
        intervalMs: 10,
        retries: 100,
      });
      assert.equal(result, false);
      assert.ok(callCount < 100);
    });
  });
});
