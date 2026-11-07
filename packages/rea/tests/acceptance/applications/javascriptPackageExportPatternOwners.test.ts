import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  {
    name: "matching wildcard",
    exports: { "./*": "./*.cjs" },
    status: "unavailable",
    possibleOwner: true,
    nodeAllowed: true,
  },
  {
    name: "unrelated wildcard",
    exports: { "./other/*": "./*.cjs" },
    status: "external",
    possibleOwner: false,
    nodeAllowed: false,
  },
  {
    name: "exact key before wildcard",
    exports: { "./*": "./*.cjs", "./window": "./window.cjs" },
    status: "resolved",
    possibleOwner: true,
    nodeAllowed: true,
  },
  {
    name: "exact null before wildcard",
    exports: { "./*": "./*.cjs", "./window": null },
    status: "external",
    possibleOwner: false,
    nodeAllowed: false,
  },
  {
    name: "specific null before broader wildcard",
    exports: { "./*": "./*.cjs", "./w*": null },
    status: "external",
    possibleOwner: false,
    nodeAllowed: false,
  },
] as const;
cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((test) => ({ ...test, surface })),
  ),
)(
  "retains $name dependency ownership through $surface",
  async ({ surface, exports, status, possibleOwner, nodeAllowed }, { cli }) => {
    const root = await createTestTempDirectory("rea-exports-pattern-owner-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs":
        'throw new Error("Static fixture must never execute");require("fixture/window");',
      "a/index.html": "first app decoy",
      "b/package.json": JSON.stringify({ main: "main.cjs" }),
      "b/main.cjs":
        'throw new Error("Static fixture must never execute");require("../node_modules/fixture/window.cjs");',
      "b/index.html": "second application page",
      "node_modules/fixture/package.json": JSON.stringify({ exports }),
      "node_modules/fixture/window.cjs":
        'throw new Error("Static fixture must never execute");const {BrowserWindow}=require("electron");new BrowserWindow().loadFile("index.html");',
      "index.html": "artifact root decoy",
      "oracle.cjs":
        'const {createRequire}=require("node:module");const loader=createRequire(require("node:path").join(__dirname,"a/main.cjs"));try{console.log(JSON.stringify({path:loader.resolve("fixture/window").split(require("node:path").sep).join("/")}));}catch(error){console.log(JSON.stringify({code:error.code}));}',
    });
    // This authored control asks the native resolver for a path; it never
    // executes the Electron source whose ownership is under analysis.
    const oracle = await runNodeJsonControl(root, "oracle.cjs");
    expect(oracle).toEqual(
      nodeAllowed
        ? { path: expect.stringContaining("/node_modules/fixture/window.cjs") }
        : { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
    );
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root, {
      sourcePaths: [
        "a/package.json",
        "a/main.cjs",
        "b/package.json",
        "b/main.cjs",
        "node_modules/fixture/package.json",
        "node_modules/fixture/window.cjs",
      ],
    });
    const refs = graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" && properties.specifier === "fixture/window",
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs)
      expect(ref.properties.resolution_status).toBe(status);
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const target = possibleOwner ? null : "b/index.html";
    expect(roles[0]?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolved_path: target,
            resolution_status: possibleOwner ? "unavailable" : "resolved",
          }),
        }),
      ]),
    );
    expect(
      graph.edges
        .filter(
          ({ relation, source_node_id }) =>
            relation === "maps_to" && source_node_id === roles[0]?.node_id,
        )
        .map(({ properties }) => properties.resolved_path),
    ).toEqual(target === null ? [] : [target]);
  },
);
