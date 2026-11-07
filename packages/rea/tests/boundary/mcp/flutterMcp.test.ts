import { expect, it, onTestFinished } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { FlutterBuildAnalysisPort } from "../../../src/application/flutter/FlutterBuildAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { assertAdvertisedMcpContracts } from "./mcpContractHarness.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createFlutterBuildAnalysisProvider } from "../../../src/composition/flutter.js";
import {
  ABI_SELECTOR_MESSAGE,
  flutterResultSchemas,
} from "../../../src/domain/flutter/flutterBuildAnalysis.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { aotFixtureImage } from "../../../src/flutter/FlutterBuild.fixture.js";
import { createFlutterApk } from "../../fixtures/flutterApk.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

it.each([
  { label: "ARM64-V8A", paired: false },
  ...[
    "ARM64-V8A",
    "arm64.v8a",
    "A",
    ".",
    "..",
    "abi\\label",
    "abi\u0000label",
    "abi\nlabel",
    "abi\u0085label",
    "l".repeat(336),
    "l".repeat(1010),
    "界".repeat(336),
    "😀".repeat(252),
  ].map((label) => ({ label, paired: true })),
])(
  "selects the exact reported archive ABI $label (paired=$paired)",
  async ({ label, paired }) => {
    const path = await createFlutterApk("reported-label.apk", [
      {
        path: `lib/${label}/libapp.so`,
        bytes: aotFixtureImage("a".repeat(32)),
      },
      ...(paired
        ? [
            {
              path: "lib/x86_64/libapp.so",
              bytes: aotFixtureImage("b".repeat(32)),
            },
          ]
        : []),
    ]);
    const provider = createFlutterBuildAnalysisProvider();
    onTestFinished(() => provider.close());
    const harness = await createApplicationMcpHarness({
      serverOptions: { flutterAnalysis: provider },
    });
    onTestFinished(harness.close);
    const call = (name: string, abi?: string) =>
      harness.client.callTool({
        name,
        arguments: { path, ...(abi === undefined ? {} : { abi }) },
      });
    const inventoryReply = await call("identify_flutter_build");
    expect(inventoryReply.isError).not.toBe(true);
    const inventory = flutterResultSchemas.identify_flutter_build.parse(
      parseEvidence(inventoryReply.structuredContent).normalized_result,
    );
    expect(inventory.abis.map((row) => row.abi)).toContain(label);
    const defaultReply = await call("inspect_dart_aot");
    expect(defaultReply.isError).not.toBe(true);
    const defaultFacts = flutterResultSchemas.inspect_dart_aot.parse(
      parseEvidence(defaultReply.structuredContent).normalized_result,
    );
    expect(defaultFacts.abi).toBe(paired ? "x86_64" : label);
    expect(defaultFacts.libapp.snapshot_hash).toBe(
      (paired ? "b" : "a").repeat(32),
    );
    const selectedReply = await call("inspect_dart_aot", label);
    expect(selectedReply.isError).not.toBe(true);
    const evidence = parseEvidence(selectedReply.structuredContent);
    const selected = flutterResultSchemas.inspect_dart_aot.parse(
      evidence.normalized_result,
    );
    expect(selected.abi).toBe(label);
    expect(selected.libapp.snapshot_hash).toBe("a".repeat(32));
    expect(selected.libapp.coverage).toBe("complete");
    expect(evidence.parameters).toEqual({ path, abi: label });
    const tool = (await harness.client.listTools()).tools.find(
      (tool) => tool.name === "inspect_dart_aot",
    );
    if (tool === undefined) throw new Error("Missing AOT tool");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
    expect(ajv.validate(tool.inputSchema, { path, abi: label })).toBe(true);
  },
);

const identity = {
  id: "flutter",
  name: "Flutter build identification",
  version: null,
};

const SNAPSHOT_HASH = "65817c30a78bb44c3dc3771876b6010a";

/** One shared target identity for both fake operation results. */
const target = {
  path: "/targets/gallery.apk",
  bytes: 117817550,
  sha256: "a".repeat(64),
};

const inspectExecution = () =>
  createAnalysisExecution(
    {
      target,
      abi: "arm64-v8a",
      libapp: {
        coverage: "complete",
        bytes: 24691632,
        sha256: "b".repeat(64),
        snapshot_hash: SNAPSHOT_HASH,
        snapshot_hash_candidates: [SNAPSHOT_HASH],
        snapshot_hash_sources: 2,
        sections: [
          {
            name: "_kDartVmSnapshotData",
            offset: 4096,
            size: 52,
            magic_valid: true,
            kind: 3,
            header_length: 48,
          },
          {
            name: "_kDartIsolateSnapshotData",
            offset: 8192,
            size: 1536,
            magic_valid: true,
            kind: 3,
            header_length: 48,
          },
        ],
      },
      string_pool: {
        coverage: "complete",
        package_uris: [
          "package:adaptive_breakpoints/src/adaptive_breakpoints.dart",
        ],
        package_uri_count_at_least: 1,
        dart_uris: ["dart:_http"],
        dart_uri_count_at_least: 1,
        class_like_tokens: ["AdaptiveBreakpoint"],
        class_like_token_count_at_least: 1,
        printable_run_count: 4,
      },
      coverage: "complete",
    },
    identity,
  );

