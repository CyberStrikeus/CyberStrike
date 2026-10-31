import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { startListeningProcess } from "../../support/mcp/streamableHttpProcess.js";
import {
  processTest,
  type TestProcesses,
} from "../../support/process/processFixture.js";

const openHttp = async (
  processes: TestProcesses,
  maximum: string | undefined,
  outputProfile: "full" | "off" = "full",
) => {
  const root = await createTestTempDirectory("rea-input-capacity-http-");
  const { url, stderr, child } = await startListeningProcess(
    processes,
    ["mcp", "--http", "--port", "0"],
    {
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"),
      NODE_OPTIONS: "--max-old-space-size=3072",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: outputProfile,
      ...(maximum === undefined ? {} : { REA_MCP_MAX_INPUT_ELEMENTS: maximum }),
    },
  );
  const client = new Client({ name: "input-capacity-http", version: "1" });
  const transport = new StreamableHTTPClientTransport(url, {
    // SDK output-schema compilation can outlive an idle pooled socket on two
    // CPUs. Keep this admission test independent of that client-side race.
    requestInit: { headers: { Connection: "close" } },
  });
  onTestFinished(() => client.close());
  await client.connect(transport);
  return { root, client, stderr, child };
};

processTest(
  "bounds HTTP validation before building amplified diagnostics and keeps serving",
  async ({ processes }) => {
    const { root, client, stderr, child } = await openHttp(processes, "8192");
    const catalog = await client.listTools();
    const declared = catalog.tools.find(
      (tool) => tool.name === "compare_bundles",
    );
    expect(declared?.inputSchema).toMatchObject({ type: "object" });
    const arguments_ = {
      left_bundle_path: join(root, "absent-left"),
      right_bundle_path: join(root, "absent-right"),
      record_pairs: Array.from({ length: 8192 }, () => 0),
    };
    const before = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    expect(before.isError).not.toBe(true);
    const observations: { code: string; bytes: number; elapsed_ms: number }[] =
      [];
    for (let repeat = 0; repeat < 2; repeat++) {
      const start = performance.now();
      const result = await client
        .callTool({ name: "compare_bundles", arguments: arguments_ })
        .catch((cause: unknown) => {
          throw new Error(
            `HTTP capacity probe failed; exit=${String(child.exitCode)} signal=${String(child.signalCode)}; listener diagnostic tail:\n${stderr().slice(-3000)}`,
            { cause },
          );
        });
      const elapsed_ms = performance.now() - start;
      const { error } = parseMcpToolError(result);
      observations.push({
        code: error.code,
        bytes: Buffer.byteLength(JSON.stringify(result)),
        elapsed_ms,
      });
      await client.ping();
    }
    const healthy = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    expect(healthy.isError).not.toBe(true);
    console.info(
      "MCP capacity completed-task observations",
      JSON.stringify({
        request_json_bytes: Buffer.byteLength(JSON.stringify(arguments_)),
        catalog_json_bytes: Buffer.byteLength(JSON.stringify(catalog)),
        calls: observations,
        model_tokens: "unmeasured",
      }),
    );
    for (const observed of observations) {
      expect(observed.code).toBe("resource_constraint");
      expect(observed.bytes).toBeLessThan(4096);
    }
  },
  90_000,
);

processTest(
  "bounds missing-field Evidence expansion at the default admission boundary",
  async ({ processes }) => {
    const { client } = await openHttp(processes, undefined, "off");
    const observations = [];
    for (const count of [1_019, 1_020]) {
      const arguments_ = {
        functions: Array.from({ length: count }, () => ({})),
        start: { address: "0x1" },
        goal: { address: "0x2" },
      };
      const start = performance.now();
      const result = await client.callTool({
        name: "build_call_path",
        arguments: arguments_,
      });
      const elapsed_ms = performance.now() - start;
      const error = parseMcpToolError(result).error;
      if (count === 1_019) {
        // Three root members and two address members fill the remaining five.
        // Admitted source carriers reach the Evidence owner, which rejects
        // the first invalid record without expanding every missing field.
        expect(error).toMatchObject({
          code: "evidence_integrity_mismatch",
          category: "integrity_mismatch",
          message: expect.stringContaining("at evidence_id"),
          details: { diagnostics: { input_path: ["functions", 0] } },
        });
      } else {
        expect(error.code).toBe("resource_constraint");
        expect(error.details).toMatchObject({
          resource: "transport",
          reported_limits: { max_input_elements: 1_024 },
        });
      }
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
      observations.push({
        count,
        code: error.code,
        argument_json_bytes: Buffer.byteLength(JSON.stringify(arguments_)),
        response_json_bytes: Buffer.byteLength(JSON.stringify(result)),
        elapsed_ms,
      });
      await client.ping();
    }
    const healthy = await client.callTool({
      name: "inspect_analysis_settings",
      arguments: {},
    });
    expect(healthy.isError).not.toBe(true);
    console.info(
      "MCP structured admission boundary observations",
      JSON.stringify(observations),
    );
  },
  90_000,
);

processTest(
  "refuses a sub-4MiB HTTP payload under the default allowance without expanded diagnostics",
  async ({ processes }) => {
    const { root, client } = await openHttp(processes, undefined, "off");
    const paths = {
      left_bundle_path: join(root, "absent-left"),
      right_bundle_path: join(root, "absent-right"),
    };
    // Prove this exact server is guarded before constructing the larger probe.
    // A missing/regressed guard therefore fails on the bounded small fixture.
    const calibration = await client.callTool({
      name: "compare_bundles",
      arguments: {
        ...paths,
        record_pairs: Array.from({ length: 1_024 }, () => 0),
      },
    });
    const calibratedError = parseMcpToolError(calibration).error;
    expect(calibratedError.code).toBe("resource_constraint");
    expect(calibratedError.details).toMatchObject({
      resource: "transport",
      reported_limits: { max_input_elements: 1_024 },
    });
    const arguments_ = {
      ...paths,
      record_pairs: Array.from({ length: 2_090_000 }, () => 0),
    };
    const argumentBytes = Buffer.byteLength(JSON.stringify(arguments_));
    expect(argumentBytes).toBeLessThan(4 * 1024 * 1024 - 4096);
    const start = performance.now();
    const result = await client.callTool({
      name: "compare_bundles",
      arguments: arguments_,
    });
    const elapsed_ms = performance.now() - start;
    const { error } = parseMcpToolError(result);
    expect(error.code).toBe("resource_constraint");
    expect(error.details).toMatchObject({
      resource: "transport",
      reported_limits: { max_input_elements: 1_024 },
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
    await client.ping();
    const healthy = await client.callTool({
      name: "inspect_analysis_settings",
      arguments: {},
    });
    expect(healthy.isError).not.toBe(true);
    console.info(
      "MCP capacity guarded large probe",
      JSON.stringify({
        argument_json_bytes: argumentBytes,
        response_json_bytes: Buffer.byteLength(JSON.stringify(result)),
        elapsed_ms,
      }),
    );
  },
  90_000,
);
