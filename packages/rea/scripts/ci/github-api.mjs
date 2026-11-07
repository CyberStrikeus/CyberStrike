import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

/** Create a bounded GitHub CLI JSON transport with GET-only authority. */
export function createGhApiRequest({ env = process.env, now = Date.now } = {}) {
  return async (method, endpoint, budget) => {
    if (method !== "GET")
      throw new Error(
        "GitHub API transport supports read-only GET requests only",
      );
    const remaining = budget.limitMs - (now() - budget.startedAt);
    if (remaining <= 0) throw new Error("lookup_time_budget_exhausted");
    const { stdout } = await execFileAsync(
      "gh",
      ["api", "--method", "GET", endpoint],
      {
        env,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        timeout: Math.min(REQUEST_TIMEOUT_MS, remaining),
      },
    );
    try {
      return JSON.parse(stdout);
    } catch (cause) {
      throw new Error("github_api_malformed_json", { cause });
    }
  };
}
