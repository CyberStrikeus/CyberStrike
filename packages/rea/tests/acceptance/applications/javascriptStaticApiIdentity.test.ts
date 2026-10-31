import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves static API identity through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-static-api-identity-");
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ main: "main.mjs", type: "module" }),
      "main.mjs": `
        import {BrowserWindow as Win} from 'electron';
        import {fileURLToPath, URL as NativeConstructor} from 'node:url';
        class URL {constructor(input, base) {return new globalThis.URL('./actual.js', base);}}
        const cache = {loadFile(value) {return value;}};
        cache.loadFile('data.json');
        const localStorage = {setItem(key, value) {return value;}};
        localStorage.setItem('ghost', 'value');
        globalThis.localStorage.setItem('real', 'value');
        const unrelated = {preload: './decoy.js'};
        new Win({webPreferences:{preload:fileURLToPath(new URL('./decoy.js', import.meta.url))}});
        new Win({webPreferences:{preload:fileURLToPath(new NativeConstructor('./native.js', import.meta.url))}});
        new Win({webPreferences:{preload:'./preload.js'}}).loadFile('index.html');
      `,
      "actual.js": "export {};",
      "decoy.js": "export {};",
      "preload.js": "export {};",
      "native.js": "export {};",
      "data.json": "{}",
      "index.html": "<!doctype html><title>Fixture</title>",
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const roles = result.graph.nodes.filter(
      ({ kind }) => kind === "electron-preload" || kind === "electron-renderer",
    );
    expect(
      roles.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties.resolved_path),
      ),
    ).toEqual(
      expect.arrayContaining(["preload.js", "native.js", "index.html"]),
    );
    expect(
      roles.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties.resolved_path),
      ),
    ).not.toEqual(expect.arrayContaining(["decoy.js"]));
    expect(
      roles.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties.resolved_path),
      ),
    ).not.toEqual(expect.arrayContaining(["data.json"]));
    const storage = result.graph.nodes.filter(({ kind }) => kind === "storage");
    expect(
      storage.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties.name),
      ),
    ).toEqual(["real"]);
  },
);
