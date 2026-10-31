import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  analyzeJavaScriptApplication,
  reconstructJavaScriptArtifact,
} from "../../../support/javascriptApplicationScope.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { parseJavaScriptApplicationGraph } from "../../../../src/domain/javascript/javascriptApplicationGraph.js";
import { traceApplicationFeature } from "../../../../src/domain/javascript/javascriptFeatureTrace.js";
import { applicationObligationPolicy } from "../../../../src/application/ReconstructionObligationPolicies.js";

const MAIN = String.raw`
const { app, protocol } = require("electron");
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true } },
]);
app.setAsDefaultProtocolClient("notes");
app.whenReady().then(() => {
  protocol.handle("app", (request) => fetch(request.url));
  protocol.handle(config.scheme, (request) => fetch(request.url));
});
`;

const protocolFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-electron-protocols-");
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "rea-electron-protocols", main: "main.cjs" }),
    ),
    writeFile(join(root, "main.cjs"), MAIN),
  ]);
  return root;
};

describe("Electron URL scheme boundaries", () => {
  it("joins case-insensitive scheme identities while preserving declared spellings", async () => {
    const root = await createTestTempDirectory("rea-electron-protocol-case-");
    await Promise.all([
      writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "protocol-case", main: "main.cjs" }),
      ),
      writeFile(
        join(root, "main.cjs"),
        [
          'const { protocol } = require("electron");',
          'protocol.registerSchemesAsPrivileged([{ scheme: "App", privileges: { secure: true } }]);',
          'protocol.handle("app", () => null);',
        ].join("\n"),
      ),
    ]);
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const schemes = parseJavaScriptApplicationGraph(result.graph).nodes.filter(
      ({ kind }) => kind === "url-scheme",
    );
    expect(schemes).toHaveLength(1);
    expect(
      schemes[0]?.observations.map(({ properties }) => properties),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scheme: "app",
          scheme_literal: "App",
          role: "privileged-scheme",
        }),
        expect.objectContaining({
          scheme: "app",
          scheme_literal: "app",
          role: "handler",
        }),
      ]),
    );
  });

  it("projects each registered scheme into the application graph", async () => {
    const result = await reconstructJavaScriptArtifact({
      input_path: await protocolFixture(),
    });
    const graph = parseJavaScriptApplicationGraph(result.graph);
    const schemes = graph.nodes.filter(({ kind }) => kind === "url-scheme");
    const byLabel = new Map(
      schemes.map((node) => [node.observations[0]?.label, node]),
    );

    expect([...byLabel.keys()].toSorted()).toEqual([
      "app",
      "config.scheme",
      "notes",
    ]);
    // The privileged registration and the handler describe one entry point.
    expect(
      byLabel
        .get("app")
        ?.observations.map(({ properties }) => properties)
        .toSorted((left, right) =>
          String(left.role).localeCompare(String(right.role)),
        ),
    ).toMatchObject([
      { api: "handle", role: "handler", scheme: "app", resolution: "literal" },
      {
        api: "registerSchemesAsPrivileged",
        role: "privileged-scheme",
        enabled_privileges: ["secure", "standard"],
      },
    ]);
    expect(byLabel.get("notes")?.observations[0]?.properties).toMatchObject({
      api: "setAsDefaultProtocolClient",
      role: "os-default-client",
    });
    expect(
      byLabel.get("config.scheme")?.observations[0]?.properties,
    ).toMatchObject({ scheme: null, resolution: "dynamic" });

    const relations = graph.edges
      .filter(({ target_node_id: target }) =>
        schemes.some(({ node_id: id }) => id === target),
      )
      .map(({ relation, properties }) => [relation, properties.role])
      .toSorted((left, right) =>
        String(left[1]).localeCompare(String(right[1])),
      );
    expect(relations).toEqual([
      ["handles", "handler"],
      ["handles", "handler"],
      ["handles", "os-default-client"],
      ["exposes", "privileged-scheme"],
    ]);
  });

  it("counts every registration in the application summary", async () => {
    const result = await analyzeJavaScriptApplication({
      input_path: await protocolFixture(),
    });
    if (!result.ok) throw result.error;
    expect(parseEvidence(result.value)).toMatchObject({
      normalized_result: { summary: { protocol_registrations: 4 } },
    });
  });

  it("keeps non-string and malformed literal schemes as observed, not dynamic", async () => {
    const root = await createTestTempDirectory(
      "rea-electron-protocol-literal-",
    );
    await Promise.all([
      writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "rea-electron-protocol-literal",
          main: "main.cjs",
        }),
      ),
      writeFile(
        join(root, "main.cjs"),
        [
          'const { protocol } = require("electron");',
          "protocol.handle(42, () => null);",
          'protocol.handle("not a scheme", () => null);',
        ].join("\n"),
      ),
    ]);
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const observations = parseJavaScriptApplicationGraph(result.graph)
      .nodes.filter(({ kind }) => kind === "url-scheme")
      .map(({ observations: [first] }) => first)
      .toSorted((left, right) =>
        String(left?.label).localeCompare(String(right?.label)),
      );
    expect(observations).toMatchObject([
      {
        label: "42",
        properties: {
          scheme: null,
          scheme_literal: 42,
          resolution: "invalid-literal",
        },
      },
      {
        label: "not a scheme",
        properties: {
          scheme: null,
          scheme_literal: "not a scheme",
          resolution: "invalid-literal",
        },
      },
    ]);
  });
});

describe("Electron URL scheme graph consumers", () => {
  it("ends feature traces at schemes and gives them a reconstruction policy", async () => {
    const result = await reconstructJavaScriptArtifact({
      input_path: await protocolFixture(),
    });
    const graph = parseJavaScriptApplicationGraph(result.graph);
    const schemeIds = new Set(
      graph.nodes
        .filter(({ kind }) => kind === "url-scheme")
        .map(({ node_id: id }) => id),
    );
    const registering = graph.edges.find(({ target_node_id: target }) =>
      schemeIds.has(target),
    )?.source_node_id;
    const trace = traceApplicationFeature({
      sourceEvidenceId: `ev_${"0".repeat(64)}`,
      graph,
      nativeEvidence: [],
      direction: "outgoing",
      seed: {
        kind: "node-id",
        value: registering ?? "",
        match: "exact",
        case_sensitive: true,
      },
    });
    expect(
      new Set(
        trace.paths
          .filter(({ end_kind: kind }) => kind === "url-scheme")
          .map(({ end_node_id: id }) => id),
      ),
    ).toEqual(schemeIds);
    expect(applicationObligationPolicy("url-scheme")).toMatchObject({
      applicationLayer: "electron",
      family: "url-scheme",
      fixtureAuthority: "packaged-process",
    });
  });

  it("keeps dynamic schemes in identical files as separate occurrences", async () => {
    const root = await createTestTempDirectory("rea-electron-protocol-copies-");
    const source = [
      'const { protocol } = require("electron");',
      "protocol.handle(config.scheme, () => null);",
    ].join("\n");
    // Byte-identical files share a digest but are separate module occurrences.
    await Promise.all([
      writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "rea-electron-protocol-copies",
          main: "main.cjs",
        }),
      ),
      writeFile(join(root, "main.cjs"), source),
      writeFile(join(root, "copy.cjs"), source),
    ]);
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    expect(
      parseJavaScriptApplicationGraph(result.graph).nodes.filter(
        ({ kind }) => kind === "url-scheme",
      ),
    ).toHaveLength(2);
  });
});
