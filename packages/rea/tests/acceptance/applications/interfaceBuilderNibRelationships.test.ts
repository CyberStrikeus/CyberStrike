import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, onTestFinished } from "vitest";
import { build } from "plist";

import { encodeNibArchiveFixture } from "../../../src/artifacts/apple/NibArchive.fixture.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";
import { openBundleResourcesTarget } from "../../support/mcp/artifactSession.js";

type Objects = Parameters<typeof encodeNibArchiveFixture>[0]["objects"];
const cases: readonly {
  name: string;
  objects: Objects;
  links: readonly (readonly [string, string])[];
  complete: boolean;
  registryDiagnostic?: string;
  decodeRejected?: boolean;
}[] = [
  {
    name: "archive owner alone does not establish a visual hierarchy",
    objects: [
      { classIndex: 0, values: { NSRoot: { ref: 1 } } },
      { classIndex: 3, values: {} },
    ],
    links: [],
    complete: false,
  },
  {
    name: "repeated registry declarations",
    objects: [
      {
        classIndex: 0,
        values: [
          ["NSRoot", { ref: 1 }],
          ["NSRoot", { ref: 2 }],
        ],
      },
      { classIndex: 3, values: {} },
      { classIndex: 3, values: {} },
    ],
    links: [],
    complete: false,
  },
  {
    name: "malformed registry owner with valid empty collections",
    objects: [
      {
        classIndex: 0,
        values: {
          NSRoot: "unknown",
          NSObjectsKeys: { ref: 1 },
          NSObjectsValues: { ref: 2 },
        },
      },
      { classIndex: 2, values: {} },
      { classIndex: 2, values: {} },
    ],
    links: [],
    complete: false,
  },
  {
    name: "dangling registry owner is rejected at the archive boundary",
    objects: [
      {
        classIndex: 0,
        values: {
          NSRoot: { ref: 99 },
          NSObjectsKeys: { ref: 2 },
          NSObjectsValues: { ref: 3 },
        },
      },
      { classIndex: 1, values: {} },
      { classIndex: 2, values: { "NS.objects": { ref: 1 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 99 } } },
    ],
    links: [],
    complete: false,
    decodeRejected: true,
  },
  {
    name: "superview direction when the archive owner is a view",
    objects: [
      { classIndex: 0, values: { NSRoot: { ref: 1 } } },
      { classIndex: 1, values: { NSSuperview: { ref: 2 } } },
      { classIndex: 1, values: {} },
    ],
    links: [["2", "1"]],
    complete: false,
  },
  {
    name: "conflicting child collections and superview",
    objects: [
      { classIndex: 1, values: { NSSubviews: { ref: 3 } } },
      { classIndex: 1, values: { NSSuperview: { ref: 2 } } },
      { classIndex: 1, values: {} },
      { classIndex: 2, values: { "NS.objects": { ref: 1 } } },
    ],
    links: [],
    complete: false,
  },
  {
    name: "registry ownership without an encoded view parent",
    registryDiagnostic:
      "NSObjectsKeys/NSObjectsValues pair child 3 with registry value 2",
    objects: [
      {
        classIndex: 0,
        values: {
          NSRoot: { ref: 1 },
          NSObjectsKeys: { ref: 4 },
          NSObjectsValues: { ref: 5 },
        },
      },
      { classIndex: 3, values: {} },
      { classIndex: 3, values: {} },
      { classIndex: 1, values: {} },
      { classIndex: 2, values: { "NS.objects": { ref: 3 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 2 } } },
    ],
    links: [],
    complete: false,
  },
  {
    name: "repeated identical child links",
    objects: [
      { classIndex: 1, values: { subviews: { ref: 2 } } },
      { classIndex: 1, values: { NSSuperview: { ref: 0 } } },
      {
        classIndex: 2,
        values: [
          ["NS.objects", { ref: 1 }],
          ["NS.objects", { ref: 1 }],
        ],
      },
    ],
    links: [["0", "1"]],
    complete: true,
  },
  {
    name: "key-view navigation is retained without visual containment",
    objects: [
      {
        classIndex: 1,
        values: { NSNextKeyView: { ref: 1 }, NSPreviousKeyView: { ref: 1 } },
      },
      { classIndex: 1, values: {} },
      { classIndex: 1, values: { NSSuperview: { ref: 0 } } },
    ],
    links: [["0", "2"]],
    complete: true,
  },
  {
    name: "known non-view cells retain control backreferences without hierarchy claims",
    objects: [
      {
        classIndex: 0,
        values: {
          NSRoot: { ref: 1 },
          NSObjectsKeys: { ref: 4 },
          NSObjectsValues: { ref: 5 },
        },
      },
      { classIndex: 3, values: {} },
      { classIndex: 1, values: {} },
      { classIndex: 4, values: { NSControlView: { ref: 2 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 3 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 2 } } },
      { classIndex: 1, values: { NSSuperview: { ref: 2 } } },
    ],
    links: [["2", "6"]],
    complete: true,
  },
  {
    name: "text field cells retain ownership without visual hierarchy claims",
    objects: [
      {
        classIndex: 0,
        values: {
          NSRoot: { ref: 1 },
          NSObjectsKeys: { ref: 4 },
          NSObjectsValues: { ref: 5 },
        },
      },
      { classIndex: 3, values: {} },
      { classIndex: 1, values: { NSCell: { ref: 3 } } },
      { classIndex: 6, values: { NSControlView: { ref: 2 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 3 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 2 } } },
      { classIndex: 1, values: { NSSuperview: { ref: 2 } } },
    ],
    links: [["2", "6"]],
    complete: true,
  },
  {
    name: "unknown cell classes retain unknown registry parentage",
    objects: [
      {
        classIndex: 0,
        values: {
          NSRoot: { ref: 1 },
          NSObjectsKeys: { ref: 4 },
          NSObjectsValues: { ref: 5 },
        },
      },
      { classIndex: 3, values: {} },
      { classIndex: 1, values: {} },
      { classIndex: 5, values: { NSControlView: { ref: 2 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 3 } } },
      { classIndex: 2, values: { "NS.objects": { ref: 2 } } },
    ],
    links: [],
    complete: false,
    registryDiagnostic:
      "NSObjectsKeys/NSObjectsValues pair child 3 with registry value 2",
  },
  {
    name: "unrecognized relationship fields",
    objects: [
      { classIndex: 1, values: { preview: { ref: 1 } } },
      { classIndex: 1, values: {} },
    ],
    links: [],
    complete: false,
  },
];

