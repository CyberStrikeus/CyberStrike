import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "uses shared loader and export ownership for native bindings through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-native-binding-ownership-");
    await writeFixtureFiles(root, {
      "ordinary.cjs": 'const addon = require("./addon.node");',
      "optional.cjs": 'const addon = require?.("./addon.node");',
      "plain.cjs": 'module.exports = require("./addon.node");',
      "members.cjs":
        'const {run} = require?.("./addon.node"); module.exports = require?.("./addon.node").open;',
      "local.cjs":
        'const helper = { require: name => ({name}) }; const local = helper.require("./addon.node"); function shadow(require) { const local = require("./addon.node"); }',
      "shadow-export.cjs":
        'function local(module, exports) { module.exports = require("./addon.node"); exports.addon = require("./addon.node"); }',
      "detached.cjs":
        'module.exports = {}; exports.addon = require("./addon.node");',
      "arithmetic.cjs": 'exports.sum += require("./addon.node");',
      "logical.cjs": 'module.exports ||= require("./addon.node");',
      "resolver.cjs": 'const filename = require.resolve?.("./addon.node");',
      "addon.node": "inert native addon placeholder; never executed",
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const bindings = result.graph.nodes.flatMap((node) =>
      node.kind === "native-export"
        ? node.observations.map((observation) => ({
            source:
              observation.evidence.location.available &&
              observation.evidence.location.value.kind === "source-range"
                ? observation.evidence.location.value.source
                : null,
            kind: observation.properties.binding_kind,
            members: observation.properties.requested_members,
            target: observation.properties.resolved_path,
          }))
        : [],
    );
    expect(
      bindings.sort(
        (left, right) =>
          String(left.source).localeCompare(String(right.source)) ||
          String(left.kind).localeCompare(String(right.kind)),
      ),
    ).toEqual([
      {
        source: "members.cjs",
        kind: "re-export",
        members: ["open"],
        target: "addon.node",
      },
      {
        source: "members.cjs",
        kind: "require",
        members: ["run"],
        target: "addon.node",
      },
      {
        source: "optional.cjs",
        kind: "require",
        members: [],
        target: "addon.node",
      },
      {
        source: "ordinary.cjs",
        kind: "require",
        members: [],
        target: "addon.node",
      },
      {
        source: "plain.cjs",
        kind: "re-export",
        members: [],
        target: "addon.node",
      },
    ]);
    expect(result.summary).toMatchObject({
      native_addon_bindings: 5,
      resolved_native_addon_bindings: 5,
    });
    // Loading and assigning an addon are separate: compound stores keep their load edge.
    const dependencies = result.graph.edges.filter(
      (edge) =>
        (edge.relation === "imports" || edge.relation === "loads") &&
        edge.properties.specifier === "./addon.node" &&
        edge.evidence.extractor.operation === "map-static-relationship",
    );
    const dependencySources = dependencies.flatMap((edge) =>
      edge.evidence.location.available &&
      edge.evidence.location.value.kind === "source-range"
        ? [edge.evidence.location.value.source]
        : [],
    );
    expect(dependencySources).toEqual(
      expect.arrayContaining([
        "ordinary.cjs",
        "optional.cjs",
        "arithmetic.cjs",
        "logical.cjs",
        "resolver.cjs",
      ]),
    );
    expect(dependencySources).not.toContain("local.cjs");
    const resolver = dependencies.filter(
      (edge) =>
        edge.evidence.location.available &&
        edge.evidence.location.value.kind === "source-range" &&
        edge.evidence.location.value.source === "resolver.cjs",
    );
    expect(resolver).toEqual([
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          operation: "resolve",
          resolved_path: "addon.node",
        }),
      }),
    ]);
    for (const source of [
      "ordinary.cjs",
      "optional.cjs",
      "arithmetic.cjs",
      "logical.cjs",
    ])
      expect(dependencies).toContainEqual(
        expect.objectContaining({
          relation: "loads",
          properties: expect.objectContaining({ operation: "load" }),
          evidence: expect.objectContaining({
            location: expect.objectContaining({
              available: true,
              value: expect.objectContaining({ source }),
            }),
          }),
        }),
      );
    for (const edge of dependencies)
      if (edge.properties.operation === "load")
        expect(edge.relation).toBe("loads");
  },
);
