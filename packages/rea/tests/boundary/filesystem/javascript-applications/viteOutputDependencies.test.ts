import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  reconstructJavaScriptFixture,
  writeFixtureFiles,
} from "../../../support/javascriptApplicationFixture.js";

// Vite's absolute-base build output: the helper table names files under the
// output directory, and the real import is relative to the importing chunk.
const viteBuild = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-vite-output-");
  await writeFixtureFiles(root, {
    "index.html":
      '<!doctype html><script type="module" src="/assets/index.js"></script>',
    "assets/index.js": `
      const __vite__mapDeps = (i, m = __vite__mapDeps, d =
        (m.f || (m.f = ["assets/lazy.js", "assets/missing.js"]))) => i.map((i) => d[i]);
      const preload = (load, deps) => load();
      export const route = () =>
        preload(() => import("./lazy.js"), __vite__mapDeps([0, 1]));
    `,
    "assets/lazy.js": "export const lazy = true;",
  });
  return root;
};

const preloadEdges = (
  graph: Awaited<ReturnType<typeof reconstructJavaScriptFixture>>["graph"],
) =>
  graph.edges
    .filter(
      ({ relation, properties }) =>
        relation === "imports" &&
        typeof properties.specifier === "string" &&
        properties.specifier.startsWith("vite-output:"),
    )
    .map(({ properties }) => ({
      specifier: properties.specifier,
      resolution_status: properties.resolution_status,
      resolved_path: properties.resolved_path,
    }));

describe("Vite build-output preload dependencies", () => {
  it("resolves a dependency under the selected build output directory", async () => {
    const result = await reconstructJavaScriptFixture(await viteBuild());

    expect(preloadEdges(result.graph)).toContainEqual({
      specifier: "vite-output:assets/lazy.js",
      resolution_status: "resolved",
      resolved_path: "assets/lazy.js",
    });
    const missing = result.graph.edges.find(
      ({ properties }) =>
        properties.specifier === "vite-output:assets/missing.js",
    );
    expect(missing?.evidence.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no ancestor of the importing file holds it"),
      ]),
    );
  });

  it("does not report a dependency as an external package when only the assets directory is selected", async () => {
    const root = await viteBuild();
    const result = await reconstructJavaScriptFixture(join(root, "assets"));
    expect(
      result.graph.edges.map(({ properties }) => properties.resolution_status),
    ).not.toContain("external");
    expect(
      result.graph.nodes.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties.resolution_status),
      ),
    ).not.toContain("external");
    // Also guard nested graph metadata so the original graph-wide exclusion
    // remains in force if a producer adds another resolution-status location.
    expect(JSON.stringify(result.graph)).not.toContain(
      '"resolution_status":"external"',
    );
    const edges = result.graph.edges.filter(
      ({ properties }) => properties.specifier === "vite-output:assets/lazy.js",
    );
    expect(edges).toHaveLength(1);
    expect(typeof edges[0]?.properties.resolution_status).toBe("string");
    expect(edges[0]?.properties.resolution_status).not.toBe("external");
    expect(edges[0]?.evidence.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "A Vite preload dependency is relative to the build output directory",
        ),
      ]),
    );
  });

  it("keeps an inventoried but unanalyzed dependency under a nested build output directory", async () => {
    const root = await createTestTempDirectory("rea-vite-output-css-");
    await writeFixtureFiles(root, {
      "dist/index.html":
        '<!doctype html><script type="module" src="/assets/index.js"></script>',
      "dist/assets/index.js": `
        const __vite__mapDeps = (i, m = __vite__mapDeps, d =
          (m.f || (m.f = ["assets/lazy.css"]))) => i.map((i) => d[i]);
        export const route = () => __vite__mapDeps([0]);
      `,
      "dist/assets/lazy.css": ".lazy { color: green; }",
    });
    const result = await reconstructJavaScriptFixture(root);
    const edge = result.graph.edges.find(
      ({ properties }) =>
        properties.specifier === "vite-output:assets/lazy.css",
    );

    expect(edge?.properties).toMatchObject({
      resolution_status: "unavailable",
      candidate_path: "dist/assets/lazy.css",
    });
    expect(edge?.evidence.limitations).toEqual(expect.any(Array));
    expect(edge?.evidence.limitations).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("no ancestor of the importing file holds it"),
      ]),
    );
  });
});
