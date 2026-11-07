import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";

import type { ApktoolResourceAnalysisPort } from "../../../src/application/apktool/ApktoolResourceAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import type { ApktoolRequest } from "../../../src/domain/apktool/apktoolResourceAnalysis.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { assertAdvertisedMcpContracts } from "./mcpContractHarness.js";

const identity = { id: "apktool", name: "Apktool", version: "2.7.0-dirty" };

const clientIdentity = {
  command: "/usr/bin/apktool",
  command_source: "path",
  apktool_version: "2.7.0-dirty",
};

const results: Readonly<Record<string, unknown>> = {
  inspect_apktool_client: { client: clientIdentity },
  decode_android_resources: {
    client: clientIdentity,
    target: {
      path: "/targets/probe.apk",
      bytes: 8524,
      sha256: "a".repeat(64),
    },
    metadata: {
      version_name: "1.2.3",
      version_code: "7",
      min_sdk_version: "24",
      target_sdk_version: "34",
      package_name: "com.rea.apktool.probe",
    },
    manifest:
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.rea.apktool.probe"/>',
    strings: [{ name: "app_name", value: "ApktoolProbe" }],
    locale: null,
    locales: ["de"],
    string_tables: [
      {
        locale: null,
        status: "present",
        strings: [{ name: "app_name", value: "ApktoolProbe" }],
        total_count: 1,
        unparsed_count: 0,
        coverage: "complete",
      },
      {
        locale: "de",
        status: "present",
        strings: [{ name: "app_name", value: "ApktoolProbe DE" }],
        total_count: 1,
        unparsed_count: 0,
        coverage: "complete",
      },
    ],
    decoded_file_count: 5,
    coverage: "complete",
  },
};

it("advertises exact valid Apktool schemas and records inline evidence through MCP", async () => {
  const requests: Extract<
    ApktoolRequest,
    { operation: "decode_android_resources" }
  >["input"][] = [];
  const provider: ApktoolResourceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      if (request.operation === "decode_android_resources") {
        requests.push(request.input);
      }
      return ok(createAnalysisExecution(results[request.operation], identity));
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    {
      apktoolAnalysis: provider,
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
    },
  );
  onTestFinished(() => server.close());
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apktool-boundary", version: "0.0.0" });
  onTestFinished(() => client.close());
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  const operationNames = [
    "inspect_apktool_client",
    "decode_android_resources",
  ] as const;
  for (const name of operationNames) expect(names, name).toContain(name);

  assertAdvertisedMcpContracts(operationNames, tools);
  const localeSchema = tools.find(
    (tool) => tool.name === "decode_android_resources",
  )?.inputSchema.properties?.locale;
  expect(localeSchema).toMatchObject({ maxLength: 23 });
  const selectedLocales = [
    "b+sr+Latn+RS+REVISED",
    "b+fil+Latn+419+ABCDEFGH",
    "es-419",
    "b+es+419",
  ];
  for (const locale of selectedLocales) {
    const reply = await client.callTool({
      name: "decode_android_resources",
      arguments: { path: "/targets/probe.apk", locale },
    });
    expect(reply.isError).not.toBe(true);
    expect(parseEvidence(reply.structuredContent).parameters).toMatchObject({
      locale,
    });
  }
  expect(requests.map((request) => request.locale)).toEqual(selectedLocales);

  const invalidLocale = await client.callTool({
    name: "decode_android_resources",
    arguments: { path: "/targets/probe.apk", locale: "es-r419" },
  });
  expect(invalidLocale.isError).toBe(true);
  expect(requests).toHaveLength(selectedLocales.length);

  const decoded = await client.callTool({
    name: "decode_android_resources",
    arguments: { path: "/targets/probe.apk" },
  });
  expect(decoded.isError).not.toBe(true);
  const text = (decoded.content as { readonly text?: string }[])
    .map((part) => part.text ?? "")
    .join("");
  const evidence = parseEvidence(JSON.parse(text));
  expect(evidence.provider.id).toBe("apktool");
  expect(evidence.normalized_result).toMatchObject({
    metadata: { package_name: "com.rea.apktool.probe", version_name: "1.2.3" },
    coverage: "complete",
    string_tables: [
      { locale: null, status: "present" },
      { locale: "de", status: "present" },
    ],
  });

  const batched = await client.callTool({
    name: "decode_android_resources",
    arguments: {
      path: "/targets/probe.apk",
      locales: ["de"],
      string_tables_only: true,
    },
  });
  expect(batched.isError).not.toBe(true);
  expect(parseEvidence(batched.structuredContent).parameters).toMatchObject({
    locales: ["de"],
    string_tables_only: true,
  });
  expect(requests.at(-1)).toMatchObject({
    locales: ["de"],
    string_tables_only: true,
  });
});
