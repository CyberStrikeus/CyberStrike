import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createServer } from "../../../src/server/createServer.js";
import { silentLogger } from "../../../src/logger.js";

interface PathInputCase {
  readonly name: string;
  readonly field: string;
  readonly valid: Readonly<Record<string, unknown>>;
  readonly invalid: Readonly<Record<string, unknown>>;
  readonly issuePath?: readonly string[];
}

const createMcp = async (
  firmwareCalls: string[],
  profile?: "full" | "compact",
) => {
  const session = createTestBinarySession(() => {
    throw new Error("Invalid path input must not acquire a binary provider");
  });
  const server = createServer(
    { kind: "session", session },
    {
      logger: silentLogger,
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: profile },
      firmwareAnalysis: {
        execute: async (request) => {
          firmwareCalls.push(request.operation);
          throw new Error("Invalid path input reached firmware analysis");
        },
        close: async () => {},
      },
    },
  );
  const client = new Client({ name: "absolute-path-schema", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const close = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const release of [
      () => client.close(),
      () => server.close(),
      () => session.close(),
    ]) {
      try {
        await release();
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "MCP path fixture cleanup failed");
  };

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, close };
  } catch (cause: unknown) {
    await close();
    throw cause;
  }
};

const standaloneAnalysisCases = (
  absolute: string,
  relative: string,
): readonly PathInputCase[] =>
  [
    { name: "inspect_go_binary", input: {} },
    { name: "inspect_recorded_crash", input: {} },
    { name: "inspect_binary_layout", input: {} },
    { name: "inspect_rust_binary", input: {} },
    { name: "inspect_evm_interface", input: { encoding: "hex" } },
    { name: "inspect_sqlite_database", input: {} },
    { name: "inspect_pe_resources", input: {} },
    { name: "inspect_native_exports", input: {} },
    { name: "inspect_electron_fuses", input: {} },
    { name: "inspect_packet_capture", input: { fields: ["ip.addr"] } },
    {
      name: "decode_signal_recording",
      input: { decoders: "uart:rx=RX:baudrate=9600" },
    },
  ].map(({ name, input }) => ({
    name,
    field: "path",
    valid: { ...input, path: absolute },
    invalid: { ...input, path: relative },
    issuePath: ["path"],
  }));