cliTest.for(cases)(
  "preserves NIB relationship evidence through CLI and MCP: $name",
  async (
    { objects, links, complete, registryDiagnostic, decodeRejected },
    { cli },
  ) => {
    const root = await createTestTempDirectory("rea-nib-relationships-");
    const app = join(root, "Fixture.app");
    const contents = join(app, "Contents");
    const resources = join(contents, "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(contents, "MacOS"));
    await writeFile(
      join(contents, "MacOS", "Fixture"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      build({ CFBundleExecutable: "Fixture" }),
    );
    await writeFile(
      join(resources, "Main.nib"),
      encodeNibArchiveFixture({
        classes: [
          "NSIBObjectData",
          "NSView",
          "NSArray",
          "NSCustomObject",
          "NSButtonCell",
          "CustomButtonCell",
          "NSTextFieldCell",
        ],
        objects,
      }),
    );
    const output = await cli.run({
      arguments: ["decode-interface-builder", app, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stdout + output.stderr).toBe(0);
    if (output.json === null)
      throw new Error(
        `CLI returned no JSON: ${output.stdout} ${output.stderr}`,
      );
    const report = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    if (decodeRejected) {
      expect(report.documents).toEqual([]);
      expect(report.graph.coverage).toContainEqual(
        expect.objectContaining({ facet: "archive_decode", status: "partial" }),
      );
    } else expect(report.documents[0]?.hierarchy_complete).toBe(complete);
    const objectId = (id: string | null) =>
      id === null
        ? undefined
        : report.graph.nodes.find((node) => node.id === id)?.attributes
            .interface_builder_object_id;
    const objectLinks = report.graph.edges.flatMap((edge) => {
      const from = objectId(edge.from);
      const to = objectId(edge.to);
      return edge.relation === "contains" &&
        typeof from === "string" &&
        typeof to === "string"
        ? [[from, to]]
        : [];
    });
    expect(objectLinks).toEqual(links);
    for (const [index, object] of objects.entries()) {
      if (
        decodeRejected ||
        ![1, 4, 5, 6].includes(object.classIndex) ||
        Array.isArray(object.values)
      )
        continue;
      const node = report.graph.nodes.find(
        ({ attributes }) =>
          attributes.interface_builder_object_id === String(index),
      );
      for (const [key, value] of Object.entries(object.values)) {
        if (typeof value !== "object" || value === null || !("ref" in value))
          continue;
        expect(node?.attributes.nibValues).toMatchObject({
          [key]: { objectID: String(value.ref) },
        });
      }
    }
    if (registryDiagnostic !== undefined)
      expect(report.limitations.join("\n")).toContain(registryDiagnostic);
    const mcp = createTestMcp();
    onTestFinished(async () => mcp.close());
    const client = await openBundleResourcesTarget(mcp, onTestFinished, app);
    const result = await client.callTool({
      name: "decode_interface_builder",
      arguments: {},
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(
      interfaceBuilderAnalysisSchema.parse(
        parseEvidence(result.structuredContent).normalized_result,
      ),
    ).toEqual(report);
  },
);
