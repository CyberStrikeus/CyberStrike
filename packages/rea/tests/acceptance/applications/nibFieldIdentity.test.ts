import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";

import { encodeNibArchiveFixture } from "../../../src/artifacts/apple/NibArchive.fixture.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const createIdentityArchive = () =>
  encodeNibArchiveFixture({
    classes: [
      "UIView",
      "\uFEFFCustomView",
      "UIClassSwapper",
      "UIButton",
      "UIRuntimeEventConnection",
      "NSString",
    ],
    objects: [
      {
        classIndex: 0,
        values: {
          ["__proto__"]: { ref: 1 },
          constructor: 7,
          enabled: true,
          "\uFEFFenabled": false,
        },
      },
      { classIndex: 1, values: { ["__proto__"]: 23 } },
      { classIndex: 2, values: { UIClassName: { ref: 5 } } },
      { classIndex: 3, values: { title: { ref: 6 } } },
      {
        classIndex: 4,
        values: {
          UISource: { ref: 3 },
          UIDestination: { ref: 2 },
          UILabel: { ref: 7 },
        },
      },
      {
        classIndex: 5,
        values: { "NS.bytes": { data: Uint8Array.of(0x43, 0xff) } },
      },
      {
        classIndex: 5,
        values: { "NS.bytes": { data: Uint8Array.of(0x54, 0xfe) } },
      },
      {
        classIndex: 5,
        values: { "NS.bytes": { data: Uint8Array.of(0x64, 0xff, 0x3a) } },
      },
      { classIndex: 3, values: { title: { ref: 9 } } },
      { classIndex: 5, values: { "NS.bytes": "\uFEFFGenuine\uFFFD" } },
      {
        classIndex: 3,
        values: { opaqueData: { data: Uint8Array.of(0xff) } },
      },
      {
        classIndex: 5,
        values: { "NS.bytes": { data: Uint8Array.of(0xff) } },
      },
    ],
  });

cliTest(
  "preserves literal NIB fields and unavailable string identities through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-nib-field-identity-");
    const app = join(root, "Fixture.app");
    const contents = join(app, "Contents");
    await mkdir(join(contents, "Resources"), { recursive: true });
    await mkdir(join(contents, "MacOS"));
    await writeFile(
      join(contents, "MacOS/App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string><key>CFBundleIdentifier</key><string>dev.rea.nib-fields</string></dict></plist>",
    );
    const archive = createIdentityArchive();
    const path = join(contents, "Resources/Panel.nib");
    await writeFile(path, archive);
    const result = await cli.run({
      arguments: ["decode-interface-builder", app, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const contract = toolContract("decode_interface_builder");
    const evidence = contract.outputSchema.parse(result.json);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      env: {
        PATH: process.env.PATH ?? "",
        REA_LOG_LEVEL: "silent",
        REA_ANALYSIS_PROVIDER: "auto",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "nib-field-identity", version: "1" });
    try {
      await client.connect(transport);
      const opened = await client.callTool({
        name: "open_bundle_resources",
        arguments: { path: app },
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      const response = await client.callTool({
        name: contract.name,
        arguments: {},
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const mcp = contract.outputSchema.parse(response.structuredContent);
      expect(mcp.normalized_result).toEqual(evidence.normalized_result);
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
    const report = interfaceBuilderAnalysisSchema.parse(
      evidence.normalized_result,
    );
    expect(report.documents[0]?.archive_sha256).toBe(
      createHash("sha256").update(archive).digest("hex"),
    );
    const objects = report.graph.nodes.filter(
      ({ attributes }) => attributes.interface_builder_object_id !== undefined,
    );
    expect(objects).toHaveLength(9);
    expect(objects[0]?.attributes.nibValues).toEqual({
      ["__proto__"]: { objectID: "1" },
      constructor: 7,
      enabled: true,
      "\uFEFFenabled": false,
    });
    expect(objects[1]?.attributes).toMatchObject({
      class_name: "\uFEFFCustomView",
      nibValues: { ["__proto__"]: 23 },
    });
    const byId = new Map(
      objects.map((node) => [
        node.attributes.interface_builder_object_id,
        node,
      ]),
    );
    expect(byId.get("2")?.attributes).toMatchObject({
      class_name: "UIClassSwapper",
      nibValues: { UIClassName: { objectID: "5" } },
    });
    expect(byId.get("3")).toMatchObject({
      name: "UIButton",
      attributes: { nibValues: { title: { objectID: "6" } } },
    });
    expect(
      report.graph.nodes.find(({ kind }) => kind === "action"),
    ).toMatchObject({
      name: "unlabeled action",
      attributes: { selector: null, label: null },
    });
    for (const [id, bytes] of [
      ["5", Uint8Array.of(0x43, 0xff)],
      ["6", Uint8Array.of(0x54, 0xfe)],
      ["7", Uint8Array.of(0x64, 0xff, 0x3a)],
    ] as const)
      expect(byId.get(id)?.attributes.nibValues).toEqual({
        "NS.bytes": { $nib_data_base64: Buffer.from(bytes).toString("base64") },
      });
    expect(byId.get("8")?.name).toBe("\uFEFFGenuine\uFFFD");
    expect(byId.has("9")).toBe(false);
    expect(byId.get("10")?.attributes.nibValues).toEqual({
      opaqueData: { $nib_data_base64: "/w==" },
    });
    expect(byId.has("11")).toBe(false);
    for (const facet of ["objects", "connections", "classes"])
      expect(report.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: `${facet}:Contents/Resources/Panel.nib`,
          status: "partial",
          reason: "nib_string_utf8_unavailable",
        }),
      );
    expect(report.graph.coverage).toContainEqual(
      expect.objectContaining({ facet: "archive_decode", status: "partial" }),
    );
    expect(report.limitations).toContainEqual(
      expect.stringContaining("NSString NS.bytes is not valid UTF-8"),
    );
    expect(Buffer.compare(await readFile(path), archive)).toBe(0);
  },
  60_000,
);
