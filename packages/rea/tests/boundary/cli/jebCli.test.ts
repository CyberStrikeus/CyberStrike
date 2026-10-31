import { expect, it } from "vitest";

import { serveCli } from "./cliServeHarness.js";
import { createTestCli } from "../../support/cli/cliFixture.js";
import { createTestProcessRegistry } from "../../support/process/processFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  startJebMcpFixture,
  jebPrimaryResponses,
} from "../../fixtures/jebMcp.js";

const jebEnvironment = {
  REA_JEB_MCP_URL: "http://127.0.0.1:1/mcp",
};

const serve = async (
  argv: readonly string[],
): Promise<{ readonly stdout: string; readonly exitCode: number }> =>
  serveCli(argv, jebEnvironment);

it("reports an unreachable engine endpoint with recovery guidance", async () => {
  const result = await serve(["inspect-jeb-client", "--json"]);
  expect(result.stdout).toContain("capability_unavailable");
  expect(result.stdout).toContain("REA_JEB_MCP_URL");
});

it("validates decompile item input before contacting the engine", async () => {
  const result = await serve(["decompile-jeb-item", "", "method", "--json"]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: [
      {
        code: "too_small",
        path: "item-address",
      },
    ],
  });
});

it.each([
  { setting: "REA_JEB_MCP_URL", value: "http://localhost:8425/mcp" },
  { setting: "REA_JEB_MCP_TIMEOUT_MS", value: "1.5" },
])(
  "reports invalid $setting without breaking other commands",
  async ({ setting, value }) => {
    const environment = { [setting]: value };
    const jeb = await serveCli(["inspect-jeb-client", "--json"], environment);
    expect(JSON.parse(jeb.stdout)).toMatchObject({
      code: "configuration_invalid",
      details: { settings: [{ setting }] },
    });
    const capabilities = await serveCli(
      ["capabilities", "--json"],
      environment,
    );
    expect(capabilities.exitCode).toBe(0);
    expect(JSON.parse(capabilities.stdout)).toMatchObject({
      capabilities: expect.any(Array),
    });
  },
);

it.each(
  [
    {
      operation: "list_jeb_units",
      tool: "list_units",
      argv: ["list-jeb-units", "--count", "2", "--json"],
      input: { count: 2, index: 0 },
    },
    {
      operation: "decompile_jeb_item",
      tool: "decompile_code_item",
      input: {
        item_address: "LSample;->value()I",
        item_kind: "method",
        unit_path: "sample.dex",
      },
      argv: [
        "decompile-jeb-item",
        "LSample;->value()I",
        "method",
        "--unit-path",
        "sample.dex",
        "--json",
      ],
    },
    {
      operation: "open_jeb_project",
      tool: "open_project",
      argv: ["open-jeb-project", "sample.apk", "--json"],
      input: { path: "sample.apk" },
      providerInput: { file_path: "sample.apk" },
    },
  ].flatMap((request) =>
    ["metadata-refusal", "primary-refusal", "success"].map((stage) => ({
      ...request,
      stage,
    })),
  ),
)(
  "preserves $operation attribution and primary payload with $stage",
  async ({ operation, tool, argv, input, providerInput, stage }) => {
    const refusal = {
      success: false,
      message: "Selected stage refused",
      error: {
        code: "future_engine_code",
        recovery_required_before_retry: false,
        recovery_tool: "get_client_information",
      },
    };
    const fixture = await startJebMcpFixture((name) =>
      (stage === "metadata-refusal" && name === "get_client_information") ||
      (stage === "primary-refusal" && name === tool)
        ? refusal
        : jebPrimaryResponses[name]!,
    );
    const processes = createTestProcessRegistry();
    const cli = createTestCli(processes);
    try {
      const home = await createTestTempDirectory("rea-jeb-attribution-cli-");
      const result = await cli.run({
        arguments: argv,
        environment: { HOME: home, REA_JEB_MCP_URL: fixture.endpoint },
        timeoutMs: 10_000,
      });
      const output = JSON.parse(result.stdout);
      if (stage === "success") {
        expect(result.exitCode).toBe(0);
        expect(output.operation).toBe(operation);
        expect(output.raw_result).toEqual(jebPrimaryResponses[tool]);
      } else {
        expect(result.exitCode).toBe(1);
        expect(output).toMatchObject({
          code: "execution_failure",
          message: refusal.message,
          details: {
            provider_id: "jeb",
            operation,
            diagnostics: {
              endpoint: fixture.endpoint,
              upstream_response: refusal,
            },
          },
        });
        if (stage === "primary-refusal") {
          expect(output.details.diagnostics.input).toEqual(input);
          expect(output.details).not.toHaveProperty("partial_observation");
        } else {
          expect(output.details.diagnostics).not.toHaveProperty("input");
          expect(output.details.partial_observation).toMatchObject({
            operation,
            raw_result: jebPrimaryResponses[tool],
          });
        }
      }
      expect(fixture.calls).toEqual(
        stage === "primary-refusal" ? [tool] : [tool, "get_client_information"],
      );
      expect(fixture.requests[0]).toEqual({
        name: tool,
        arguments: providerInput ?? input,
      });
    } finally {
      await processes.shutdown();
      await fixture.close();
    }
  },
);
