import type { NormalizedWorkflowRun } from "./workflow-run.mjs";
import type { StaticTaskContext } from "./static-task-context.mjs";

export interface CiRun {
  readonly id?: string | number;
  readonly run_attempt?: number;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly event?: string;
  readonly path?: string;
  readonly head_sha?: string;
  readonly head_branch?: string;
  readonly repository?: { readonly full_name?: string };
  readonly pull_requests?: readonly {
    readonly base?: {
      readonly sha?: string;
      readonly repo?: { readonly full_name?: string };
    };
  }[];
}

export interface CiJob {
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly run_id?: number;
  readonly run_attempt?: number;
}

export interface StaticDiagnostic {
  readonly kind: "lint" | "jscpd";
  readonly path?: string;
  readonly paths?: readonly string[];
  readonly code?: string;
  readonly message?: string;
  readonly severity?: string;
}

export interface StaticEvidence {
  readonly context: StaticTaskContext;
  readonly diagnostics: readonly StaticDiagnostic[];
}

export function classifyFailure(input: {
  repository: string;
  defaultBranch: string;
  run: CiRun & NormalizedWorkflowRun;
  job: CiJob;
  diagnostics: readonly StaticDiagnostic[];
  context: StaticTaskContext;
  mainRun: CiRun & NormalizedWorkflowRun;
  mainJob: CiJob;
  mainDiagnostics: readonly StaticDiagnostic[];
  mainContext: StaticTaskContext;
  executionSourcesVerified: boolean;
  ancestry: { status: string; mergeBaseSha: string | null };
  blobs: Readonly<Record<string, boolean>>;
}): {
  classification: "matching-main-diagnostics" | "unknown";
  reason: string;
};

export function diagnosticPaths(item: StaticDiagnostic): readonly string[];
export function isFailedConclusion(
  value: unknown,
): value is "failure" | "timed_out";
export function isEligibleMainRun(
  run: Record<string, unknown>,
  defaultBranch: string,
  repository: string,
): boolean;
export function pullRequestBaseSha(
  run: Record<string, unknown>,
  repository: string,
): string | null;
export function safeSha(value: unknown): string | null;
export function validRepoPath(value: unknown): value is string;
export function selectStaticCheckArtifact(
  page: unknown,
  run: Pick<CiRun, "id" | "head_sha">,
  runAttempt: number,
  name?: string,
): unknown | null;

export function readStaticCheckArtifact(options: {
  repository: string;
  artifactId: number | string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<StaticEvidence>;

export function parseStaticArchive(
  archivePath: string,
): Promise<StaticEvidence>;
