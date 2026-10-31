export interface PrCiHead {
  repositoryId: number | null;
  repository?: string | null;
  ref: string | null;
  sha: string | null;
}

export interface PrCiPullRequest {
  number: number | null;
  draft?: boolean;
  identityValid: boolean;
  mergeable?: boolean;
  head: PrCiHead;
  [key: string]: unknown;
}

export interface PrCiWorkflowRun {
  id?: number;
  run_attempt?: number;
  event?: string;
  head_branch?: string;
  head_repository?: { id?: number | null } | null;
  head_sha?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  html_url?: string;
  pull_requests?: Array<{
    number?: number;
    head?: { sha?: string; repo?: { id?: number | null } } | null;
  }>;
  [key: string]: unknown;
}

export interface PrCiClassification {
  category: string;
  reason: string;
  runs: Array<Record<string, unknown>>;
}

export interface PrCiHealthReport {
  schemaVersion: 1;
  observedAt: string;
  repository: string;
  repositoryId: number | null;
  defaultBranch: string;
  lookbackDays: number;
  scan: {
    status: "complete" | "partial";
    cutoff: string;
    pullRequestPages: number;
    workflowRunPages: number;
    pullRequestInventoryComplete: boolean;
    workflowRunInventoryComplete: boolean;
    pullRequestDetailsFetched: number;
    pullRequestDetailsLimit: number;
    apiRequests: number;
    apiRequestLimit: number;
    errors: string[];
  };
  counts: Record<string, number>;
  pullRequests: Array<PrCiPullRequest & { ci: PrCiClassification }>;
}

export function collectPrCiHealth(options: {
  repository: string;
  repositoryId?: number | string | null;
  defaultBranch: string;
  lookbackDays?: number;
  now?: number;
  apiRequest?: GitHubApiRequest;
}): Promise<PrCiHealthReport>;

export function classifyPrCi(input: {
  pull: PrCiPullRequest;
  runs: Array<{ run: PrCiWorkflowRun; basis: string }>;
  runsComplete: boolean;
  pullRequestInventoryComplete: boolean;
  ambiguousRuns: Array<{ run: PrCiWorkflowRun; basis: string }>;
}): PrCiClassification;

export function matchRunToPullRequest(input: {
  run: PrCiWorkflowRun;
  pull: PrCiPullRequest;
  identityCounts: Map<string, number>;
  inventoryComplete?: boolean;
}): { kind: "none" } | { kind: "ambiguous" } | { kind: "match"; basis: string };

export function writePrCiHealthReport(
  report: PrCiHealthReport,
  outputDirectory?: string,
): Promise<{ jsonPath: string; markdownPath: string }>;

export function renderMarkdownSummary(report: PrCiHealthReport): string;
import type { GitHubApiRequest } from "./github-api.mjs";
