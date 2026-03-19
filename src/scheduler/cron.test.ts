import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextRun, matches } from "./cron";

describe("Cron Parser", () => {
  describe("matches()", () => {
    it("should match every minute (* * * * *)", () => {
      const date = new Date("2026-03-18T10:30:00Z");
      assert.ok(matches("* * * * *", date));
    });

    it("should match specific minute", () => {
      const date = new Date("2026-03-18T10:30:00Z");
      assert.ok(matches("30 * * * *", date));
      assert.ok(!matches("15 * * * *", date));
    });

    it("should match step expression */15", () => {
      assert.ok(matches("*/15 * * * *", new Date("2026-03-18T10:00:00Z")));
      assert.ok(matches("*/15 * * * *", new Date("2026-03-18T10:15:00Z")));
      assert.ok(matches("*/15 * * * *", new Date("2026-03-18T10:30:00Z")));
      assert.ok(matches("*/15 * * * *", new Date("2026-03-18T10:45:00Z")));
      assert.ok(!matches("*/15 * * * *", new Date("2026-03-18T10:10:00Z")));
    });

    it("should match range expression 1-5 in day-of-week", () => {
      // 2026-03-18 is a Wednesday (day 3)
      assert.ok(matches("0 9 * * 1-5", new Date("2026-03-18T09:00:00Z")));
      // 2026-03-22 is a Sunday (day 0)
      assert.ok(!matches("0 9 * * 1-5", new Date("2026-03-22T09:00:00Z")));
    });

    it("should match list expression 1,3,5", () => {
      assert.ok(matches("0 9 * * 1,3,5", new Date("2026-03-18T09:00:00Z"))); // Wednesday=3
      assert.ok(!matches("0 9 * * 1,3,5", new Date("2026-03-19T09:00:00Z"))); // Thursday=4
    });

    it("should match specific hour and minute", () => {
      assert.ok(matches("0 9 * * *", new Date("2026-03-18T09:00:00Z")));
      assert.ok(!matches("0 9 * * *", new Date("2026-03-18T10:00:00Z")));
    });

    it("should match specific day of month", () => {
      assert.ok(matches("0 0 1 * *", new Date("2026-01-01T00:00:00Z")));
      assert.ok(!matches("0 0 1 * *", new Date("2026-01-02T00:00:00Z")));
    });

    it("should match specific month", () => {
      assert.ok(matches("0 0 1 3 *", new Date("2026-03-01T00:00:00Z")));
      assert.ok(!matches("0 0 1 3 *", new Date("2026-04-01T00:00:00Z")));
    });

    it("should match Sunday as day 0", () => {
      // 2026-03-22 is a Sunday
      assert.ok(matches("0 0 * * 0", new Date("2026-03-22T00:00:00Z")));
    });
  });

  describe("nextRun()", () => {
    it("should find next run for every minute", () => {
      const after = new Date("2026-03-18T10:30:00Z");
      const next = nextRun("* * * * *", after);
      assert.equal(next.getUTCMinutes(), 31);
      assert.equal(next.getUTCHours(), 10);
    });

    it("should find next run for */5", () => {
      const after = new Date("2026-03-18T10:32:00Z");
      const next = nextRun("*/5 * * * *", after);
      assert.equal(next.getUTCMinutes(), 35);
      assert.equal(next.getUTCHours(), 10);
    });

    it("should find next run for */15", () => {
      const after = new Date("2026-03-18T10:46:00Z");
      const next = nextRun("*/15 * * * *", after);
      // Next would be minute 0 of hour 11
      assert.equal(next.getUTCMinutes(), 0);
      assert.equal(next.getUTCHours(), 11);
    });

    it("should find next run for daily at 9:00", () => {
      const after = new Date("2026-03-18T10:00:00Z");
      const next = nextRun("0 9 * * *", after);
      assert.equal(next.getUTCHours(), 9);
      assert.equal(next.getUTCMinutes(), 0);
      assert.equal(next.getUTCDate(), 19); // next day
    });

    it("should find next run for weekly Sunday midnight", () => {
      // 2026-03-18 is Wednesday
      const after = new Date("2026-03-18T00:00:00Z");
      const next = nextRun("0 0 * * 0", after);
      assert.equal(next.getUTCDay(), 0); // Sunday
      assert.equal(next.getUTCHours(), 0);
      assert.equal(next.getUTCMinutes(), 0);
    });

    it("should find next run for every 6 hours", () => {
      const after = new Date("2026-03-18T07:00:00Z");
      const next = nextRun("0 */6 * * *", after);
      assert.equal(next.getUTCHours(), 12);
      assert.equal(next.getUTCMinutes(), 0);
    });

    it("should handle month boundary", () => {
      const after = new Date("2026-03-31T23:59:00Z");
      const next = nextRun("0 0 1 * *", after);
      assert.equal(next.getUTCDate(), 1);
      assert.equal(next.getUTCMonth(), 3); // April (0-based)
    });

    it("should handle February and leap year", () => {
      // 2028 is a leap year
      const after = new Date("2028-02-28T23:59:00Z");
      const next = nextRun("0 0 29 * *", after);
      assert.equal(next.getUTCDate(), 29);
      assert.equal(next.getUTCMonth(), 1); // February
    });

    it("should handle step in hour field", () => {
      const after = new Date("2026-03-18T00:00:00Z");
      const next = nextRun("0 */6 * * *", after);
      assert.equal(next.getUTCHours(), 6);
      assert.equal(next.getUTCMinutes(), 0);
    });
  });
});
