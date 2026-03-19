/**
 * LLM-powered deep PR review engine.
 *
 * Unlike the static rules in review-rules.ts, this module sends the diff,
 * issue context, codebase context, and test output to an LLM for genuine
 * code review: issue alignment, code quality, test quality, architecture,
 * and security analysis.
 */

import type { ReviewContext } from "./review-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMFinding {
  category: "issue-alignment" | "code-quality" | "test-quality" | "architecture" | "security";
  severity: "critical" | "major" | "minor" | "suggestion";
  file?: string;
  line?: number;
  message: string;
  suggestedFix?: string;
}

export interface LLMReviewResult {
  issueAlignment: {
    score: number;
    missingRequirements: string[];
    extraWork: string[];
  };

  codeQuality: {
    score: number;
    findings: LLMFinding[];
  };

  testQuality: {
    score: number;
    coverage: "none" | "smoke" | "partial" | "comprehensive";
    missingTests: string[];
    weakTests: string[];
  };

  architecture: {
    score: number;
    patternsFollowed: boolean;
    concerns: string[];
  };

  security: {
    score: number;
    issues: string[];
  };

  overallScore: number;
  approved: boolean;
  summary: string;
  suggestedFixes: string[];
}

/** Scoring weights for overall score calculation */
export const REVIEW_WEIGHTS = {
  issueAlignment: 0.30,
  codeQuality: 0.25,
  testQuality: 0.20,
  architecture: 0.15,
  security: 0.10,
} as const;

/**
 * Approval thresholds.
 * - overall >= 70
 * - issueAlignment >= 60
 * - no critical security issues
 */
export const APPROVAL_THRESHOLDS = {
  overallMin: 70,
  issueAlignmentMin: 60,
} as const;

// ---------------------------------------------------------------------------
// LLM adapter interface
// ---------------------------------------------------------------------------

/**
 * Adapter for calling an LLM. Implementations can wrap OpenAI, Claude,
 * or any other provider. The adapter receives a system prompt + user prompt
 * and returns the raw text response.
 */
