import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../../scripts/lib/mcp-verification-environment.mjs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, onTestFinished } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const compareContract = toolContract("compare_application_versions");
const analyzeContract = toolContract("analyze_javascript_application");
const expectInputFailure = (
  value: unknown,
  path: string,
  message: string,
): void => {
  expect(value).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: [path], message: expect.stringContaining(message) }],
    },
  });
};
const runJson = async (
  cli: TestCli,
  root: string,
  command: string,
  input: unknown,
  evidenceBundle?: string,
) => {
  const path = join(root, "request.json");
  await writeFile(path, JSON.stringify(input));
  // These JSON commands share no provider state; reuse the fixture-owned CLI
  // process so the matrix measures validation rather than repeated startup.
  const run = cli.sharedCliRun?.bind(cli) ?? cli.run.bind(cli);
  return run({
    arguments: [
      command,
      path,
      "--json",
      ...(evidenceBundle === undefined
        ? []
        : ["--evidence-bundle", evidenceBundle]),
    ],
    cwd: root,
    environment: { REA_LOG_LEVEL: "silent" },
  });
};
const connectMcp = async (root: string) => {
  const client = new Client({
    name: "application-input-identities",
    version: "1",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_CACHE_HOME: join(root, "cache"),
      REA_LOG_LEVEL: "silent",
      ...INLINE_EVIDENCE_MCP_ENVIRONMENT,
    },
  });
  onTestFinished(async () => {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  });
  await client.connect(transport);
  const tools = new Map(
    (await client.listTools()).tools.map((tool) => [tool.name, tool]),
  );
  const call = (name: string, arguments_: Record<string, unknown> = {}) => {
    const definition = tools.get(name);
    if (definition === undefined)
      throw new Error(`Missing advertised tool ${name}`);
    return client.callTool(
      { name, arguments: arguments_ },
      { toolDefinition: definition },
    );
  };
  return { client, tools, call };
};

type Application = ReturnType<typeof analyzeContract.outputSchema.parse>;
type WorkflowContext = {
  cli: TestCli;
  root: string;
  call: Awaited<ReturnType<typeof connectMcp>>["call"];
  application: Application;
  other: Application;
  reference: { kind: string; evidence_id: string };
  otherReference: { kind: string; evidence_id: string };
};
const selectors = {
  left_module_path: "main.mjs",
  left_export_name: "get",
  right_module_path: "main.mjs",
  right_export_name: "get",
};
const seed = { kind: "module", value: "main.mjs", match: "contains" };

const checkComparisonIdentities = async ({
  cli,
  root,
  call,
  application,
  reference,
}: WorkflowContext) => {
  for (const [name, command, extra] of [
    ["compare_application_versions", "compare-application-versions", {}],
    [
      "compare_javascript_export_shapes",
      "compare-javascript-export-shapes",
      selectors,
    ],
  ] as const) {
    for (const [a, b] of [
      [application, application],
      [reference, reference],
      [application, reference],
      [reference, application],
    ]) {
      const response = await call(name, { left: a, right: b, ...extra });
      expect(response.isError).toBe(true);
      expectInputFailure(
        parseMcpToolError(response).error,
        "right",
        "Evidence must be distinct",
      );
    }
    const invalid = await runJson(cli, root, command, {
      left: application,
      right: application,
      ...extra,
    });
    expect(invalid.exitCode).toBe(1);
    expectInputFailure(invalid.json, "right", "Evidence must be distinct");
  }
};

const checkNativeObservationIdentities = async ({
  cli,
  root,
  call,
  application,
  other,
  reference,
  otherReference,
}: WorkflowContext) => {
  for (const side of [
    "left_native_observations",
    "right_native_observations",
  ] as const) {
    const input = {
      left: application,
      right: other,
      [side]: [application, application],
    };
    const response = await call("compare_application_versions", {
      ...input,
      left: reference,
      right: otherReference,
    });
    expect(response.isError).toBe(true);
    expectInputFailure(
      parseMcpToolError(response).error,
      side,
      "Native observations must be unique",
    );
    const invalid = await runJson(
      cli,
      root,
      "compare-application-versions",
      input,
    );
    expect(invalid.exitCode).toBe(1);
    expectInputFailure(
      invalid.json,
      side,
      "Native observations must be unique",
    );
  }
  const traceInput = {
    application,
    seed,
    native_observations: [application, application],
  };
  const duplicateTrace = await call("trace_application_feature", {
    ...traceInput,
    application: reference,
  });
  expect(duplicateTrace.isError).toBe(true);
  expectInputFailure(
    parseMcpToolError(duplicateTrace).error,
    "native_observations",
    "Native observations must be unique",
  );
  const invalidTrace = await runJson(
    cli,
    root,
    "trace-application-feature",
    traceInput,
  );
  expect(invalidTrace.exitCode).toBe(1);
  expectInputFailure(
    invalidTrace.json,
    "native_observations",
    "Native observations must be unique",
  );
};

