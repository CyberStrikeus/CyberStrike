export interface GitHubApiBudget {
  requests: number;
  startedAt: number;
  limitMs: number;
}

export type GitHubApiRequest = (
  method: string,
  endpoint: string,
  budget: GitHubApiBudget,
) => Promise<unknown>;

export function createGhApiRequest(options?: {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): GitHubApiRequest;
