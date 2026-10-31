import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  {
    name: "returned app",
    setter: "const getApp=()=>app;getApp().setAppPath('./lib');",
    owners: 1,
    changed: true,
  },
  {
    name: "awaited app",
    setter: "const getApp=async()=>app;(await getApp()).setAppPath('./lib');",
    owners: 1,
    changed: true,
  },
  {
    name: "shallow-copied app",
    setter: "const copy={...{app}};copy.app.setAppPath('./lib');",
    owners: 1,
    changed: true,
  },
  {
    name: "local app",
    setter: "const getApp=()=>({setAppPath(){}});getApp().setAppPath('./lib');",
    owners: 1,
    changed: false,
  },
  {
    name: "replaced app setter",
    setter: "app.setAppPath=()=>{};app.setAppPath('/changed');",
    owners: 1,
    changed: false,
  },
  {
    name: "conditional setter replacement",
    setter: "if(flag)app.setAppPath=()=>{};app.setAppPath('/changed');",
    owners: 1,
    changed: true,
  },
  {
    name: "original setter captured before replacement",
    setter:
      "const change=app.setAppPath;app.setAppPath=()=>{};change('/changed');",
    owners: 1,
    changed: true,
  },
  {
    name: "local setter captured after replacement",
    setter:
      "app.setAppPath=()=>{};const change=app.setAppPath;change('/changed');",
    owners: 1,
    changed: false,
  },
  {
    name: "assigned app",
    setter: "let runtime;(runtime=app).setAppPath('/changed');",
    owners: 1,
    changed: true,
  },
  {
    name: "assigned local app",
    setter: "let runtime;(runtime={setAppPath(){}}).setAppPath('/changed');",
    owners: 1,
    changed: false,
  },
  {
    name: "shared returned app",
    setter: "const getApp=()=>app;getApp().setAppPath('./lib');",
    owners: 3,
    changed: true,
  },
] as const;

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((test) => ({ ...test, surface })),
  ),
)(
  "preserves $name path uncertainty for $owners application owners through $surface",
  async ({ surface, setter, owners, changed }, { cli }) => {
    const root = await createTestTempDirectory("rea-returned-app-path-");
    const files: Record<string, string> = {
      "shared/change.mjs": `throw new Error('Static fixture must never execute');import {app} from 'electron';${setter}`,
      "shared/index.html": "setter-relative decoy",
      "index.html": "artifact-root decoy",
    };
    for (let index = 0; index < owners; index++) {
      const directory = `app-${index}`;
      files[`${directory}/package.json`] = JSON.stringify({ main: "main.mjs" });
      files[`${directory}/main.mjs`] =
        `throw new Error('Static fixture must never execute');import '../shared/change.mjs';import {BrowserWindow} from 'electron';new BrowserWindow().loadFile('index.html');`;
      files[`${directory}/index.html`] = `page-${index}`;
    }
    await writeFixtureFiles(root, files);
    const { graph, statistics } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      root,
    );
    expect(statistics.parse_failures).toBe(0);
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(owners);
    for (const role of roles) {
      expect(role.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolution_status: changed ? "unavailable" : "resolved",
              ...(changed ? { resolved_path: null } : {}),
            }),
          }),
        ]),
      );
      const mapped = graph.edges.filter(
        ({ relation, source_node_id }) =>
          relation === "maps_to" && source_node_id === role.node_id,
      );
      expect(mapped).toHaveLength(changed ? 0 : 1);
      if (!changed)
        expect(mapped[0]?.properties.resolved_path).toBe("app-0/index.html");
    }
  },
);