const identifyExecution = () =>
  createAnalysisExecution(
    {
      target,
      flutter_detected: true,
      abis: [
        {
          abi: "arm64-v8a",
          libapp: {
            present: true,
            bytes: 24691632,
            sha256: "b".repeat(64),
            elf_header_valid: true,
            snapshot_hash_sources: 2,
            snapshot_hash_candidates: [SNAPSHOT_HASH],
            snapshot_hash: SNAPSHOT_HASH,
          },
          libflutter: {
            present: true,
            bytes: 9073432,
            sha256: "c".repeat(64),
            build_id: "e8d907ef7c175ec4313f47111019adc9588c5f61",
            build_id_candidates: ["e8d907ef7c175ec4313f47111019adc9588c5f61"],
            dart_version: null,
            dart_version_capped: false,
            toolchain_lines: ["Android (5900059) clang version 9.0.8"],
            toolchain_capped: false,
          },
        },
      ],
      coverage: "complete",
    },
    identity,
  );

/** A recording-free provider answering both Flutter operations inline. */
const fakeProvider = (): FlutterBuildAnalysisPort => ({
  async inspectAvailability() {
    return { status: "available", code: null, reason: null, diagnostics: {} };
  },
  async close() {},
  async execute(request) {
    return ok(
      request.operation === "inspect_dart_aot"
        ? inspectExecution()
        : identifyExecution(),
    );
  },
});

it("advertises and enforces the same Unicode selector grammar through MCP", async () => {
  const harness = await createApplicationMcpHarness({
    serverOptions: {
      flutterAnalysis: fakeProvider(),
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
    },
  });
  onTestFinished(harness.close);
  const tool = (await harness.client.listTools()).tools.find(
    (tool) => tool.name === "inspect_dart_aot",
  );
  if (tool === undefined) throw new Error("Missing AOT tool");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  for (const abi of [
    "😀".repeat(1010),
    "l".repeat(1010),
    "😀".repeat(1009) + "\n",
    ...["\n", "\r", "\u2028", "\u2029"].map(
      (terminator) => "l".repeat(1009) + terminator,
    ),
  ]) {
    const arguments_ = { path: "/fixture.apk", abi };
    expect(ajv.validate(tool.inputSchema, arguments_)).toBe(true);
    expect(
      (
        await harness.client.callTool({
          name: "inspect_dart_aot",
          arguments: arguments_,
        })
      ).isError,
    ).not.toBe(true);
  }
  for (const [abi, reason] of [
    ["", "out_of_range"],
    ["lib/x86_64", "invalid_format"],
    ["😀".repeat(1011), "invalid_value"],
    ...["\n", "\r", "\u2028", "\u2029"].map(
      (terminator) => ["l".repeat(1010) + terminator, "invalid_value"] as const,
    ),
  ] as const) {
    const arguments_ = { path: "/fixture.apk", abi };
    expect(ajv.validate(tool.inputSchema, arguments_)).toBe(false);
    const refused = await harness.client.callTool({
      name: "inspect_dart_aot",
      arguments: arguments_,
    });
    expect(parseMcpToolError(refused).error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "inspect_dart_aot",
        issues: [
          expect.objectContaining({
            path: ["abi"],
            reason,
            message: ABI_SELECTOR_MESSAGE,
          }),
        ],
      },
    });
  }
});

it("advertises an exact valid Flutter schema and records inline evidence through MCP", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "flutter-boundary", version: "0.0.0" },
    serverOptions: { flutterAnalysis: fakeProvider() },
  });

  const { tools } = await client.listTools();
  assertAdvertisedMcpContracts(
    ["identify_flutter_build", "inspect_dart_aot"],
    tools,
  );

  const identified = await client.callTool({
    name: "identify_flutter_build",
    arguments: { path: "/targets/gallery.apk" },
  });
  expect(identified.isError).not.toBe(true);
  const text = (identified.content as { readonly text?: string }[])
    .map((part) => part.text ?? "")
    .join("");
  const evidence = parseEvidence(JSON.parse(text));
  expect(evidence.normalized_result).toMatchObject({
    flutter_detected: true,
    abis: [
      {
        abi: "arm64-v8a",
        libapp: { snapshot_hash: SNAPSHOT_HASH },
      },
    ],
  });

  const inspected = await client.callTool({
    name: "inspect_dart_aot",
    arguments: { path: "/targets/gallery.apk", abi: "arm64-v8a" },
  });
  expect(inspected.isError).not.toBe(true);
  const inspectedText = (inspected.content as { readonly text?: string }[])
    .map((part) => part.text ?? "")
    .join("");
  const inspectedEvidence = parseEvidence(JSON.parse(inspectedText));
  expect(inspectedEvidence.normalized_result).toMatchObject({
    abi: "arm64-v8a",
    libapp: {
      snapshot_hash: SNAPSHOT_HASH,
      snapshot_hash_candidates: [SNAPSHOT_HASH],
      snapshot_hash_sources: 2,
    },
  });
});
