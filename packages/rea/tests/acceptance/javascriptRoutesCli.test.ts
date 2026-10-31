import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { javaScriptRoutesViewResultSchema } from "../../src/domain/analysisView/analysisView.js";

const routeViewFromEvidence = (evidence: unknown) =>
  javaScriptRoutesViewResultSchema.parse(
    parseEvidence(evidence).normalized_result,
  );

const expectAccountRoutes = (items: unknown[]) => {
  expect(items).toHaveLength(2);
  expect(items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "/account" }),
      expect.objectContaining({ path: "/account/:id" }),
    ]),
  );
};

const interceptedSource = "export default function Photo(){return null;}";
const independentPaths = [
  "/checks/independent",
  "/checks/projected",
  "/checks/rest",
  "/checks/inactive-default",
  "/checks/inactive-branch",
  "/checks/overwritten",
  "/checks/member",
  "/checks/config-sibling",
  "/checks/optional/:id?",
];

const fixture = async () => {
  const path = await createTestTempDirectory("rea-javascript-routes-");
  await writeFile(
    join(path, "routes.js"),
    `globalThis.TURBOPACK=[];globalThis.TURBOPACK.push([1,function module(){const routes=defineRoutes({reports:{_$:'reports',settings:{_$:'settings'},history:{}}});createBrowserRouter([{path:'/account',children:[{path:':id'}]}]);router.push('/reports/' + selectedId);router.push({pathname:'/reports/' + selectedId});router.navigate(['/reports/',selectedId]);const mixed={children:[{path:'/reports/stale-ordinary',element:View},{_$:'/reports/stale-typed'}]};mixed.children[1]._$='/reports/changed';createBrowserRouter(mixed);router.push({pathname:'/reports/static-object',query:{href:'/query-data',path:'/download/file',component:'preview'}});router.addRoute('admin',{path:'settings',component:View});const aliasQuery={path:'/download/alias',component:'preview',href:'/alias-query-data',module:'app/fake/page.tsx'};const target={pathname:'/reports/aliased',query:aliasQuery};router.push(target);const independent={path:'/checks/independent',component:View};router.push({pathname:'/reports/aliased',query:independent ? {ok:1}:{ok:2}});createBrowserRouter([{path:'/reports/stale-computed',[computedKey]:'/unrelated',children:[{path:'settings'}]}]);const registry={route:{path:'/checks/projected',component:View},query:{path:'/download/projected-query',component:Preview}};const {query:payload}=registry;router.push({pathname:'/reports/aliased',query:payload});const pattern='/checks/optional/:id?';createBrowserRouter([{path:pattern}]);const restRegistry={query:{path:'/download/rest-query',component:Preview},route:{path:'/checks/rest',component:View}};const {route,...restPayload}=restRegistry;router.push({pathname:'/reports/aliased',query:restPayload});const fallback={path:'/checks/inactive-default',component:View};const {query:actualQuery=fallback}={query:{ok:1}};router.push({pathname:'/reports/aliased',query:actualQuery});const cache=[];cache.push('/checks/array-data');text.replace('/checks/string-data','');const inactiveBranch={path:'/checks/inactive-branch',component:View};router.push({pathname:'/reports/aliased',query:true?{}:inactiveBranch});const overwritten={path:'/checks/overwritten',component:View};router.push({pathname:'/reports/aliased',query:{item:overwritten,item:0}});const memberRegistry={query:{path:'/download/member-query',component:Preview},route:{path:'/checks/member',component:View}};router.push({pathname:'/reports/aliased',query:memberRegistry.query});const protoPayload={path:'/download/proto-query',component:Preview};router.push({pathname:'/reports/aliased',query:{['__proto__']:protoPayload,__proto__:null}});const replacedRegistry={query:independent};replacedRegistry.query={ok:1};router.push({pathname:'/reports/aliased',query:replacedRegistry.query});let replacedDirect=independent;replacedDirect={ok:1};router.push({pathname:'/reports/aliased',query:replacedDirect});const uncertainPayload={path:'/download/uncertain-query',component:Preview};const uncertainRegistry={query:uncertainPayload};const otherRegistry={query:{ok:1}};const uncertainAlias=flag?uncertainRegistry:otherRegistry;uncertainAlias.query={ok:1};router.push({pathname:'/reports/aliased',query:uncertainRegistry.query});const possiblePayload={path:'/download/possible-query',component:Preview};const possibleRegistry={query:possiblePayload,...unknown};router.push({pathname:'/reports/aliased',query:possibleRegistry.query});const cyclicRegistry={get a(){return this.a.b}};router.push({pathname:'/reports/aliased',query:cyclicRegistry.a});const finiteRegistry={get a(){return this},get b(){return this.a.a},path:'/download/finite-query',component:Preview};router.push({pathname:'/reports/aliased',query:finiteRegistry.a.b});const configurationRegistry={children:[{path:'/checks/config-sibling',component:View}],routes:[]};createBrowserRouter(configurationRegistry.routes);const helper='app/reports/helper/page-helpers.js';const extra='/reports/help';}]);`,
  );
  await writeFile(
    join(path, "package.json"),
    JSON.stringify({ dependencies: { next: "16.4.2" } }),
  );
  const intercepted = join(path, "app/feed/(.)photo");
  await mkdir(intercepted, { recursive: true });
  await writeFile(join(intercepted, "page.tsx"), interceptedSource);
  return path;
};
cliTest(
  "exports complete route Evidence and queries it after source removal",
  async ({ cli }) => {
    const path = await fixture(),
      output = join(
        await createTestTempDirectory("rea-route-evidence-"),
        "routes.json",
      );
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        path,
        "--detail",
        "summary",
        "--view",
        JSON.stringify({
          kind: "javascript-routes",
          collection: "routes",
          fields: ["path"],
          where: { path_prefix: "/reports" },
          limit: 2,
        }),
        "--evidence_output",
        output,
        "--json",
      ],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const envelope = response.json as {
      summary: unknown;
      evidence_bundle: { path: string };
    };
    const view = routeViewFromEvidence(envelope.summary);
    expect(view.items).toEqual([
      expect.objectContaining({ path: "/reports" }),
      expect.objectContaining({ path: "/reports/aliased" }),
    ]);
    expect(view.coverage).toMatchObject({ total: 6, next_offset: 2 });
    expect(view.sources[0]!.sha256).toMatch(/^[a-f0-9]{64}$/u);
    await rm(path, { recursive: true });
    const bundle = JSON.parse(await readFile(output, "utf8")) as {
      records: { evidence_id: string }[];
    };
    const record = bundle.records.find(
      (record) => record.evidence_id === view.parent_evidence_id,
    );
    expect(record).toBeDefined();
    const evidenceFile = join(
      await createTestTempDirectory("rea-route-record-"),
      "evidence.json",
    );
    await writeFile(evidenceFile, JSON.stringify(record));
    const repeated = await cli.run({
      arguments: [
        "inspect-analysis-view",
        JSON.stringify({
          source: {
            kind: "evidence-file",
            path: evidenceFile,
          },
          view: {
            kind: "javascript-routes",
            collection: "routes",
            where: { path_prefix: "/reports" },
            offset: 2,
            limit: 2,
          },
        }),
        "--json",
      ],
    });
    expect(repeated.exitCode, repeated.stdout + repeated.stderr).toBe(0);
    const nextPage = routeViewFromEvidence(repeated.json);
    expect(nextPage.parent_evidence_id).toBe(view.parent_evidence_id);
    expect(nextPage.coverage).toMatchObject({ total: 6, next_offset: 4 });
    expect(nextPage.items).toEqual([
      expect.objectContaining({ path: "/reports/help" }),
      expect.objectContaining({ path: "/reports/history" }),
    ]);
  },
);
cliTest(
  "rejects invalid route delivery before accessing the application",
  async ({ cli }) => {
    for (const args of [
      ["--view", "{"],
      [
        "--detail",
        "summary",
        "--view",
        '{"kind":"javascript-routes","collection":"routes"}',
      ],
    ]) {
      const response = await cli.run({
        arguments: [
          "analyze-javascript-application",
          "/not-opened",
          ...args,
          "--json",
        ],
      });
      expect(response.exitCode).not.toBe(0);
      expect(response.json).toMatchObject({ code: "invalid_request" });
    }
  },
);
it.each(["full", "compact"] as const)(
  "serves retained route batches through the %s production SDK schemas",
  async (profile) => {
    const path = await fixture(),
      { call } = await connectLocalToolsMcp({
        REA_MCP_INPUT_SCHEMA_PROFILE: profile,
      });
    for (const source_paths of [[], [""], [1]]) {
      const invalid = await call("analyze_javascript_application", {
        input_path: path,
        source_paths,
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.content)).toContain("source_paths");
    }
    const deliveryView = { kind: "javascript-routes", collection: "routes" };
    for (const delivery of [
      { view: deliveryView },
      { detail: "complete", view: deliveryView },
    ]) {
      const invalid = await call("analyze_javascript_application", {
        input_path: "/not-opened",
        ...delivery,
      });
      expect(invalid.isError).toBe(true);
    }
    const invalidBrowser = await call("analyze_web_bundle", {
      cdp_endpoint: "http://127.0.0.1:1",
      target_id: "not-opened",
      allowed_origins: ["https://example.test"],
      detail: "summary",
    });
    expect(invalidBrowser.isError).toBe(true);
    const response = await call("analyze_javascript_application", {
      input_path: path,
      detail: "summary",
      view: {
        kind: "javascript-routes",
        collection: "routes",
        where: { path_prefix: "/account" },
      },
    });
    expect(response.isError).not.toBe(true);
    const selected = routeViewFromEvidence(response.structuredContent);
    expectAccountRoutes(selected.items);
    await rm(path, { recursive: true });
    const occurrences = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: selected.parent_evidence_id,
      },
      view: {
        kind: "javascript-routes",
        collection: "occurrences",
        where: { route_ids: selected.items.map((row) => row.id) },
        fields: ["segments"],
      },
    });
    expect(occurrences.isError).not.toBe(true);
    const result = routeViewFromEvidence(occurrences.structuredContent);
    expect(result.items).toHaveLength(2);
    expect(result.sources).toHaveLength(1);
    expect(result.source_coverage.application_routes).toBe("unknown");
    const dataPaths = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: selected.parent_evidence_id,
      },
      view: {
        kind: "javascript-routes",
        collection: "routes",
        where: {
          paths: [
            "/download/file",
            "/query-data",
            "/download/alias",
            "/alias-query-data",
            "/fake",
            "/download/projected-query",
            "/download/member-query",
            "/download/proto-query",
            "/download/uncertain-query",
            "/download/possible-query",
            "/download/finite-query",
            "/checks/optional/:id",
            "/download/rest-query",
            "/checks/array-data",
            "/checks/string-data",
          ],
        },
      },
    });
    expect(dataPaths.isError).not.toBe(true);
    expect(routeViewFromEvidence(dataPaths.structuredContent).items).toEqual(
      [],
    );
    const independent = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: selected.parent_evidence_id,
      },
      view: {
        kind: "javascript-routes",
        collection: "routes",
        where: {
          paths: independentPaths,
        },
        fields: ["path"],
      },
    });
    expect(independent.isError).not.toBe(true);
    const independentItems = routeViewFromEvidence(
      independent.structuredContent,
    ).items;
    expect(independentItems).toHaveLength(independentPaths.length);
    expect(independentItems).toEqual(
      expect.arrayContaining(
        independentPaths.map((path) => expect.objectContaining({ path })),
      ),
    );
    const unknowns = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: selected.parent_evidence_id,
      },
      view: {
        kind: "javascript-routes",
        collection: "unknowns",
        where: { kinds: ["interpretation"] },
      },
    });
    expect(unknowns.isError).not.toBe(true);
    const gaps = routeViewFromEvidence(unknowns.structuredContent);
    expect(gaps.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining("intercepted"),
        }),
        expect.objectContaining({ reason: expect.stringMatching(/cyclic/i) }),
      ]),
    );
    expect(gaps.source_coverage.candidate_enumeration).toBe("partial");
    expect(
      gaps.sources.some(
        ({ sha256 }) =>
          sha256 ===
          createHash("sha256").update(interceptedSource).digest("hex"),
      ),
    ).toBe(true);
  },
);