const checkMalformedEvidenceBeforeIdentities = async ({
  cli,
  root,
  call,
  application,
}: WorkflowContext) => {
  const malformed = {
    ...application,
    provider: { ...application.provider, name: 3 },
  };
  const tampered = { ...application, confidence: "observed" };
  for (const [name, command, input, reason] of [
    [
      "compare_application_versions",
      "compare-application-versions",
      { left: application, right: malformed },
      "provider.name",
    ],
    [
      "compare_javascript_export_shapes",
      "compare-javascript-export-shapes",
      { left: application, right: malformed, ...selectors },
      "provider.name",
    ],
    [
      "compare_javascript_export_shapes",
      "compare-javascript-export-shapes",
      { left: application, right: tampered, ...selectors },
      "semantic identifier",
    ],
    [
      "trace_application_feature",
      "trace-application-feature",
      { application, seed, native_observations: [malformed, application] },
      "provider.name",
    ],
    [
      "compare_application_versions",
      "compare-application-versions",
      { left: application, right: tampered },
      "semantic identifier",
    ],
    [
      "trace_application_feature",
      "trace-application-feature",
      { application: tampered, seed },
      "semantic identifier",
    ],
  ] as const) {
    const rejected = await runJson(cli, root, command, input);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      retryable: false,
      details: { reason: expect.stringContaining(reason) },
    });
    if (reason === "semantic identifier") {
      const mcp = await call(name, input);
      expect(mcp.isError).toBe(true);
      expect(parseMcpToolError(mcp).error).toMatchObject({
        code: "evidence_integrity_mismatch",
        retryable: false,
        details: { reason: expect.stringContaining(reason) },
      });
    }
  }
  const missingLeft = {
    kind: "retained-evidence",
    evidence_id: `ev_${"a".repeat(64)}`,
  };
  const missingRight = {
    kind: "retained-evidence",
    evidence_id: `ev_${"b".repeat(64)}`,
  };
  for (const [command, extra] of [
    ["compare-application-versions", {}],
    ["compare-javascript-export-shapes", selectors],
  ] as const) {
    // Lookup of both selected sources precedes graph authentication.
    for (const [left, right, evidenceId] of [
      [malformed, missingRight, missingRight.evidence_id],
      [missingLeft, missingRight, missingLeft.evidence_id],
    ] as const) {
      const rejected = await runJson(cli, root, command, {
        left,
        right,
        ...extra,
      });
      expect(rejected.exitCode).toBe(1);
      expect(rejected.json).toMatchObject({
        code: "evidence_integrity_mismatch",
        details: { evidence_id: evidenceId, reason: "missing" },
      });
    }
  }
};

cliTest(
  "preserves workflow identity validation through CLI and inline, retained and mixed MCP inputs",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-application-input-identities-",
    );
    const left = join(root, "left"),
      right = join(root, "right");
    await mkdir(left);
    await mkdir(right);
    await writeFile(
      join(left, "main.mjs"),
      "export function get() { return { observed: 1 }; }\n",
    );
    await writeFile(
      join(right, "main.mjs"),
      "export function get() { return { observed: 2 }; }\n",
    );
    const { client, tools, call } = await connectMcp(root);
    const first = await call("analyze_javascript_application", {
      input_path: left,
      format: "directory",
    });
    const second = await call("analyze_javascript_application", {
      input_path: right,
      format: "directory",
    });
    expect(first.isError).not.toBe(true);
    expect(second.isError).not.toBe(true);
    const application = analyzeContract.outputSchema.parse(
      first.structuredContent,
    );
    const other = analyzeContract.outputSchema.parse(second.structuredContent);
    const reference = {
      kind: "retained-evidence",
      evidence_id: application.evidence_id,
    };
    const otherReference = {
      kind: "retained-evidence",
      evidence_id: other.evidence_id,
    };
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const name of [
      "compare_application_versions",
      "compare_javascript_export_shapes",
      "trace_application_feature",
    ]) {
      const definition = tools.get(name);
      if (definition?.outputSchema === undefined)
        throw new Error("Missing workflow schema");
      expect(ajv.validateSchema(definition.inputSchema)).toBe(true);
      const { $schema, ...outputKeywords } = definition.outputSchema;
      expect(
        ajv.validateSchema(
          $schema === undefined
            ? outputKeywords
            : { ...outputKeywords, $schema },
        ),
      ).toBe(true);
    }
    const context = {
      cli,
      root,
      call,
      application,
      other,
      reference,
      otherReference,
    };
    await checkComparisonIdentities(context);
    await checkNativeObservationIdentities(context);
    await checkMalformedEvidenceBeforeIdentities(context);
    const compared = await call("compare_application_versions", {
      left: reference,
      right: otherReference,
    });
    expect(compared.isError).not.toBe(true);
    const result = compareContract.outputSchema.parse(
      compared.structuredContent,
    );
    expect(result.normalized_result.evidence_links).toEqual(
      [application.evidence_id, other.evidence_id].sort(),
    );
    const cliResult = await runJson(cli, root, "compare-application-versions", {
      left: application,
      right: other,
    });
    expect(cliResult.exitCode, cliResult.stdout).toBe(0);
    expect(compareContract.outputSchema.parse(cliResult.json)).toEqual(result);
    const bundlePath = join(root, "retained-workflow-evidence.json");
    const exported = await call("export_evidence_bundle", { path: bundlePath });
    expect(exported.isError).not.toBe(true);
    const portable = await runJson(
      cli,
      root,
      "compare-application-versions",
      { left: reference, right: otherReference },
      bundlePath,
    );
    expect(portable.exitCode, portable.stdout).toBe(0);
    expect(compareContract.outputSchema.parse(portable.json)).toEqual(result);
    expect(
      (
        await call("compare_javascript_export_shapes", {
          left: reference,
          right: otherReference,
          ...selectors,
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await call("trace_application_feature", {
          application: reference,
          seed,
        })
      ).isError,
    ).not.toBe(true);
    await client.ping();
    expect((await call("close_binary")).isError).not.toBe(true);
    await client.ping();
  },
);