export interface LLMAdapter {
  chat(systemPrompt: string, userPrompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the full review prompt from diff + context.
 */
export function buildReviewPrompt(diffText: string, context: ReviewContext): { system: string; user: string } {
  const system = `You are an expert code reviewer. You will review a pull request diff against the issue requirements and codebase context provided. You MUST respond with ONLY a valid JSON object matching the schema below — no markdown fences, no explanation outside the JSON.

JSON Schema:
{
  "issueAlignment": {
    "score": <number 0-100>,
    "missingRequirements": [<string>],
    "extraWork": [<string>]
  },
  "codeQuality": {
    "score": <number 0-100>,
    "findings": [
      {
        "category": "<issue-alignment|code-quality|test-quality|architecture|security>",
        "severity": "<critical|major|minor|suggestion>",
        "file": "<string, optional>",
        "line": <number, optional>,
        "message": "<string>",
        "suggestedFix": "<string, optional>"
      }
    ]
  },
  "testQuality": {
    "score": <number 0-100>,
    "coverage": "<none|smoke|partial|comprehensive>",
    "missingTests": [<string>],
    "weakTests": [<string>]
  },
  "architecture": {
    "score": <number 0-100>,
    "patternsFollowed": <boolean>,
    "concerns": [<string>]
  },
  "security": {
    "score": <number 0-100>,
    "issues": [<string>]
  },
  "summary": "<string>",
  "suggestedFixes": [<string>]
}`;

  const userParts: string[] = [];

  // Issue context block
  userParts.push("## Issue Context");
  userParts.push(`**Title:** ${context.issueContext.title}`);
  userParts.push("");
  userParts.push(context.issueContext.body.slice(0, 5000));
  if (context.issueContext.acceptanceCriteria.length > 0) {
    userParts.push("");
    userParts.push("**Acceptance Criteria:**");
    for (const ac of context.issueContext.acceptanceCriteria) {
      userParts.push(`- ${ac}`);
    }
  }

  // Dependency context block
  if (context.dependencies.length > 0) {
    userParts.push("");
    userParts.push("## Dependency Files (existing code the diff imports from)");
    for (const dep of context.dependencies) {
      userParts.push(`### ${dep.path}`);
      userParts.push("```");
      userParts.push(dep.content.slice(0, 3000));
      userParts.push("```");
    }
  }

  // Similar files block
  if (context.similarFiles.length > 0) {
    userParts.push("");
    userParts.push("## Similar Files (pattern references from the codebase)");
    for (const sf of context.similarFiles) {
      userParts.push(`### ${sf.path}`);
      userParts.push("```");
      userParts.push(sf.content.slice(0, 3000));
      userParts.push("```");
    }
  }

  // Diff block
  userParts.push("");
  userParts.push("## Diff");
  userParts.push("```diff");
  userParts.push(diffText.slice(0, 20000));
  userParts.push("```");

  // Test output block
  userParts.push("");
  userParts.push("## Test Output");
  userParts.push("```");
  userParts.push(context.testOutput.slice(0, 3000));
  userParts.push("```");

  // Review instructions
  userParts.push("");
  userParts.push("## Review Instructions");
  userParts.push("1. Does this code actually implement what the issue asks for? Check each acceptance criterion.");
  userParts.push("2. Are there logic bugs? Trace the happy path AND error paths.");
  userParts.push("3. Does it follow the patterns established in the existing codebase? (e.g., if the codebase uses EventEmitter for events, does new code do the same?)");
  userParts.push("4. Is error handling adequate? What happens when external calls fail?");
  userParts.push("5. Do the tests actually verify behavior or just check that functions exist?");
  userParts.push("6. Are there race conditions, memory leaks, or resource leaks?");
  userParts.push("7. Are types correct and specific (not `any`)?");
  userParts.push("8. Is the code the right level of abstraction?");
  userParts.push("");
  userParts.push("Respond with ONLY the JSON object. No other text.");

  return { system, user: userParts.join("\n") };
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the weighted overall score from category scores.
 */
export function calculateOverallScore(result: Pick<LLMReviewResult, "issueAlignment" | "codeQuality" | "testQuality" | "architecture" | "security">): number {
  const score =
    result.issueAlignment.score * REVIEW_WEIGHTS.issueAlignment +
    result.codeQuality.score * REVIEW_WEIGHTS.codeQuality +
    result.testQuality.score * REVIEW_WEIGHTS.testQuality +
    result.architecture.score * REVIEW_WEIGHTS.architecture +
    result.security.score * REVIEW_WEIGHTS.security;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Determine approval based on scores and security issues.
 */
export function determineApproval(result: LLMReviewResult): boolean {
  if (result.overallScore < APPROVAL_THRESHOLDS.overallMin) return false;
  if (result.issueAlignment.score < APPROVAL_THRESHOLDS.issueAlignmentMin) return false;

  // Block if any critical security issue
  const hasCriticalSecurity = result.codeQuality.findings.some(
    (f) => f.category === "security" && f.severity === "critical",
  );
  if (hasCriticalSecurity) return false;

  // Also block if security issues array mentions "critical"
  const hasCriticalSecurityIssue = result.security.issues.some(
    (issue) => issue.toLowerCase().includes("critical"),
  );
  if (hasCriticalSecurityIssue) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/** Default empty result used when parsing fails */
function emptyResult(): LLMReviewResult {
  return {
    issueAlignment: { score: 0, missingRequirements: [], extraWork: [] },
    codeQuality: { score: 0, findings: [] },
    testQuality: { score: 0, coverage: "none", missingTests: [], weakTests: [] },
    architecture: { score: 0, patternsFollowed: false, concerns: [] },
    security: { score: 0, issues: [] },
    overallScore: 0,
    approved: false,
    summary: "LLM review failed to produce a valid response",
    suggestedFixes: [],
  };
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string");
}

function parseCoverage(value: unknown): "none" | "smoke" | "partial" | "comprehensive" {
  const valid = ["none", "smoke", "partial", "comprehensive"];
  if (typeof value === "string" && valid.includes(value)) return value as "none" | "smoke" | "partial" | "comprehensive";
  return "none";
}

function parseFindings(value: unknown): LLMFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object" && typeof (v as Record<string, unknown>).message === "string")
    .map((v) => {
      const obj = v as Record<string, unknown>;
      return {
        category: (typeof obj.category === "string" ? obj.category : "code-quality") as LLMFinding["category"],
        severity: (typeof obj.severity === "string" ? obj.severity : "minor") as LLMFinding["severity"],
        file: typeof obj.file === "string" ? obj.file : undefined,
        line: typeof obj.line === "number" ? obj.line : undefined,
        message: obj.message as string,
        suggestedFix: typeof obj.suggestedFix === "string" ? obj.suggestedFix : undefined,
      };
    });
}

/**
 * Parse the raw LLM response text into a structured LLMReviewResult.
 * Resilient to markdown fences, extra whitespace, and partial responses.
 */
export function parseLLMResponse(raw: string): LLMReviewResult {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return emptyResult();
      }
    } else {
      return emptyResult();
    }
  }

  const ia = (parsed.issueAlignment ?? {}) as Record<string, unknown>;
  const cq = (parsed.codeQuality ?? {}) as Record<string, unknown>;
  const tq = (parsed.testQuality ?? {}) as Record<string, unknown>;
  const arch = (parsed.architecture ?? {}) as Record<string, unknown>;
  const sec = (parsed.security ?? {}) as Record<string, unknown>;

  const result: LLMReviewResult = {
    issueAlignment: {
      score: clampScore(ia.score),
      missingRequirements: toStringArray(ia.missingRequirements),
      extraWork: toStringArray(ia.extraWork),
    },
    codeQuality: {
      score: clampScore(cq.score),
      findings: parseFindings(cq.findings),
    },
    testQuality: {
      score: clampScore(tq.score),
      coverage: parseCoverage(tq.coverage),
      missingTests: toStringArray(tq.missingTests),
      weakTests: toStringArray(tq.weakTests),
    },
    architecture: {
      score: clampScore(arch.score),
      patternsFollowed: arch.patternsFollowed === true,
      concerns: toStringArray(arch.concerns),
    },
    security: {
      score: clampScore(sec.score),
      issues: toStringArray(sec.issues),
    },
    overallScore: 0,
    approved: false,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    suggestedFixes: toStringArray(parsed.suggestedFixes),
  };

  result.overallScore = calculateOverallScore(result);
  result.approved = determineApproval(result);

  return result;
}

// ---------------------------------------------------------------------------
// Main reviewer class
// ---------------------------------------------------------------------------

export class LLMReviewer {
  private readonly llm: LLMAdapter;