const inputCases = (
  absolute: string,
  relative: string,
): readonly PathInputCase[] => {
  const pathCase = (
    name: string,
    field: string,
    valid: Readonly<Record<string, unknown>>,
    invalid: Readonly<Record<string, unknown>>,
  ): PathInputCase => ({ name, field, valid, invalid });

  return [
    pathCase("open_binary", "path", { path: absolute }, { path: relative }),
    pathCase(
      "analyze_javascript_application",
      "input_path",
      { input_path: absolute, detail: "complete" },
      { input_path: relative, detail: "complete" },
    ),
    pathCase(
      "open_binary",
      "snapshot_path",
      { path: absolute, snapshot_path: absolute },
      { path: absolute, snapshot_path: relative },
    ),
    pathCase(
      "close_binary",
      "snapshot_path",
      { snapshot_path: absolute },
      { snapshot_path: relative },
    ),
    pathCase(
      "export_evidence_bundle",
      "path",
      { path: absolute },
      { path: relative },
    ),
    pathCase(
      "import_evidence_bundle",
      "path",
      { path: absolute },
      { path: relative },
    ),
    pathCase(
      "compare_bundles",
      "left_bundle_path",
      { left_bundle_path: absolute, right_bundle_path: absolute },
      { left_bundle_path: relative, right_bundle_path: absolute },
    ),
    pathCase(
      "compare_bundles",
      "right_bundle_path",
      { left_bundle_path: absolute, right_bundle_path: absolute },
      { left_bundle_path: absolute, right_bundle_path: relative },
    ),
    pathCase(
      "binary_session",
      "expected_server_path",
      { expected_server_path: absolute },
      { expected_server_path: relative },
    ),
    ...[
      "inspect_managed_artifact",
      "inspect_managed_members",
      "inspect_managed_native_boundaries",
    ].map((name) =>
      pathCase(name, "path", { path: absolute }, { path: relative }),
    ),
    pathCase(
      "inspect_firmware_regions",
      "path",
      { path: absolute },
      { path: relative },
    ),
    pathCase(
      "extract_firmware",
      "path",
      { path: absolute, output_directory: absolute },
      { path: relative, output_directory: absolute },
    ),
    pathCase(
      "extract_firmware",
      "output_directory",
      { path: absolute, output_directory: absolute },
      { path: absolute, output_directory: relative },
    ),
    pathCase(
      "inspect_analysis_view",
      "source.path",
      {
        source: { kind: "evidence-file", path: absolute },
        view: { kind: "summary" },
      },
      {
        source: { kind: "evidence-file", path: relative },
        view: { kind: "summary" },
      },
    ),
    pathCase(
      "capture_browser_scenario",
      "browser.executable_path",
      {
        browser: { mode: "launch", executable_path: absolute },
        start_url: { url: "https://example.test/" },
        actions: [
          { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
        ],
      },
      {
        browser: { mode: "launch", executable_path: relative },
        start_url: { url: "https://example.test/" },
        actions: [
          { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
        ],
      },
    ),
    ...standaloneAnalysisCases(absolute, relative),
    ...["executable_path", "application_path", "application_root"].map(
      (field) =>
        pathCase(
          "capture_electron_scenario",
          field,
          {
            executable_path: absolute,
            application_path: absolute,
            [field]: absolute,
          },
          {
            executable_path: absolute,
            application_path: absolute,
            [field]: relative,
          },
        ),
    ),
  ];
};

it("advertises full host-absolute path constraints after SDK schema conversion", async () => {
  const firmwareCalls: string[] = [];
  const { client, close } = await createMcp(firmwareCalls, "full");
  try {
    const listed = await client.listTools();
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const absolute = resolve("rea-absolute-input");
    const relative = "relative-input";

    for (const { name, field, valid, invalid } of [
      ...inputCases(absolute, relative),
      {
        name: "inspect_go_binary",
        field: "path NUL",
        valid: { path: absolute },
        invalid: { path: `${absolute}\0` },
      },
      {
        name: "import_evidence_bundle",
        field: "path NUL",
        valid: { path: absolute },
        invalid: { path: `${absolute}\0` },
      },
      {
        name: "compare_bundles",
        field: "left_bundle_path empty",
        valid: { left_bundle_path: absolute, right_bundle_path: absolute },
        invalid: { left_bundle_path: "", right_bundle_path: absolute },
      },
      {
        name: "compare_bundles",
        field: "left_bundle_path NUL",
        valid: { left_bundle_path: absolute, right_bundle_path: absolute },
        invalid: {
          left_bundle_path: `${absolute}\0`,
          right_bundle_path: absolute,
        },
      },
    ]) {
      const schema = listed.tools.find(
        (tool) => tool.name === name,
      )?.inputSchema;
      if (schema === undefined)
        throw new Error(`Missing advertised tool ${name}`);
      const validate = ajv.compile(schema);
      expect(validate(invalid), `${name}.${field}`).toBe(false);
      expect(
        validate(valid),
        `${name}.${field}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }
    expect(firmwareCalls).toEqual([]);
  } finally {
    await close();
  }
});

it("rejects relative paths through in-memory MCP handlers", async () => {
  const firmwareCalls: string[] = [];
  const { client, close } = await createMcp(firmwareCalls);
  try {
    for (const { name, field, invalid, issuePath } of inputCases(
      resolve("rea-absolute-input"),
      "relative-input",
    )) {
      const result = await client.callTool({ name, arguments: invalid });
      expect(result.isError, `${name}.${field}`).toBe(true);
      expect(JSON.stringify(result), `${name}.${field}`).toContain("absolute");
      if (issuePath !== undefined)
        expect(parseMcpToolError(result).error.details).toMatchObject({
          operation: name,
          issues: [{ path: issuePath, reason: "invalid_format" }],
        });
    }
    expect(firmwareCalls).toEqual([]);
  } finally {
    await close();
  }
});