cliTest(
  "projects captured route facts through both browser adapters",
  async ({ cli }) => {
    const { startFakeCdpBrowser } =
      await import("../fixtures/fakeCdpBrowser.js");
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }) =>
        method === "Debugger.getScriptSource"
          ? {
              scriptSource: `const panels=[{path:'panel',element:Panel}];const discarded={path:'/discarded',children:panels,children:[]};const secondary=[{path:'/reports',children:[{children:panels}]}];createBrowserRouter([{path:'/reports',children:[{path:'settings'}],element:jsx(Panel,{routes:secondary})}]);const query={path:'/download/web-data',component:'preview',href:'/web-query-data',module:'app/web-fake/page.tsx'};const target={pathname:'/reports/aliased-web',query};router.push(target);const independent={path:'/checks/independent-web',component:View};router.push({pathname:'/reports/aliased-web',query:!!independent});const registry={route:{path:'/checks/projected-web',component:View},query:{path:'/download/projected-web-query',component:Preview}};const {query:payload}=registry;router.push({pathname:'/reports/aliased-web',query:payload});route(('/checks/optional-web/:id?'));const restRegistry={query:{path:'/download/rest-web-query',component:Preview},route:{path:'/checks/rest-web',component:View}};const {route:excluded,...restPayload}=restRegistry;router.push({pathname:'/reports/aliased-web',query:restPayload});const fallback={path:'/checks/inactive-default-web',component:View};const {query:actualQuery=fallback}={query:{ok:1}};router.push({pathname:'/reports/aliased-web',query:actualQuery});const cache=[];cache.push('/checks/array-data-web');text.replace('/checks/string-data-web','');const inactiveBranch={path:'/checks/inactive-branch-web',component:View};router.push({pathname:'/reports/aliased-web',query:true?{}:inactiveBranch});const overwritten={path:'/checks/overwritten-web',component:View};router.push({pathname:'/reports/aliased-web',query:{item:overwritten,item:0}});const memberRegistry={query:{path:'/download/member-query-web',component:Preview},route:{path:'/checks/member-web',component:View}};router.push({pathname:'/reports/aliased-web',query:memberRegistry.query});const protoPayload={path:'/download/proto-query-web',component:Preview};router.push({pathname:'/reports/aliased-web',query:{['__proto__']:protoPayload,__proto__:null}});const replacedRegistry={query:independent};replacedRegistry.query={ok:1};router.push({pathname:'/reports/aliased-web',query:replacedRegistry.query});let replacedDirect=independent;replacedDirect={ok:1};router.push({pathname:'/reports/aliased-web',query:replacedDirect});const uncertainPayload={path:'/download/uncertain-query-web',component:Preview};const uncertainRegistry={query:uncertainPayload};const otherRegistry={query:{ok:1}};const uncertainAlias=flag?uncertainRegistry:otherRegistry;uncertainAlias.query={ok:1};router.push({pathname:'/reports/aliased-web',query:uncertainRegistry.query});const possiblePayload={path:'/download/possible-query-web',component:Preview};const possibleRegistry={query:possiblePayload,...unknown};router.push({pathname:'/reports/aliased-web',query:possibleRegistry.query});const cyclicRegistry={get a(){return this.a.b}};router.push({pathname:'/reports/aliased-web',query:cyclicRegistry.a});const finiteRegistry={get a(){return this},get b(){return this.a.a},path:'/download/finite-query-web',component:Preview};router.push({pathname:'/reports/aliased-web',query:finiteRegistry.a.b});const configurationRegistry={children:[{path:'/checks/config-sibling-web',component:View}],routes:[]};createBrowserRouter(configurationRegistry.routes);`,
            }
          : undefined,
    });
    try {
      const view = {
        kind: "javascript-routes",
        collection: "routes",
        where: {
          paths: [
            "/reports/settings",
            "/reports/panel",
            "/reports/aliased-web",
            "/checks/independent-web",
            "/download/web-data",
            "/web-query-data",
            "/web-fake",
            "/checks/projected-web",
            "/checks/optional-web/:id?",
            "/checks/optional-web/:id",
            "/download/projected-web-query",
            "/checks/rest-web",
            "/download/rest-web-query",
            "/checks/inactive-default-web",
            "/checks/array-data-web",
            "/checks/string-data-web",
            "/checks/inactive-branch-web",
            "/checks/overwritten-web",
            "/checks/member-web",
            "/checks/config-sibling-web",
            "/download/member-query-web",
            "/download/proto-query-web",
            "/download/uncertain-query-web",
            "/download/possible-query-web",
            "/download/finite-query-web",
          ],
        },
      };
      const output = join(
        await createTestTempDirectory("rea-browser-route-evidence-"),
        "routes.json",
      );
      const response = await cli.run({
        arguments: [
          "analyze-web-bundle",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--detail",
          "summary",
          "--view",
          JSON.stringify(view),
          "--evidence_output",
          output,
          "--json",
        ],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      const envelope = response.json as { summary: unknown };
      const selected = routeViewFromEvidence(envelope.summary);
      expect(selected.items).toHaveLength(12);
      expect(selected.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/reports/aliased-web" }),
          expect.objectContaining({ path: "/checks/independent-web" }),
          expect.objectContaining({ path: "/checks/projected-web" }),
          expect.objectContaining({ path: "/checks/rest-web" }),
          expect.objectContaining({ path: "/checks/inactive-default-web" }),
          expect.objectContaining({ path: "/checks/inactive-branch-web" }),
          expect.objectContaining({ path: "/checks/overwritten-web" }),
          expect.objectContaining({ path: "/checks/member-web" }),
          expect.objectContaining({ path: "/checks/config-sibling-web" }),
          expect.objectContaining({ path: "/checks/optional-web/:id?" }),
        ]),
      );
      expect(selected.artifact).toBeNull();
      const { call } = await connectLocalToolsMcp();
      const observed = await call("analyze_web_bundle", {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 0,
        detail: "summary",
        view,
      });
      expect(observed.isError).not.toBe(true);
      const result = routeViewFromEvidence(observed.structuredContent);
      expect(result.items).toHaveLength(12);
      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/reports/aliased-web" }),
          expect.objectContaining({ path: "/checks/independent-web" }),
          expect.objectContaining({ path: "/checks/projected-web" }),
          expect.objectContaining({ path: "/checks/rest-web" }),
          expect.objectContaining({ path: "/checks/inactive-default-web" }),
          expect.objectContaining({ path: "/checks/inactive-branch-web" }),
          expect.objectContaining({ path: "/checks/overwritten-web" }),
          expect.objectContaining({ path: "/checks/member-web" }),
          expect.objectContaining({ path: "/checks/config-sibling-web" }),
          expect.objectContaining({ path: "/checks/optional-web/:id?" }),
        ]),
      );
      const retained = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: result.parent_evidence_id,
        },
        view: { kind: "javascript-routes", collection: "sources" },
      });
      expect(retained.isError).not.toBe(true);
      expect(
        routeViewFromEvidence(retained.structuredContent).items.length,
      ).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  },
  120000,
);

