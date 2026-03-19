/**
 * PR Review Agent.
 *
 * Analyzes diffs for quality issues using configurable static rules
 * and optional LLM-powered deep review. Returns a score and findings
 * that determine whether a PR should be auto-merged or blocked.
 */

import { builtinRules, parseDiff, type ReviewFinding, type ReviewRule, type DiffFile } from "./review-rules";

export type { ReviewFinding };

export interface PRReviewResult {
  approved: boolean;
  score: number;
  findings: ReviewFinding[];
  summary: string;
}

export interface PRReviewConfig {
  /** Whether PR review is enabled (default: true) */
  enabled?: boolean;
  /** Minimum score to auto-approve (default: 70) */
  minScore?: number;
  /** Rule names to check (default: all builtin rules) */
  rules?: string[];
  /** Use LLM for deep review (default: true) */
  useLLM?: boolean;
  /** Max errors before blocking merge (default: 0) */
  maxErrors?: number;
  /** Max warnings before blocking merge (default: 5) */
  maxWarnings?: number;
}

export class PRReviewer {
  private readonly config: PRReviewConfig;
  private readonly rules: ReviewRule[];

  constructor(config?: PRReviewConfig) {
    this.config = config ?? {};
    this.rules = this.resolveRules();
  }

  private resolveRules(): ReviewRule[] {
    const ruleNames = this.config.rules;
    if (!ruleNames || ruleNames.length === 0) {
      return Object.values(builtinRules);
    }
    const resolved: ReviewRule[] = [];
    for (const name of ruleNames) {
      const rule = builtinRules[name];
      if (rule) resolved.push(rule);
    }
    return resolved;
  }

  /**
   * Review a diff string and list of changed files.
   */
  review(diffText: string, filesChanged: string[]): PRReviewResult {
    const diffFiles = parseDiff(diffText);

    // Run all rules
    const findings: ReviewFinding[] = [];
    for (const rule of this.rules) {
      findings.push(...rule.check(diffFiles));
    }

    // Calculate score
    const score = this.calculateScore(findings);

    // Determine approval
    const minScore = this.config.minScore ?? 70;
    const maxErrors = this.config.maxErrors ?? 0;
    const maxWarnings = this.config.maxWarnings ?? 5;

    const errorCount = findings.filter((f) => f.severity === "error").length;
    const warningCount = findings.filter((f) => f.severity === "warning").length;

    const approved =
      score >= minScore &&
      errorCount <= maxErrors &&
      warningCount <= maxWarnings;

    const summary = this.buildSummary(findings, score, approved);

    return { approved, score, findings, summary };
  }

  /**
   * Calculate a quality score from 0-100 based on findings.
   */
  private calculateScore(findings: ReviewFinding[]): number {
    let score = 100;
    for (const finding of findings) {
      switch (finding.severity) {
        case "error":
          score -= 20;
          break;
        case "warning":
          score -= 5;
          break;
        case "info":
          score -= 1;
          break;
      }
    }
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Build a human-readable summary of the review.
   */
  private buildSummary(findings: ReviewFinding[], score: number, approved: boolean): string {
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;
    const infos = findings.filter((f) => f.severity === "info").length;

    const status = approved ? "APPROVED" : "BLOCKED";
    const lines = [
      `**Review ${status}** — Score: ${score}/100`,
      "",
      `- Errors: ${errors}`,
      `- Warnings: ${warnings}`,
      `- Info: ${infos}`,
    ];

    if (findings.length > 0) {
      lines.push("", "### Findings", "");
      for (const f of findings) {
        const loc = f.line ? `:${f.line}` : "";
        const icon = f.severity === "error" ? "❌" : f.severity === "warning" ? "⚠️" : "ℹ️";
        lines.push(`${icon} **${f.rule}** \`${f.file}${loc}\`: ${f.message}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format findings for posting as a PR comment.
   */
  formatFindings(result: PRReviewResult): string {
    return `## TierZero Review: ${result.score}/100\n\n${result.summary}`;
  }
}
