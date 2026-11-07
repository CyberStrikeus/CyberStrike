import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves route flags and lexical RPC names through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-route-rpc-identity-");
    await writeFixtureFiles(root, {
      "entry.ts": `
        const INDEX=true;
        createBrowserRouter([{index:INDEX,Component:Home}, {path:'/wrapped',children:[{index:(true as const),Component:Home}]}]);
        function clientScope() {
          const history=createTRPCClient({links:[httpBatchLink({url:'/api/trpc'})]});
          history.archive.query();history.history.list.query();
          navigator.permissions.query({name:'geolocation'});
          api.endpoints.list.useQuery();
        }
      `,
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    expect(result.route_inventory?.routes.map(({ path }) => path)).toEqual([
      "/",
      "/wrapped",
    ]);
    const operations = result.graph.nodes
      .filter(({ kind }) => kind === "endpoint")
      .flatMap(({ observations }) => observations)
      .filter(
        ({ properties }) => properties.mechanism === "trpc:procedure:query",
      )
      .map(({ properties }) => properties.value)
      .sort();
    expect(operations).toEqual(["archive", "history.list"]);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains anchored reserved-prefix route constants through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-route-reserved-prefix-");
    await writeFixtureFiles(root, {
      "entry.js": `globalThis.TURBOPACK=[];
        import {createBrowserRouter} from 'react-router-dom';
        export const router=createBrowserRouter([{path:'/static',element:null}]);
        const help='/static/help';globalThis.helpLink=help;
        const unrelated='/api/unanchored';globalThis.other=unrelated;`,
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const routes = result.route_inventory?.routes ?? [];
    expect(routes.find(({ path }) => path === "/static/help")).toMatchObject({
      confidence: "low",
      classification: "unknown",
    });
    expect(routes.some(({ path }) => path === "/api/unanchored")).toBe(false);
    expect(result.route_inventory?.coverage.application_routes).toBe("unknown");
  },
);