  constructor(llm: LLMAdapter) {
    this.llm = llm;
  }

  /**
   * Perform a deep LLM-powered code review.
   */
  async review(diffText: string, context: ReviewContext): Promise<LLMReviewResult> {
    const { system, user } = buildReviewPrompt(diffText, context);
    const raw = await this.llm.chat(system, user);
    return parseLLMResponse(raw);
  }

  /**
   * Format an LLM review result as a markdown PR comment.
   */
  static formatReviewComment(result: LLMReviewResult): string {
    const status = result.approved ? "APPROVED" : "CHANGES REQUESTED";
    const lines: string[] = [
      `## LLM Deep Review: ${status} (Score: ${result.overallScore}/100)`,
      "",
      `**Issue Alignment:** ${result.issueAlignment.score}/100 | **Code Quality:** ${result.codeQuality.score}/100 | **Test Quality:** ${result.testQuality.score}/100 | **Architecture:** ${result.architecture.score}/100 | **Security:** ${result.security.score}/100`,
      "",
    ];

    if (result.summary) {
      lines.push(`### Summary`, result.summary, "");
    }

    if (result.issueAlignment.missingRequirements.length > 0) {
      lines.push("### Missing Requirements");
      for (const req of result.issueAlignment.missingRequirements) {
        lines.push(`- ${req}`);
      }
      lines.push("");
    }

    if (result.codeQuality.findings.length > 0) {
      lines.push("### Code Findings");
      for (const f of result.codeQuality.findings) {
        const loc = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
        const icon = f.severity === "critical" ? "🔴" : f.severity === "major" ? "🟠" : f.severity === "minor" ? "🟡" : "💡";
        lines.push(`${icon} **[${f.severity}]**${loc}: ${f.message}`);
      }
      lines.push("");
    }

    if (result.testQuality.missingTests.length > 0) {
      lines.push("### Missing Tests");
      for (const t of result.testQuality.missingTests) {
        lines.push(`- ${t}`);
      }
      lines.push("");
    }

    if (result.testQuality.weakTests.length > 0) {
      lines.push("### Weak Tests");
      for (const t of result.testQuality.weakTests) {
        lines.push(`- ${t}`);
      }
      lines.push("");
    }

    if (result.architecture.concerns.length > 0) {
      lines.push("### Architecture Concerns");
      for (const c of result.architecture.concerns) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }

    if (result.security.issues.length > 0) {
      lines.push("### Security Issues");
      for (const s of result.security.issues) {
        lines.push(`- ${s}`);
      }
      lines.push("");
    }

    if (result.suggestedFixes.length > 0) {
      lines.push("### Suggested Fixes");
      for (const fix of result.suggestedFixes) {
        lines.push(`- ${fix}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Build fix instructions from an LLM review result for the code agent.
   */
  static buildFixInstructions(result: LLMReviewResult): string {
    const sections: string[] = [
      "# LLM Review Findings to Fix",
      "",
      `Overall score: ${result.overallScore}/100 — ${result.approved ? "APPROVED" : "BLOCKED"}`,
      "",
    ];

    if (result.issueAlignment.missingRequirements.length > 0) {
      sections.push("## Missing Requirements (must implement)");
      for (const req of result.issueAlignment.missingRequirements) {
        sections.push(`- ${req}`);
      }
      sections.push("");
    }

    if (result.codeQuality.findings.length > 0) {
      sections.push("## Code Quality Findings");
      for (const f of result.codeQuality.findings) {
        const loc = f.file ? ` in \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
        sections.push(`- **[${f.severity}]**${loc}: ${f.message}`);
        if (f.suggestedFix) {
          sections.push(`  - Suggested fix: ${f.suggestedFix}`);
        }
      }
      sections.push("");
    }

    if (result.testQuality.missingTests.length > 0) {
      sections.push("## Missing Tests (add these)");
      for (const t of result.testQuality.missingTests) {
        sections.push(`- ${t}`);
      }
      sections.push("");
    }

    if (result.security.issues.length > 0) {
      sections.push("## Security Issues (must fix)");
      for (const s of result.security.issues) {
        sections.push(`- ${s}`);
      }
      sections.push("");
    }

    if (result.suggestedFixes.length > 0) {
      sections.push("## Specific Fixes");
      for (const fix of result.suggestedFixes) {
        sections.push(`- ${fix}`);
      }
      sections.push("");
    }

    return sections.join("\n");
  }
}
