import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { build } from "plist";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const appWithClassNameArchive = async (): Promise<string> => {
  const app = join(
    await createTestTempDirectory("rea-ib-class-name-identity-"),
    "Fixture.app",
  );
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  await mkdir(resources, { recursive: true });
  await mkdir(join(contents, "MacOS"));
  await writeFile(
    join(contents, "MacOS", "App"),
    thinMach(0xfeedfacf, 0x0100000c),
  );
  await writeFile(
    join(contents, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
  );
  const uid = (value: number) => ({ CF$UID: value });
  const archive = build({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: [
      "$null",
      {
        $class: uid(4),
        className: "StoredLabel",
        title: "descriptor first",
      },
      {
        className: "StoredLabel",
        title: "field first",
        $class: uid(4),
      },
      { $class: uid(4), title: "without authored className" },
      {
        $classname: "ArchiveProbeView",
        $classes: ["ArchiveProbeView", "NSObject"],
      },
    ],
    $top: { root: uid(1) },
  });
  await writeFile(join(resources, "Main.nib"), archive);
  return app;
};

cliTest(
  "keeps authored className separate from keyed-archive class metadata through CLI and MCP",
  async ({ cli }) => {
    const app = await appWithClassNameArchive();
    const cliResult = await cli.run({
      arguments: ["decode-interface-builder", app, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(cliResult.exitCode, cliResult.stderr).toBe(0);
    const contract = toolContract("decode_interface_builder");
    const cliEvidence = contract.outputSchema.parse(cliResult.json);

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
    const client = new Client({ name: "ib-class-name-identity", version: "1" });
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
      const mcpEvidence = contract.outputSchema.parse(
        response.structuredContent,
      );
      expect(mcpEvidence.normalized_result).toEqual(
        cliEvidence.normalized_result,
      );
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }

    const report = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(cliEvidence).normalized_result,
    );
    const objects = report.graph.nodes.filter(
      ({ attributes }) => attributes.interface_builder_object_id !== undefined,
    );
    expect(objects).toHaveLength(3);
    for (const [id, title] of [
      ["1", "descriptor first"],
      ["2", "field first"],
    ]) {
      expect(objects).toContainEqual(
        expect.objectContaining({
          kind: "view",
          attributes: expect.objectContaining({
            interface_builder_object_id: id,
            class_name: "ArchiveProbeView",
            className: "StoredLabel",
            title,
          }),
        }),
      );
    }
    const withoutAuthoredField = objects.find(
      ({ attributes }) => attributes.interface_builder_object_id === "3",
    );
    expect(withoutAuthoredField).toMatchObject({
      kind: "view",
      attributes: {
        class_name: "ArchiveProbeView",
        title: "without authored className",
      },
    });
    expect(withoutAuthoredField?.attributes).not.toHaveProperty("className");
  },
  60_000,
);
