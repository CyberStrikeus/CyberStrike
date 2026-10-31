import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  "unselected",
  "transitive-unselected",
  "invalid-utf8",
  "parse-failed",
  "read-inert",
  "unreferenced",
  "json",
] as const;
cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((gap) => ({ surface, gap })),
  ),
)(
  "retains possible app path changes from a reachable $gap module through $surface",
  async ({ surface, gap }, { cli }) => {
    const root = await createTestTempDirectory("rea-unread-app-path-change-");
    const window =
      'const {BrowserWindow}=require("electron");new BrowserWindow().loadFile("index.html");';
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": `${gap === "unreferenced" ? "" : gap === "transitive-unselected" ? 'require("./middle.cjs");' : `require("./change.${gap === "json" ? "json" : "cjs"}");`}${window}`,
      "a/change.cjs":
        gap === "parse-failed"
          ? "const = ;"
          : gap === "read-inert"
            ? "module.exports=42;"
            : 'const {app}=require("electron");app.setAppPath("/changed");',
      "a/change.json": '{"inert":true}',
      "a/middle.cjs": 'require("./change.cjs");',
      "a/index.html": "first application page",
      "b/package.json": JSON.stringify({ main: "main.cjs" }),
      "b/main.cjs": window,
      "b/index.html": "unrelated second application page",
      "index.html": "artifact root decoy",
    });
    if (gap === "invalid-utf8")
      await writeFile(
        join(root, "a/change.cjs"),
        Buffer.from([0xff, 0xfe, 0x80]),
      );
    const sourcePaths = [
      "a/package.json",
      "a/main.cjs",
      "b/package.json",
      "b/main.cjs",
      ...(gap === "unselected" ||
      gap === "unreferenced" ||
      gap === "transitive-unselected"
        ? []
        : [`a/change.${gap === "json" ? "json" : "cjs"}`]),
      ...(gap === "transitive-unselected" ? ["a/middle.cjs"] : []),
    ];
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root, {
      sourcePaths,
    });
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(2);
    for (const app of ["a", "b"]) {
      const role = roles.find(({ observations }) =>
        observations.some(
          ({ evidence }) =>
            evidence.location.available &&
            evidence.location.value.kind === "source-range" &&
            evidence.location.value.source === `${app}/main.cjs`,
        ),
      );
      // The unread source could itself import b/main, so the existing loader
      // owner policy also retains competition for that module. In contrast an
      // unreferenced omitted source must not invalidate either proven root.
      const changed = [
        "unselected",
        "transitive-unselected",
        "invalid-utf8",
        "parse-failed",
      ].includes(gap);
      const expected = changed ? null : `${app}/index.html`;
      expect(role?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolved_path: expected,
              resolution_status: changed ? "unavailable" : "resolved",
            }),
          }),
        ]),
      );
      expect(
        graph.edges
          .filter(
            ({ source_node_id, relation }) =>
              source_node_id === role?.node_id && relation === "maps_to",
          )
          .map(({ properties }) => properties.resolved_path),
      ).toEqual(expected === null ? [] : [expected]);
    }
  },
);
