import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testExports } from "./providers";

const { inferProvider } = _testExports;

// ---------------------------------------------------------------------------
// inferProvider
// ---------------------------------------------------------------------------

describe("inferProvider", () => {
  it("detects Anthropic from claude model names", () => {
    assert.equal(inferProvider("claude-sonnet-4-20250514"), "anthropic");
    assert.equal(inferProvider("claude-3-opus-20240229"), "anthropic");
    assert.equal(inferProvider("claude-3.5-sonnet"), "anthropic");
  });

  it("detects OpenAI from gpt model names", () => {
    assert.equal(inferProvider("gpt-4o"), "openai");
    assert.equal(inferProvider("gpt-4o-mini"), "openai");
    assert.equal(inferProvider("gpt-4-turbo"), "openai");
  });

  it("detects OpenAI from o-series model names", () => {
    assert.equal(inferProvider("o1"), "openai");
    assert.equal(inferProvider("o3-mini"), "openai");
  });

  it("detects Google from gemini model names", () => {
    assert.equal(inferProvider("gemini-2.5-pro"), "google");
    assert.equal(inferProvider("gemini-2.0-flash"), "google");
  });

  it("returns undefined for unknown models", () => {
    assert.equal(inferProvider("llama-3.1"), undefined);
    assert.equal(inferProvider("mistral-large"), undefined);
    assert.equal(inferProvider("unknown-model"), undefined);
  });

  it("is case-insensitive", () => {
    assert.equal(inferProvider("Claude-Sonnet-4"), "anthropic");
    assert.equal(inferProvider("GPT-4o"), "openai");
    assert.equal(inferProvider("Gemini-2.5-Pro"), "google");
  });
});
