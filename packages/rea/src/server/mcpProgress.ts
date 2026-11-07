import type { ServerContext } from "@modelcontextprotocol/server";
import type { ProgressReporter } from "../application/ProgressReporter.js";
import {
  createProgressReporter,
  silentProgressReporter,
} from "../application/ProgressReporter.js";

export interface McpProgressContext {
  readonly mcpReq: Pick<ServerContext["mcpReq"], "_meta" | "notify">;
}

/** Adapt the request's negotiated MCP progress token to application progress. */
export const mcpProgressReporter = (
  context: McpProgressContext,
): ProgressReporter => {
  const token = context.mcpReq._meta?.progressToken;
  if (token === undefined) return silentProgressReporter;
  const reporter = createProgressReporter(
    async (update) => {
      try {
        await context.mcpReq.notify({
          method: "notifications/progress",
          params: {
            progressToken: token,
            // Status phases can repeat their work count while waiting. The
            // protocol requires every notification to advance; count emitted
            // observations without inventing a total amount of analysis work.
            progress: update.sequence,
            message: `${update.phase}: ${update.message}`,
          },
        });
      } catch (cause: unknown) {
        // Progress is observational; transport failure cannot change tool truth.
        void cause;
      }
    },
    { minimumIntervalMs: 100 },
  );
  return {
    // Provider child operations can each complete before their enclosing
    // workflow does. MCP progress uses the emitted sequence, not these local
    // phase counts, so reset them before the shared monotonic check.
    report: (update) =>
      reporter.report({ ...update, completed: 0, total: null }),
  };
};
