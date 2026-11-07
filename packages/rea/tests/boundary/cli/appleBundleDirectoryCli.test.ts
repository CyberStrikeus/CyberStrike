import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import { appleApplicationProjectionResultSchema } from "../../../src/domain/apple/appleApplication.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const rootPath = "Payload/Fixture.app";
cliTest.for([
  {
    name: "regular Contents resource",
    resource: "Contents",
    layout: "shallow",
    plist: "Info.plist",
    platforms: ["ios"],
  },
  {
    name: "regular Versions resource",
    resource: "Versions",
    layout: "shallow",
    plist: "Info.plist",
    platforms: ["ios"],
  },
  {
    name: "implied Contents directory",
    resource: "Resource",
    layout: "macos-deep",
    plist: "Contents/Info.plist",
    platforms: ["macos"],
  },
  {
    name: "file shadowing a folded directory",
    resource: "Contents",
    layout: "macos-deep",
    plist: "contents/Info.plist",
    platforms: ["macos"],
  },
])(
  "Apple CLI respects directory identity with $name",
  async (fixture, { cli }) => {
    const root = await createTestTempDirectory("rea-apple-directory-cli-");
    const path = join(root, "Fixture.ipa");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      `${rootPath}/${fixture.resource}`,
      new TextReader("ordinary resource"),
    );
    await writer.add(
      `${rootPath}/${fixture.plist}`,
      new TextReader("<plist/>"),
    );
    await writeFile(path, await writer.close());
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const evidence = parseEvidence(inspected.json);
    const inventory = artifactInspectionResultSchema.parse(
      evidence.normalized_result,
    ).substeps[0]?.evidence;
    expect(inventory?.normalized_result.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: `${rootPath}/${fixture.resource}`,
        entry_kind: "file",
      }),
    );
    const input = join(root, "projection.json");
    await writeFile(input, JSON.stringify({ inventory_evidence: [evidence] }));
    const output = await cli.run({
      arguments: ["project-apple-application-graph", input, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const projection = appleApplicationProjectionResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(projection.bundles).toEqual([
      expect.objectContaining({
        path: rootPath,
        layout: fixture.layout,
        info_plist_path: `${rootPath}/${fixture.plist}`,
      }),
    ]);
    expect(projection.platforms).toEqual(fixture.platforms);
    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
  },
);

cliTest(
  "Apple CLI and MCP read a flattened framework's Resources/Info.plist",
  { timeout: 60_000 },
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-flat-framework-");
    const app = join(root, "Fixture.app");
    const framework = "Contents/Frameworks/Core.framework";
    const machO = thinMach(0xcffaedfe, 0x0100000c);
    // Electron and Gecko apps ship frameworks without Versions/: the binary,
    // _CodeSignature/ and Resources/ sit directly in the .framework.
    const files: [string, string | Uint8Array][] = [
      [
        "Contents/Info.plist",
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>',
      ],
      ["Contents/MacOS/Fixture", machO],
      [`${framework}/Core`, machO],
      [`${framework}/Resources/Info.plist`, "<plist><dict/></plist>"],
      [`${framework}/_CodeSignature/CodeResources`, "<plist><dict/></plist>"],
    ];
    for (const [relative, content] of files) {
      await mkdir(dirname(join(app, relative)), { recursive: true });
      await writeFile(join(app, relative), content);
    }
    const environment = { HOME: root, USERPROFILE: root };
    const inspected = await cli.run({
      arguments: ["inspect-artifact", app, "--json"],
      environment,
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const input = { inventory_evidence: [parseEvidence(inspected.json)] };
    const output = await cli.run({
      arguments: [
        "project-apple-application-graph",
        JSON.stringify(input),
        "--json",
      ],
      environment,
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const evidence = parseEvidence(output.json);
    const { call } = await connectLocalToolsMcp(environment);
    const mcp = await call("project_apple_application_graph", input);
    expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
    expect(parseEvidence(mcp.structuredContent)).toEqual(evidence);
    const projection = appleApplicationProjectionResultSchema.parse(
      evidence.normalized_result,
    );
    expect(projection.bundles).toEqual([
      expect.objectContaining({ path: ".", layout: "macos-deep" }),
      {
        path: framework,
        parent_path: ".",
        layout: "shallow",
        role: "framework",
        role_basis: "path-convention",
        info_plist_path: `${framework}/Resources/Info.plist`,
        executable_candidates: [`${framework}/Core`],
        signing_paths: [`${framework}/_CodeSignature/CodeResources`],
      },
    ]);
    expect(projection.platforms).toEqual(["macos"]);
    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
  },
);

cliTest(
  "Apple CLI does not invent an application from a leaf Contents file",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-false-root-cli-");
    const path = join(root, "Fixture.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("Fake.app/Contents", new TextReader("ordinary resource"));
    await writeFile(path, await writer.close());
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const source = parseEvidence(inspected.json);
    const inventory = artifactInspectionResultSchema.parse(
      source.normalized_result,
    ).substeps[0]?.evidence;
    expect(inventory?.normalized_result.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "Fake.app/Contents",
        entry_kind: "file",
      }),
    );
    const input = join(root, "projection.json");
    await writeFile(input, JSON.stringify({ inventory_evidence: [source] }));
    const output = await cli.run({
      arguments: ["project-apple-application-graph", input, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const projection = appleApplicationProjectionResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(projection.application_roots).toEqual([]);
    expect(projection.bundles).toEqual([]);
    expect(projection.platforms).toEqual([]);
  },
);
