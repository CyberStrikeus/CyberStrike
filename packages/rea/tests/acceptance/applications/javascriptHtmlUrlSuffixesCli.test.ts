import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "admits HTML script pathnames without treating URL suffixes as paths through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-html-url-suffixes-");
    const cases = [
      {
        source: "query.html",
        script: "./app.js?redirect=%2Ffoo",
        resolved: "app.js",
      },
      {
        source: "fragment.html",
        script: "./app.js#route=%2Ffoo",
        resolved: "app.js",
      },
      {
        source: "suffix-bytes.html",
        script: "./app.js?value=%2e%5c%00%ff\\tail",
        resolved: "app.js",
      },
      {
        source: "url-text.html",
        script: " \n./a\tpp.js?redirect=%2\nfassets ",
        resolved: "app.js",
      },
      {
        source: "self.html",
        script: "?redirect=%2Ffoo",
        resolved: "self.html",
      },
      {
        source: "self-fragment.html",
        script: "#route=%5Cfoo",
        resolved: "self-fragment.html",
      },
      {
        source: "base.html",
        base: "assets/?redirect=%2Froot",
        script: "app.js#route=%2Ffoo",
        resolved: "assets/app.js",
      },
      {
        source: "base-self.html",
        base: "assets/app.js?redirect=%5Croot",
        script: "?redirect=%2Ffoo",
        resolved: "assets/app.js",
      },
      {
        source: "path-separator.html",
        script: "./assets%2Fapp.js?valid=1",
        resolved: null,
      },
      { source: "path-dot.html", script: "./%2e/app.js#valid", resolved: null },
      {
        source: "path-backslash.html",
        script: "./assets\\app.js?valid=1",
        resolved: null,
      },
      {
        source: "path-nul.html",
        script: "./app%00.js?valid=1",
        resolved: null,
      },
      {
        source: "split-separator.html",
        script: "./assets%2\nfapp.js?valid=1",
        resolved: null,
      },
      {
        source: "base-separator.html",
        base: "assets%2F?valid=1",
        script: "app.js?redirect=%2Ffoo",
        resolved: null,
      },
    ];
    await writeFixtureFiles(root, {
      ...Object.fromEntries(
        cases.map(({ source, base, script }) => [
          source,
          `${base === undefined ? "" : `<base href="${base}">`}<script src="${script}"></script>`,
        ]),
      ),
      "app.js": "globalThis.rootApp = true;",
      "assets/app.js": "globalThis.nestedApp = true;",
    });

    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const loads = result.graph.edges.filter(
      ({ relation }) => relation === "loads",
    );
    const unresolved = result.graph.nodes
      .flatMap(({ observations }) => observations)
      .filter(
        ({ properties }) => properties.mechanism === "html-script-reference",
      );
    for (const { source, base, script, resolved } of cases) {
      const load = loads.find(
        ({ evidence }) =>
          evidence.location.available &&
          evidence.location.value.kind === "source-range" &&
          evidence.location.value.source === source,
      );
      if (resolved === null) {
        expect(
          unresolved.find(
            ({ properties }) => properties.script_path === script,
          ),
        ).toMatchObject({
          properties: {
            script_path: script,
            resolved_path: null,
            resolution_status: "rejected",
          },
        });
        expect(load).toBeUndefined();
        continue;
      }
      expect(load).toMatchObject({
        properties: {
          script_path: script,
          base_href: base ?? null,
          resolved_path: resolved,
          resolution_context: "html-reference",
          resolution_status: "resolved",
        },
      });
    }
  },
);
