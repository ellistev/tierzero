import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyError, isTransient, isFatal } from "./error-classification";

describe("error-classification", () => {
  describe("classifyError", () => {
    it("classifies network timeout as transient", () => {
      const err = new Error("Request timeout after 5000ms");
      const result = classifyError(err);
      assert.equal(result.category, "transient");
    });

    it("classifies ECONNRESET as transient", () => {
      const err = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      const result = classifyError(err);
      assert.equal(result.category, "transient");
    });

    it("classifies ECONNREFUSED as transient", () => {
      const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const result = classifyError(err);
      assert.equal(result.category, "transient");
    });

    it("classifies ETIMEDOUT as transient", () => {
      const err = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
      const result = classifyError(err);
      assert.equal(result.category, "transient");
    });

    it("classifies 429 rate limit as transient", () => {
      const err = new Error("GitHub 429 Too Many Requests");
      const result = classifyError(err);
      assert.equal(result.category, "transient");
      assert.equal(result.statusCode, 429);
    });

    it("classifies 503 service unavailable as transient", () => {
      const err = new Error("GitHub 503 Service Unavailable");
      const result = classifyError(err);
      assert.equal(result.category, "transient");
      assert.equal(result.statusCode, 503);
    });

    it("classifies 502 bad gateway as transient", () => {
      const err = new Error("HTTP 502 Bad Gateway");
      const result = classifyError(err);
      assert.equal(result.category, "transient");
    });

    it("classifies 500 internal server error as transient", () => {
      const err = new Error("Server returned 500");
      const result = classifyError(err);
      assert.equal(result.category, "transient");
    });

    it("classifies 404 not found as permanent", () => {
      const err = new Error("GitHub 404 Not Found: ");
      const result = classifyError(err);
      assert.equal(result.category, "permanent");
      assert.equal(result.statusCode, 404);
    });

    it("classifies 401 unauthorized as permanent", () => {
      const err = new Error("GitHub 401 Unauthorized: Bad credentials");
      const result = classifyError(err);
      assert.equal(result.category, "permanent");
      assert.equal(result.statusCode, 401);
    });

    it("classifies 403 forbidden as permanent", () => {
      const err = new Error("GitHub 403 Forbidden: API rate limit exceeded");
      // Note: 403 is classified as permanent. Rate limit check uses message patterns.
      const result = classifyError(err);
      // The "rate limit" pattern matches transient before status code check
      assert.equal(result.category, "permanent");
    });

    it("classifies 422 unprocessable entity as permanent", () => {
      const err = new Error("GitHub 422 Unprocessable Entity");
      const result = classifyError(err);
      assert.equal(result.category, "permanent");
    });

    it("classifies ENOSPC (disk full) as fatal", () => {
      const err = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      const result = classifyError(err);
      assert.equal(result.category, "fatal");
    });

    it("classifies out of memory as fatal", () => {
      const err = new Error("JavaScript heap out of memory");
      const result = classifyError(err);
      assert.equal(result.category, "fatal");
    });

    it("classifies EMFILE as fatal", () => {
      const err = Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
      const result = classifyError(err);
      assert.equal(result.category, "fatal");
    });

    it("classifies unknown errors as permanent by default", () => {
      const err = new Error("Something unexpected happened");
      const result = classifyError(err);
      assert.equal(result.category, "permanent");
    });

    it("extracts status code from error with statusCode property", () => {
      const err = Object.assign(new Error("Request failed"), { statusCode: 503 });
      const result = classifyError(err);
      assert.equal(result.category, "transient");
      assert.equal(result.statusCode, 503);
    });

    it("extracts error code from error object", () => {
      const err = Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" });
      const result = classifyError(err);
      assert.equal(result.code, "ECONNREFUSED");
    });
  });

  describe("isTransient", () => {
    it("returns true for transient errors", () => {
      assert.equal(isTransient(new Error("Connection timeout")), true);
    });

    it("returns false for permanent errors", () => {
      assert.equal(isTransient(new Error("GitHub 404 Not Found")), false);
    });

    it("returns false for fatal errors", () => {
      assert.equal(isTransient(new Error("ENOSPC: no space left")), false);
    });
  });

  describe("isFatal", () => {
    it("returns true for fatal errors", () => {
      assert.equal(isFatal(new Error("disk full")), true);
    });

    it("returns false for transient errors", () => {
      assert.equal(isFatal(new Error("Connection timeout")), false);
    });

    it("returns false for permanent errors", () => {
      assert.equal(isFatal(new Error("GitHub 404 Not Found")), false);
    });
  });
});
