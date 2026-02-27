import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testExports } from "./url-scraper";

const { extractDomain, urlToFilename, detectContentType, parseRobotsTxt, isAllowedByRobots } =
  _testExports;

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  it("extracts hostname from a simple URL", () => {
    assert.equal(extractDomain("https://docs.example.com/page"), "docs.example.com");
  });

  it("extracts hostname without path", () => {
    assert.equal(extractDomain("https://example.com"), "example.com");
  });

  it("strips port from hostname", () => {
    assert.equal(extractDomain("http://localhost:3000/page"), "localhost");
  });

  it("handles query strings", () => {
    assert.equal(extractDomain("https://docs.example.com/kb?v=1"), "docs.example.com");
  });

  it("returns 'unknown-domain' for invalid URLs", () => {
    assert.equal(extractDomain("not-a-url"), "unknown-domain");
  });
});

// ---------------------------------------------------------------------------
// urlToFilename
// ---------------------------------------------------------------------------

describe("urlToFilename", () => {
  it("converts a URL path to a safe filename", () => {
    assert.equal(urlToFilename("https://docs.example.com/kb/Password-Reset"), "kb-password-reset.md");
  });

  it("returns 'index.md' for root path", () => {
    assert.equal(urlToFilename("https://example.com/"), "index.md");
  });

  it("strips query strings from the filename", () => {
    assert.equal(urlToFilename("https://example.com/page?utm_source=email"), "page.md");
  });

  it("handles multi-segment paths", () => {
    assert.equal(urlToFilename("https://example.com/docs/api/intro"), "docs-api-intro.md");
  });

  it("always ends with .md", () => {
    assert.match(urlToFilename("https://example.com/anything"), /\.md$/);
  });

  it("returns 'index.md' for invalid URLs", () => {
    assert.equal(urlToFilename("not-a-url"), "index.md");
  });

  it("decodes percent-encoded path segments", () => {
    assert.equal(urlToFilename("https://example.com/docs/How%20To%20Reset"), "docs-how-to-reset.md");
  });

  it("truncates very long filenames", () => {
    const longUrl = "https://example.com/" + "a".repeat(200);
    const filename = urlToFilename(longUrl);
    assert.ok(filename.length <= 104, `filename too long: ${filename.length}`);
  });
});

// ---------------------------------------------------------------------------
// detectContentType
// ---------------------------------------------------------------------------

describe("detectContentType", () => {
  it("detects html", () => {
    assert.equal(detectContentType("text/html"), "html");
    assert.equal(detectContentType("text/html; charset=utf-8"), "html");
  });

  it("detects plain text", () => {
    assert.equal(detectContentType("text/plain"), "text");
    assert.equal(detectContentType("text/plain; charset=utf-8"), "text");
  });

  it("detects markdown", () => {
    assert.equal(detectContentType("text/markdown"), "text");
  });

  it("detects PDF", () => {
    assert.equal(detectContentType("application/pdf"), "pdf");
  });

  it("returns unknown for unhandled types", () => {
    assert.equal(detectContentType("image/png"), "unknown");
    assert.equal(detectContentType("application/json"), "unknown");
  });

  it("is case-insensitive", () => {
    assert.equal(detectContentType("TEXT/HTML"), "html");
    assert.equal(detectContentType("Application/PDF"), "pdf");
  });
});

// ---------------------------------------------------------------------------
// parseRobotsTxt
// ---------------------------------------------------------------------------

describe("parseRobotsTxt", () => {
  const ROBOTS_TXT = `
User-agent: *
Disallow: /private/
Disallow: /admin/
Allow: /admin/public/

User-agent: Googlebot
Disallow: /google-only-blocked/
`.trim();

  it("parses disallow rules for *", () => {
    const rules = parseRobotsTxt(ROBOTS_TXT, "TierZeroBot");
    assert.ok(rules.disallowed.includes("/private/"));
    assert.ok(rules.disallowed.includes("/admin/"));
  });

  it("parses allow rules for *", () => {
    const rules = parseRobotsTxt(ROBOTS_TXT, "TierZeroBot");
    assert.ok(rules.allowed.includes("/admin/public/"));
  });

  it("does not include rules for other user-agents", () => {
    const rules = parseRobotsTxt(ROBOTS_TXT, "TierZeroBot");
    assert.ok(!rules.disallowed.includes("/google-only-blocked/"));
  });

  it("handles specific user-agent matching", () => {
    const rules = parseRobotsTxt(ROBOTS_TXT, "Googlebot");
    assert.ok(rules.disallowed.includes("/google-only-blocked/"));
  });

  it("returns empty rules for unknown agent when no * block", () => {
    const rules = parseRobotsTxt("User-agent: Googlebot\nDisallow: /secret/\n", "TierZeroBot");
    assert.equal(rules.disallowed.length, 0);
  });

  it("ignores comments in robots.txt", () => {
    const txt = "# comment\nUser-agent: *\n# another\nDisallow: /blocked/\n";
    const rules = parseRobotsTxt(txt, "*");
    assert.ok(rules.disallowed.includes("/blocked/"));
  });
});

// ---------------------------------------------------------------------------
// isAllowedByRobots
// ---------------------------------------------------------------------------

describe("isAllowedByRobots", () => {
  const rules = {
    disallowed: ["/private/", "/admin/"],
    allowed: ["/admin/public/"],
  };

  it("allows paths not in disallow list", () => {
    assert.equal(isAllowedByRobots("/docs/page", rules), true);
  });

  it("blocks disallowed paths", () => {
    assert.equal(isAllowedByRobots("/private/secret", rules), false);
    assert.equal(isAllowedByRobots("/admin/settings", rules), false);
  });

  it("allows paths that match an allow rule even when also disallowed", () => {
    assert.equal(isAllowedByRobots("/admin/public/page", rules), true);
  });

  it("allows everything when rules are empty", () => {
    assert.equal(isAllowedByRobots("/anything", { disallowed: [], allowed: [] }), true);
  });
});
