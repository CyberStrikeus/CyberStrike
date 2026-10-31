import type {
  McpPhaseBudget,
  McpStartupBudgets,
} from "../../src/config/mcpStartupBudgets.js";

interface McpProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly policy: McpStartupBudgets;
}

interface McpModuleProfileOptions extends McpProcessOptions {
  readonly packageName: string;
}

interface RssMeasurement {
  readonly supported: boolean;
  readonly method: string | null;
  readonly peak_bytes: number | null;
}

/** Measure the first usable MCP catalog through a child-process boundary. */
export function measureMcpStartup(options: McpProcessOptions): Promise<{
  readonly process_started_to_initialized_ms: number;
  readonly initialized_to_tools_list_ms: number;
  readonly process_started_to_tools_list_ms: number;
  readonly listed_tool_count: number;
  readonly rss: RssMeasurement;
}>;

/** Profile ESM file loading in a separate diagnostic MCP child. */
export function profileMcpModuleLoading(
  options: McpModuleProfileOptions,
): Promise<{
  readonly supported: true;
  readonly method: "node-debug-esm";
  readonly unique_file_modules: number;
  readonly unique_package_modules: number;
  readonly unique_dependency_modules: number;
  readonly debug_lines: number;
  readonly truncated: boolean;
}>;

/** Parse Linux procfs VmRSS text into bytes. */
export function parseLinuxVmRssBytes(status: string): number | null;

/** Name one MCP startup phase budget. Mirrors `mcpPhaseBudgetRecovery`. */
export function mcpStartupPhaseBudgetRecovery(budget: McpPhaseBudget): string;

/** Collect unique file-backed ESM module URLs from Node diagnostics. */
export function createEsmModuleProfileCollector(packageName?: string): {
  append(chunk: string): void;
  result(): {
    readonly supported: true;
    readonly method: "node-debug-esm";
    readonly unique_file_modules: number;
    readonly unique_package_modules: number;
    readonly unique_dependency_modules: number;
    readonly debug_lines: number;
    readonly truncated: boolean;
  };
};