it("keeps a large source's partial route facts queryable through SDK delivery", async () => {
  const path = await createTestTempDirectory("rea-large-route-result-");
  const text = Array.from(
    { length: 12000 },
    (_, index) => `route('/reports/${index}/${"x".repeat(96)}');`,
  ).join("\n");
  await writeFile(join(path, "routes.js"), text);
  const { call } = await connectLocalToolsMcp({
    NODE_OPTIONS: "--max-old-space-size=3072",
  });
  const response = await call("analyze_javascript_application", {
    input_path: path,
    max_semantic_nodes: 1,
    max_semantic_unknowns: 8,
    max_heap_mb: 512,
    analysis_timeout_ms: 30000,
    detail: "summary",
    view: {
      kind: "javascript-routes",
      collection: "routes",
      fields: ["path"],
      limit: 2,
    },
  });
  expect(response.isError).not.toBe(true);
  const selected = routeViewFromEvidence(response.structuredContent);
  expect(selected.items).toHaveLength(2);
  expect(selected.source_coverage.candidate_enumeration).toBe("partial");
  expect(selected.sources[0]).toMatchObject({
    status: "complete",
    sha256: createHash("sha256").update(text).digest("hex"),
    reported_route_capacity: { kind: "result-bytes" },
  });
  expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThanOrEqual(
    1024 * 1024,
  );
  const unknowns = await call("inspect_analysis_view", {
    source: {
      kind: "retained-evidence",
      evidence_id: selected.parent_evidence_id,
    },
    view: {
      kind: "javascript-routes",
      collection: "unknowns",
      where: { kinds: ["capacity"] },
      fields: ["reason"],
    },
  });
  expect(unknowns.isError).not.toBe(true);
  expect(
    routeViewFromEvidence(unknowns.structuredContent).items.length,
  ).toBeGreaterThan(0);
}, 60000);
