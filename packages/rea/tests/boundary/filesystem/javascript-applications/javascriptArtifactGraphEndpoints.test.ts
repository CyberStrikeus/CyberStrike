import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../../fixtures/artifactInventory.js";
import { readJavaScriptArtifactFiles } from "../../../support/javascriptApplicationScope.js";
import { createJavaScriptArtifactReader } from "../../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { analyzeArtifactFiles } from "../../../fixtures/javascriptArtifactAnalysis.js";
import { immutableArtifactGraph } from "../../../fixtures/javascriptArtifactGraph.js";

it("keeps an endpoint uncertain after mutation through a declared inherited field", async () => {
  const root = await createTestTempDirectory("rea-js-erased-field-");
  await writeFile(
    join(root, "app.ts"),
    `
    const options = { url: "/before" };
    class Base { field = options; }
    class Derived extends Base { declare field: { url: string }; }
    new Derived().field.url = "/after";
    const target = options.url;
    fetch(target);
  `,
  );
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);
    const endpoints = graph.nodes.filter(({ kind }) => kind === "endpoint");
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.observations[0]).toMatchObject({
      properties: { value: "target", resolution: "partial" },
      evidence: {
        authority: "ast-static-analysis",
        state: "observed",
        limitations: [expect.stringContaining("not an exact literal")],
      },
    });
  } finally {
    await reader.close();
  }
});

it("keeps ambiguous endpoint candidates inferred through artifact graph projection", async () => {
  const root = await createTestTempDirectory("rea-js-endpoint-certainty-");
  await writeFile(join(root, "app.js"), 'form.get("shared"); fetch("shared");');
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);
    const endpoints = graph.nodes.filter(({ kind }) => kind === "endpoint");
    const candidate = endpoints.find(({ observations }) =>
      observations.some(
        ({ properties }) => properties.interpretation === "candidate",
      ),
    );
    const observed = endpoints.find(({ observations }) =>
      observations.some(
        ({ properties }) =>
          properties.value === "shared" &&
          properties.interpretation === undefined,
      ),
    );

    expect(candidate).toBeDefined();
    expect(observed).toBeDefined();
    expect(candidate?.node_id).not.toBe(observed?.node_id);
    const candidateObservation = candidate?.observations[0];
    expect(candidateObservation?.properties).toMatchObject({
      value: "shared",
      interpretation: "candidate",
    });
    expect(candidateObservation?.evidence).toMatchObject({
      authority: "static-relationship-inference",
      state: "inferred",
      confidence: "low",
      location: {
        available: true,
        value: { kind: "source-range", source: "app.js" },
      },
    });
    expect(candidateObservation?.evidence.limitations).toEqual(
      expect.arrayContaining([expect.stringContaining("only a candidate")]),
    );
    expect(observed?.observations[0]?.evidence).toMatchObject({
      authority: "ast-static-analysis",
      state: "observed",
      confidence: "exact",
    });
    const candidateEdge = graph.edges.find(
      ({ target_node_id }) => target_node_id === candidate?.node_id,
    );
    expect(candidateEdge?.properties.interpretation).toBe("candidate");
    expect(candidateEdge?.evidence).toMatchObject({
      state: "inferred",
      confidence: "low",
    });
    expect(candidateEdge?.evidence.limitations).toEqual(
      expect.arrayContaining([expect.stringContaining("only a candidate")]),
    );
  } finally {
    await reader.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves partial and exact endpoint identity through graph projection", async () => {
  const root = await createTestTempDirectory(
    "rea-js-endpoint-partial-identity-",
  );
  await writeFile(
    join(root, "app.js"),
    'fetch(target); fetch("target"); function other(target) { fetch(target); }',
  );
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);
    const endpoints = graph.nodes.filter(({ kind }) => kind === "endpoint");
    const partialNodes = endpoints.filter(({ observations }) =>
      observations.some(
        ({ properties }) => properties.resolution === "partial",
      ),
    );
    const partial = partialNodes[0];
    const exact = endpoints.find(({ observations }) =>
      observations.some(
        ({ properties }) =>
          properties.value === "target" && properties.resolution === undefined,
      ),
    );

    expect(partialNodes).toHaveLength(2);
    expect(new Set(partialNodes.map(({ node_id }) => node_id)).size).toBe(2);
    expect(exact).toBeDefined();
    expect(partial?.node_id).not.toBe(exact?.node_id);
    expect(partial?.observations[0]).toMatchObject({
      properties: {
        endpoint_kind: "network",
        value: "target",
        mechanism: "call:fetch",
        resolution: "partial",
      },
      evidence: {
        authority: "ast-static-analysis",
        state: "observed",
        limitations: [expect.stringContaining("not an exact literal")],
      },
    });
  } finally {
    await reader.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("projects path data records as inferred route candidates", async () => {
  const root = await createTestTempDirectory("rea-js-route-property-");
  await writeFile(
    join(root, "app.js"),
    'const ops = [{ type: "set", path: "updatedAt", value: 1 }];\n' +
      'const routes = [{ path: "/settings", component: Settings }];',
  );
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);
    const route = (value: string) =>
      graph.nodes
        .find(
          ({ kind, observations }) =>
            kind === "endpoint" &&
            observations.some(({ properties }) => properties.value === value),
        )
        ?.observations.find(({ properties }) => properties.value === value);

    expect(route("updatedAt")?.properties).toMatchObject({
      endpoint_kind: "route",
      mechanism: "property:path",
      interpretation: "candidate",
    });
    expect(route("updatedAt")?.evidence).toMatchObject({
      authority: "static-relationship-inference",
      state: "inferred",
      confidence: "low",
    });
    expect(route("updatedAt")?.evidence.limitations).toEqual(
      expect.arrayContaining([expect.stringContaining("no router fields")]),
    );
    expect(route("/settings")?.properties.interpretation).toBeUndefined();
    expect(route("/settings")?.evidence).toMatchObject({
      authority: "ast-static-analysis",
      state: "observed",
      confidence: "exact",
    });
  } finally {
    await reader.close();
    await rm(root, { recursive: true, force: true });
  }
});
