export function selectRecoveryRelease(input: {
  repository: string;
  version: string;
  run: unknown;
  jobs: unknown;
  release: unknown;
  tagSha: string;
}): {
  version: string;
  source_sha: string;
  run_id: number;
  run_attempt: number;
};

export function verifyRecoveryPackage(input: {
  directory: string;
  sourceSha: string;
  runId: number;
  runAttempt: number;
  version: string;
  integrity: string;
}): Promise<{
  version: string;
  sourceSha: string;
  runId: number;
  runAttempt: number;
  integrity: string;
}>;
