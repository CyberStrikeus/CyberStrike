import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../../scripts/lib/mcp-verification-environment.mjs";
import type { SharedMcpCall, TestCli } from "./cliFixture.js";

const execute = promisify(execFile);

export const runNodeJsonControl = async (
  root: string,
  filename: string,
): Promise<unknown> => {
  const { stdout } = await execute(process.execPath, [filename], {
    cwd: root,
    timeout: 5_000,
  });
  return JSON.parse(stdout) as unknown;
};

/**
 * Use an explicit caller when the test owns the server. Otherwise reuse the
 * file-scoped session from `cliTest`, and start a fresh server only for
 * drivers created outside that fixture.
 */
export const resolveJavaScriptApplicationMcpCall = async (
  cli: TestCli,
  mcpCall: SharedMcpCall | undefined,
): Promise<SharedMcpCall> => {
  if (mcpCall !== undefined) return mcpCall;
  if (cli.sharedMcpCall !== undefined) return cli.sharedMcpCall();
  return (await connectLocalToolsMcp(INLINE_EVIDENCE_MCP_ENVIRONMENT)).call;
};

/**
 * Analyze a directory. A supplied MCP caller reuses its test-owned connection.
 * CLI uses the driver's file-scoped process when present, and a fresh process
 * otherwise.
 */
export const analyzeJavaScriptDirectory = async (
  surface: "CLI" | "stdio MCP",
  cli: TestCli,
  root: string,
  {
    sourcePaths = [],
    mcpCall,
  }: {
    readonly sourcePaths?: readonly string[];
    readonly mcpCall?: SharedMcpCall | undefined;
  } = {},
) => {
  let document: unknown;
  if (surface === "CLI") {
    const run = cli.sharedCliRun ?? ((invocation) => cli.run(invocation));
    const response = await run({
      arguments: [
        "analyze-javascript-application",
        root,
        ...sourcePaths.flatMap((path) => ["--source-path", path]),
        "--format",
        "json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, response.stderr).toBe(0);
    document = response.json;
  } else {
    const call = await resolveJavaScriptApplicationMcpCall(cli, mcpCall);
    const response = await call("analyze_javascript_application", {
      input_path: root,
      format: "directory",
      ...(sourcePaths.length === 0 ? {} : { source_paths: sourcePaths }),
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    document = response.structuredContent;
  }
  return z
    .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
    .parse(document).normalized_result;
};
