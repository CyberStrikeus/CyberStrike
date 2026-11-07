export interface ReadinessPullRequest {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly draft: boolean;
  readonly body: string | null;
  readonly head: { readonly sha: string };
  readonly base: { readonly ref: string };
}
export interface ReadinessResult {
  readonly state: "success" | "failure" | "pending";
  readonly description: string;
}
export interface ReadinessGitHub {
  graphql(
    query: string,
    variables: {
      readonly owner: string;
      readonly name: string;
      readonly after: string | null;
    },
  ): Promise<unknown>;
  readonly rest: {
    readonly pulls: {
      get(input: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: ReadinessPullRequest }>;
    };
    readonly repos: {
      createCommitStatus(
        input: ReadinessResult & {
          owner: string;
          repo: string;
          sha: string;
          context: string;
          target_url: string;
        },
      ): Promise<unknown>;
      readonly listPullRequestsAssociatedWithCommit: unknown;
    };
  };
  paginate(
    method: unknown,
    input: {
      owner: string;
      repo: string;
      commit_sha: string;
      per_page: number;
    },
  ): Promise<
    readonly Pick<ReadinessPullRequest, "number" | "state" | "head">[]
  >;
}
export function evaluateReadiness(
  pull: Pick<ReadinessPullRequest, "body" | "draft">,
  template: string,
): ReadinessResult;
export function runReadinessCheck(input: {
  github: ReadinessGitHub;
  context: {
    repo: { owner: string; repo: string };
    payload: {
      pull_request?: { number: number };
      inputs?: { pull_request_number?: string };
    };
    serverUrl: string;
    runId: number;
  };
  core: { info(message: string): void; setFailed(message: string): void };
}): Promise<ReadinessResult | undefined>;
