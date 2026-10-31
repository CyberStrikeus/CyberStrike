import { expect } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { applicationFeatureTraceResultSchema } from "../../../src/domain/javascript/javascriptFeatureTraceSchemas.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import {
  analysisViewResultSchema,
  javascriptApplicationSummaryViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";

const sourcePositionSchema = z.object({ line: z.number(), column: z.number() });
const callPathConditionSchema = z.object({
  expression: z.string(),
  location: z.object({
    start: sourcePositionSchema,
    end: sourcePositionSchema,
  }),
});
const callPathTerminalObservationSchema = z.object({
  properties: z.object({ conditions: z.array(callPathConditionSchema) }),
  evidence: z.object({ coverage: z.object({ status: z.string() }) }),
});

const restArrayPropertyCases = [
  {
    name: "leading-zero index",
    expression: 'items["01"] ?? "FALLBACK"',
    parameters: "",
    channel: null,
  },
  {
    name: "double-zero key",
    expression: 'items["00"] ?? "FALLBACK"',
    parameters: "",
    channel: null,
  },
  {
    name: "decimal-form key",
    expression: 'items["1.0"] ?? "FALLBACK"',
    parameters: "",
    channel: null,
  },
  {
    name: "canonical index",
    expression: 'items["1"] ?? "FALLBACK"',
    parameters: "",
    channel: "SECOND",
  },
  {
    name: "literal fallback",
    expression: '"FALLBACK"',
    parameters: "",
    channel: "FALLBACK",
  },
  {
    name: "dynamic key",
    expression: 'items[key] ?? "FALLBACK"',
    parameters: "key",
    channel: null,
  },
] as const;

for (const fixture of restArrayPropertyCases)
  cliTest(
    `preserves rest-array property identity for ${fixture.name} through the public CLI`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-electron-rest-key-");
      await writeFixtureFiles(root, {
        "main.cjs": `const e = require("electron");
          function make(...items) {
            return (${fixture.parameters}) => e.ipcRenderer.send(${fixture.expression});
          }
          e.contextBridge.exposeInMainWorld("desktop", { read: make("FIRST", "SECOND") });`,
      });
      const application = await analyzeJavaScriptDirectory("CLI", cli, root);
      expect(application.statistics).toMatchObject({
        parsed_javascript_files: 1,
        parse_failures: 0,
      });
      const observations = application.graph.nodes.flatMap(
        (node) => node.observations,
      );
      const terminals = observations.filter(
        (observation) =>
          observation.properties.entry === "desktop.read" &&
          observation.properties.step_kind === "terminal",
      );
      const channels = application.graph.nodes
        .filter((node) => node.kind === "ipc-channel")
        .flatMap((node) => node.observations);
      expect(
        terminals.map((observation) => observation.properties.channel),
      ).toEqual(fixture.channel === null ? [] : [fixture.channel]);
      expect(
        channels
          .filter(
            (observation) => observation.properties.resolution === "literal",
          )
          .map((observation) => observation.properties.channel),
      ).toEqual(fixture.channel === null ? [] : [fixture.channel]);
      for (const terminal of terminals)
        expect(terminal).toMatchObject({
          properties: { resolution: "candidate" },
          evidence: {
            state: "inferred",
            authority: "static-relationship-inference",
          },
        });
      if (fixture.expression !== '"FALLBACK"')
        expect(channels).toContainEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              channel: null,
              resolution: "dynamic",
              channel_expression: fixture.expression,
            }),
            evidence: expect.objectContaining({ state: "observed" }),
          }),
        );
    },
  );

const analyze = async (cli: TestCli, extra = "") => {
  const root = await createTestTempDirectory("rea-electron-wrapped-paths-");
  await writeFixtureFiles(root, {
    "preload.js": `const e=require("electron");
      const sender=channel=>(...args)=>e.ipcRenderer.send(channel,...args);
      e.contextBridge.exposeInMainWorld("desktop",{copy:sender("test:copy"),cut:sender("test:cut")});`,
    "main.js": `const e=require("electron");
      function register(channel,handler){e.ipcMain.addListener(channel,event=>allowed(event)&&handler(event))}
      register("test:copy",event=>event.sender.copy());
      register("test:cut",event=>event.sender.cut());${extra}`,
  });
  const output = await cli.run({
    arguments: ["analyze-javascript-application", root, "--json"],
  });
  expect(output.exitCode, output.stderr).toBe(0);
  const { normalized_result: result } = z
    .object({
      normalized_result: javascriptApplicationAnalysisResultSchema,
    })
    .parse(output.json);
  return { root, application: output.json, ...result };
};

cliTest(
  "traces a wrapped bridge member through a unique IPC channel using the public CLI",
  async ({ cli }) => {
    const { root, application, graph } = await analyze(cli);
    const byId = new Map(graph.nodes.map((n) => [n.node_id, n]));
    const joins = graph.edges.filter(
      (e) => e.evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(joins).toHaveLength(2);
    for (const edge of joins) {
      expect(edge.evidence).toMatchObject({
        state: "inferred",
        authority: "static-relationship-inference",
      });
      expect(edge.properties.pairing_basis).toBe(
        "unique-exact-literal-channel",
      );
      expect(
        byId.get(edge.source_node_id)?.observations[0]?.properties.channel,
      ).toBe(edge.properties.channel);
      expect(
        byId.get(edge.target_node_id)?.observations[0]?.properties.channel,
      ).toBe(edge.properties.channel);
      expect(edge.properties.bridge_conditions).toEqual([]);
      expect(edge.properties.handler_conditions).toEqual([
        expect.objectContaining({ expression: "allowed(event)" }),
      ]);
    }
    const start = graph.nodes.find((n) =>
      n.observations.some(
        (o) =>
          o.properties.entry === "desktop.copy" &&
          o.properties.step_kind === "exposure",
      ),
    );
    expect(start).toBeDefined();
    const visited = new Set<string>(),
      pending = start ? [start.node_id] : [];
    while (pending.length) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      for (const edge of graph.edges)
        if (edge.source_node_id === id) pending.push(edge.target_node_id);
    }
    expect(
      [...visited].some((id) =>
        byId
          .get(id)
          ?.observations.some((o) => o.label === "ipc-event.sender.copy"),
      ),
    ).toBe(true);
    expect(
      [...visited].some((id) =>
        byId
          .get(id)
          ?.observations.some((o) => o.label === "ipc-event.sender.cut"),
      ),
    ).toBe(false);
    const input = join(root, "trace-input.json");
    await writeFile(
      input,
      JSON.stringify({
        application,
        seed: { kind: "api", value: "desktop.copy", match: "exact" },
        direction: "outgoing",
      }),
    );
    const traced = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
    });
    expect(traced.exitCode).toBe(0);
    const { normalized_result: trace } = z
      .object({
        normalized_result: applicationFeatureTraceResultSchema,
      })
      .parse(traced.json);
    expect(trace.seed_matches).toHaveLength(1);
    expect(
      trace.paths.some(
        (path) =>
          path.contains_inference &&
          path.node_ids.length > 8 &&
          byId
            .get(path.end_node_id)
            ?.observations.some((o) => o.label === "ipc-event.sender.copy"),
      ),
    ).toBe(true);
  },
);

const fallthroughCases = [
  {
    name: "conditional early return",
    body: 'if(x)return;e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: ["!(x)"],
    coverage: "partial",
  },
  {
    name: "equivalent nested branch",
    body: 'if(!x){e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: ["!x"],
    coverage: "partial",
  },
  {
    name: "conditional break to enclosing label",
    body: 'guard:{if(!x)break guard;e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: ["!(!x)"],
    coverage: "partial",
  },
  {
    name: "nested label breaking enclosing label",
    body: 'guard:{if(!x)inner:{break guard;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: ["!(!x)"],
    coverage: "partial",
  },
  {
    name: "nested label breaking itself",
    body: 'guard:{if(!x)inner:{break inner;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "inner break skips unreachable throw",
    body: 'guard:{if(x)inner:{break inner;throw 0;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "loop may break inner label before throw",
    body: 'guard:{if(x)inner:{while(true){break inner;}throw 0;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "try may break inner label before throw",
    body: 'guard:{if(x)inner:{try{break inner;}finally{}throw 0;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "ordinary loop before return retains guard",
    body: 'if(x){while(false){}return;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: ["!(x)"],
    coverage: "partial",
  },
  {
    name: "true guard and ordinary loop before return",
    body: 'if(true){while(false){}return;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "ordinary loop before throw retains guard",
    body: 'if(x){for(const item of [])cleanup(item);throw 0;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: ["!(x)"],
    coverage: "partial",
  },
  {
    name: "loop local label cannot skip return",
    body: 'if(x){while(false){local:{break local;}}return;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: ["!(x)"],
    coverage: "partial",
  },
  {
    name: "break to inner label does not guard outer continuation",
    body: 'outer:{inner:{if(x)break inner;}e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});}',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "definite early return",
    body: 'return;e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: [],
    coverage: "complete",
  },
  {
    name: "unguarded exposure",
    body: 'e.contextBridge.exposeInMainWorld("api",{copy:()=>e.ipcRenderer.send("x")});',
    conditions: [],
    coverage: "complete",
  },
] as const;

cliTest(
  "preserves early-return predicates on recovered bridge paths through CLI and stdio MCP",
  async ({ cli }) => {
    for (const surface of ["CLI", "stdio MCP"] as const) {
      const connection =
        surface === "stdio MCP" ? await connectLocalToolsMcp() : undefined;
      const artifacts = new Set<string>();
      for (const fixture of fallthroughCases) {
        const root = await createTestTempDirectory(
          "rea-electron-early-return-",
        );
        await writeFixtureFiles(root, {
          "index.js": `const e=require("electron");function f(x){${fixture.body}}f(globalThis.blocked);`,
        });
        const application = await analyzeJavaScriptDirectory(
          surface,
          cli,
          root,
          { mcpCall: connection?.call },
        );
        expect(application.input_path).toBe(root);
        expect(artifacts.has(application.root_artifact_sha256)).toBe(false);
        artifacts.add(application.root_artifact_sha256);
        const observations = application.graph.nodes.flatMap(
          (node) => node.observations,
        );
        const terminal = observations.find(
          (observation) =>
            observation.properties.entry === "api.copy" &&
            observation.properties.step_kind === "terminal",
        );
        if (
          fixture.name === "definite early return" ||
          fixture.name === "true guard and ordinary loop before return"
        ) {
          expect(terminal).toBeUndefined();
          continue;
        }
        const terminalEvidence =
          callPathTerminalObservationSchema.parse(terminal);
        expect(
          terminalEvidence.properties.conditions.map(
            ({ expression }) => expression,
          ),
        ).toEqual(fixture.conditions);
        if (fixture.name === "conditional break to enclosing label") {
          const edges = application.graph.edges.filter(
            (edge) =>
              edge.evidence.extractor.operation ===
              "trace-electron-wrapper-path",
          );
          expect(edges.length).toBeGreaterThan(0);
          for (const edge of edges) {
            const conditions = z
              .array(callPathConditionSchema)
              .parse(edge.properties.conditions);
            expect(conditions.map(({ expression }) => expression)).toEqual(
              fixture.conditions,
            );
          }
        }
        expect(terminalEvidence.evidence.coverage.status).toBe(
          fixture.coverage,
        );
        expect(application.graph.coverage.status).toBe(fixture.coverage);
        const source = observations.find(
          (observation) => observation.properties.file_kind === "javascript",
        );
        expect(source?.properties.parse_status).toBe(fixture.coverage);
      }
    }
  },
);

cliTest(
  "traces a nested contextBridge member through a unique IPC channel",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-nested-bridge-");
    await writeFixtureFiles(root, {
      "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
        contextBridge.exposeInMainWorld("api", {
          nested: { write: (value) => ipcRenderer.invoke("nested:write", value) }
        });`,
      "main.js": `const { ipcMain, clipboard } = require("electron");
        ipcMain.handle("nested:write", (event, value) => clipboard.writeText(value));`,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const { graph } = application;
    const paths = graph.nodes
      .flatMap((node) => node.observations)
      .filter(
        (observation) =>
          observation.properties.entry === "api.nested.write" &&
          observation.properties.entry_kind === "bridge-member",
      );
    expect(
      paths.some(
        (observation) => observation.properties.step_kind === "exposure",
      ),
    ).toBe(true);
    expect(
      paths.some(
        (observation) => observation.properties.step_kind === "terminal",
      ),
    ).toBe(true);
    const joins = graph.edges.filter(
      (edge) =>
        edge.evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(joins.map((edge) => edge.properties.channel)).toEqual([
      "nested:write",
    ]);

    const traceInput = join(root, "trace-nested-input.json");
    await writeFile(
      traceInput,
      JSON.stringify({
        application: output.json,
        seed: { kind: "api", value: "api.nested.write", match: "exact" },
        direction: "outgoing",
      }),
    );
    const traced = await cli.run({
      arguments: ["trace-application-feature", traceInput, "--json"],
    });
    expect(traced.exitCode).toBe(0);
    const { normalized_result: trace } = z
      .object({ normalized_result: applicationFeatureTraceResultSchema })
      .parse(traced.json);
    expect(trace.seed_matches).toHaveLength(1);
    expect(trace.paths.some((path) => path.contains_inference)).toBe(true);
  },
);

cliTest(
  "preserves exact bridge member segments through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-bridge-segments-");
    await writeFixtureFiles(root, {
      "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
        const write = () => ipcRenderer.send("write");
        contextBridge.exposeInMainWorld("desktop", {
          "nested.write": write,
          nested: { write },
          __proto__: { inherited: write },
          ["__proto__"]: { own: write },
        });`,
      "main.js": `const { ipcMain } = require("electron");
        ipcMain.on("write", (event) => event.sender.copy());`,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const observations = application.graph.nodes.flatMap((node) =>
      node.observations.filter(
        (observation) =>
          observation.properties.entry_kind === "bridge-member" &&
          observation.properties.step_kind === "exposure",
      ),
    );
    const bridge = application.graph.nodes
      .filter((node) => node.kind === "context-bridge-api")
      .flatMap((node) => node.observations)
      .find((observation) => observation.properties.api_key === "desktop");
    expect(bridge?.properties.members).not.toContain("__proto__.inherited");
    expect(bridge?.properties.members).toContain("__proto__.own");
    const paths = observations.map(
      (observation) => observation.properties.entry_path,
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        ["desktop", "nested.write"],
        ["desktop", "nested", "write"],
        ["desktop", "__proto__", "own"],
      ]),
    );
    expect(paths).not.toContainEqual(["desktop", "__proto__", "inherited"]);
    const handlerPaths = application.graph.nodes
      .flatMap((node) => node.observations)
      .filter(
        (observation) => observation.properties.entry_kind === "ipc-handler",
      );
    expect(handlerPaths.length).toBeGreaterThan(0);
    expect(
      handlerPaths.every(
        (observation) => !("entry_path" in observation.properties),
      ),
    ).toBe(true);
  },
);

cliTest(
  "retains a nested bridge path when its IPC handler has no external terminal",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-nested-return-");
    await writeFixtureFiles(root, {
      "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
        contextBridge.exposeInMainWorld("api", {
          nested: { write: (value) => ipcRenderer.invoke("nested:write", value) }
        });`,
      "main.js": `const { ipcMain } = require("electron");
        ipcMain.handle("nested:write", (event, value) => value);`,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const { graph } = application;
    expect(
      graph.nodes.some((node) =>
        node.observations.some(
          (observation) =>
            observation.properties.entry === "api.nested.write" &&
            observation.properties.step_kind === "exposure",
        ),
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.evidence.extractor.operation === "join-electron-wrapper-paths",
      ),
    ).toBe(false);

    const traceInput = join(root, "trace-nested-input.json");
    await writeFile(
      traceInput,
      JSON.stringify({
        application: output.json,
        seed: { kind: "api", value: "api.nested.write", match: "exact" },
        direction: "outgoing",
      }),
    );
    const traced = await cli.run({
      arguments: ["trace-application-feature", traceInput, "--json"],
    });
    expect(traced.exitCode).toBe(0);
    const { normalized_result: trace } = z
      .object({ normalized_result: applicationFeatureTraceResultSchema })
      .parse(traced.json);
    expect(trace.seed_matches).toHaveLength(1);
    expect(trace.graph?.nodes.length).toBeGreaterThan(1);
  },
);

for (const surface of ["CLI", "stdio MCP"] as const) {
  cliTest(
    `retains explicit nested contextBridge members after an unknown spread through ${surface}`,
    async ({ cli }) => {
      const connection =
        surface === "stdio MCP" ? await connectLocalToolsMcp() : undefined;
      const analyzeBridge = async (api: string) => {
        const root = await createTestTempDirectory(
          "rea-electron-spread-bridge-members-",
        );
        await writeFixtureFiles(root, {
          "preload.js": `const { contextBridge } = require("electron");
            const extra = getExtra();
            contextBridge.exposeInMainWorld("api", ${api});`,
        });
        const application = await analyzeJavaScriptDirectory(
          surface,
          cli,
          root,
          { mcpCall: connection?.call },
        );
        expect(application.input_path).toBe(root);
        return application;
      };
      const withSpread = await analyzeBridge("{ ...extra, a: { b: 1 }, c: 2 }");
      const control = await analyzeBridge("{ a: { b: 1 }, c: 2 }");
      expect(control.root_artifact_sha256).not.toBe(
        withSpread.root_artifact_sha256,
      );

      const bridgeObservation = (application: typeof withSpread) =>
        application.graph.nodes
          .filter((node) => node.kind === "context-bridge-api")
          .flatMap((node) => node.observations)
          .find((observation) => observation.properties.api_key === "api");
      expect(bridgeObservation(withSpread)).toMatchObject({
        properties: {
          api_status: "dynamic",
          members: ["a", "a.b", "c"],
          unknown_members: 1,
        },
      });
      expect(bridgeObservation(control)).toMatchObject({
        properties: {
          api_status: "object-literal",
          members: ["a", "a.b", "c"],
          unknown_members: 0,
        },
      });
      expect(withSpread.summary.exposed_api_members).toBe(3);
      expect(control.summary.exposed_api_members).toBe(3);
    },
  );

  cliTest(
    `binds each contextBridge helper invocation's own key and members through ${surface}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-electron-bridge-helper-calls-",
      );
      await writeFixtureFiles(root, {
        "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
          function expose(key, api) { contextBridge.exposeInMainWorld(key, api); }
          function relay(key, label, api) { expose(key, api); }
          function named(label, key) { expose(key, { hidden: () => ipcRenderer.send("hidden") }); }
          expose("one", { ping: () => ipcRenderer.send("one:ping") });
          expose("two", { nested: { pong: () => ipcRenderer.send("two:pong") } });
          relay("three", "label", { pang: () => ipcRenderer.send("three:pang") });
          contextBridge.exposeInMainWorld("direct", { d: () => ipcRenderer.send("direct:d") });
          named("label", globalThis.bridgeName);`,
      });
      const application = await analyzeJavaScriptDirectory(surface, cli, root);
      const bridges = application.graph.nodes
        .filter((node) => node.kind === "context-bridge-api")
        .flatMap((node) => node.observations)
        .map(({ properties }) => ({
          api_key: properties.api_key,
          api_key_expression: properties.api_key_expression,
          members: properties.members,
          unknown_members: properties.unknown_members,
          resolution_basis: properties.resolution_basis,
        }));
      expect(bridges).toHaveLength(5);
      expect(bridges).toEqual(
        expect.arrayContaining([
          {
            api_key: "one",
            api_key_expression: null,
            members: ["ping"],
            unknown_members: 0,
            resolution_basis: "wrapper-substitution",
          },
          {
            api_key: "two",
            api_key_expression: null,
            members: ["nested", "nested.pong"],
            unknown_members: 0,
            resolution_basis: "wrapper-substitution",
          },
          {
            api_key: "three",
            api_key_expression: null,
            members: ["pang"],
            unknown_members: 0,
            resolution_basis: "wrapper-substitution",
          },
          {
            api_key: "direct",
            api_key_expression: null,
            members: ["d"],
            unknown_members: 0,
            resolution_basis: "direct-syntax",
          },
          // The traced invocation with an unresolved key stays unknown rather
          // than lending its members to a resolved key.
          {
            api_key: null,
            api_key_expression: "key",
            members: [],
            unknown_members: 1,
            resolution_basis: "direct-syntax",
          },
        ]),
      );
      expect(application.summary.context_bridge_apis).toBe(5);
      expect(application.summary.exposed_api_members).toBe(5);
      const exposureEntries = new Set(
        application.graph.nodes
          .flatMap((node) => node.observations)
          .filter(({ properties }) => properties.step_kind === "exposure")
          .map(({ properties }) => properties.entry),
      );
      expect(exposureEntries).toEqual(
        new Set(["one.ping", "two.nested.pong", "three.pang", "direct.d"]),
      );
    },
  );

  cliTest(
    `preserves handler ambiguity and short-circuit factory paths through ${surface}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-electron-branch-paths-");
      await writeFixtureFiles(root, {
        "preload.js": `const e=require("electron");
        e.contextBridge.exposeInMainWorld("empty", {});
        function choose(){
          if(flag)return ()=>e.ipcRenderer.send("test:copy");
          else return ()=>e.ipcRenderer.send("test:cut");
          return ()=>e.ipcRenderer.send("test:dead");
        }
        e.contextBridge.exposeInMainWorld("desktop", {
          choose:choose(),
          ambiguous:()=>e.ipcRenderer.send("test:ambiguous"),
          competing:()=>e.ipcRenderer.send("test:competing"),
          conditional:()=>e.ipcRenderer.send("test:conditional"),
          fallback:()=>e.ipcRenderer.send("test:fallback"),
        });`,
        "main.js": `const e=require("electron");
        const copy=event=>event.sender.copy(), cut=event=>event.sender.cut();
        function register(channel,handler){e.ipcMain.on(channel,handler)}
        register("test:copy",copy);register("test:cut",cut);
        register("test:ambiguous",flag?copy:cut);
        register("test:competing",copy);
        register("test:competing",flag?copy:unknownHandler);
        if(flag) register("test:conditional",copy);
        register("test:fallback",event=>{false ?? event.sender.copy()});`,
      });
      const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
      const empty = graph.nodes
        .filter((node) => node.kind === "context-bridge-api")
        .flatMap((node) => node.observations)
        .find((observation) => observation.properties.api_key === "empty");
      expect(empty).toMatchObject({
        properties: {
          api_status: "object-literal",
          members: [],
          unknown_members: 0,
          resolution_basis: "direct-syntax",
        },
        evidence: { state: "observed" },
      });
      const joins = graph.edges.filter(
        (edge) =>
          edge.evidence.extractor.operation === "join-electron-wrapper-paths",
      );
      expect(joins.map((edge) => edge.properties.channel).sort()).toEqual([
        "test:copy",
        "test:cut",
      ]);
      const steps = graph.nodes
        .flatMap((node) => node.observations)
        .filter(
          (observation) => observation.properties.step_kind === "terminal",
        );
      expect(
        [
          ...new Set(
            steps
              .filter((step) => step.properties.entry === "desktop.choose")
              .map((step) => step.properties.channel),
          ),
        ].sort(),
      ).toEqual(["test:copy", "test:cut"]);
      for (const [channel, expression] of [
        ["test:copy", "flag"],
        ["test:cut", "!(flag)"],
      ])
        expect(
          steps.find(
            (step) =>
              step.properties.entry === "desktop.choose" &&
              step.properties.channel === channel,
          )?.properties.conditions,
        ).toEqual([expect.objectContaining({ expression })]);
      expect(
        steps.some(
          (step) =>
            step.properties.entry_kind === "ipc-handler" &&
            ["test:ambiguous", "test:fallback"].includes(
              String(step.properties.channel),
            ),
        ),
      ).toBe(false);
    },
  );
}

cliTest(
  "does not join a channel with another untraced compatible handler",
  async ({ cli }) => {
    const { graph } = await analyze(
      cli,
      'e.ipcMain.on("test:copy",event=>unresolved(event));',
    );
    const joins = graph.edges.filter(
      (e) => e.evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(joins.map((e) => e.properties.channel)).toEqual(["test:cut"]);
  },
);

cliTest(
  "keeps shallow bridge members when a sibling exceeds the nesting limit",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-deep-bridge-");
    let deepMember = '() => e.ipcRenderer.send("deep:run")';
    for (let index = 0; index < 129; index += 1)
      deepMember = `{ level${index}: ${deepMember} }`;
    await writeFixtureFiles(root, {
      "preload.js": `const e=require("electron");
        e.contextBridge.exposeInMainWorld("desktop", {
          deep: ${deepMember},
          shallow: () => e.ipcRenderer.send("shallow:run")
        });`,
      "main.js": `const e=require("electron");
        e.ipcMain.on("shallow:run", event => event.sender.copy());
        e.ipcMain.on("deep:run", event => event.sender.copy());`,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const { graph } = application;
    const joins = graph.edges.filter(
      (edge) =>
        edge.evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(joins.map((edge) => edge.properties.channel)).toEqual([
      "shallow:run",
    ]);
    expect(joins[0]?.properties).toMatchObject({
      pairing_basis: "observed-literal-channel-incomplete-coverage",
      resolution: "candidate",
    });
    expect(application.summary.ipc).toMatchObject({
      paired_renderer_transmissions: 0,
    });
    expect(
      application.summary.ipc.ambiguous_renderer_transmissions,
    ).toBeGreaterThan(0);
    expect(
      graph.nodes
        .flatMap((node) => node.observations)
        .some(
          (observation) =>
            observation.properties.entry === "desktop.shallow" &&
            observation.properties.step_kind === "exposure",
        ),
    ).toBe(true);
  },
);

cliTest(
  "keeps a wrapper match provisional when a limited path can hide a competing handler",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-limited-handler-");
    let deepMember =
      '() => { const register = (ipc) => ipc.on("shared:run", () => {}); register(e.ipcMain); }';
    for (let index = 0; index < 129; index += 1)
      deepMember = `{ level${index}: ${deepMember} }`;
    await writeFixtureFiles(root, {
      "preload.js": `const e=require("electron");
        e.contextBridge.exposeInMainWorld("desktop", {
          deep: ${deepMember},
          shallow: () => e.ipcRenderer.send("shared:run")
        });`,
      "main.js": `const e=require("electron");
        e.ipcMain.on("shared:run", event => event.sender.copy());`,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    expect(application.summary.ipc.paired_renderer_transmissions).toBe(0);
    expect(
      application.summary.ipc.ambiguous_renderer_transmissions,
    ).toBeGreaterThan(0);
    const channelEdges = application.graph.edges.filter(
      (edge) => edge.properties.channel === "shared:run",
    );
    expect(
      channelEdges.some(
        (edge) =>
          edge.evidence.extractor.operation === "pair-ipc-literal-channel",
      ),
    ).toBe(false);
    const candidateJoin = channelEdges.find(
      (edge) =>
        edge.evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(candidateJoin?.properties).toMatchObject({
      pairing_basis: "observed-literal-channel-incomplete-coverage",
      resolution: "candidate",
    });
    expect(candidateJoin?.evidence.limitations?.length).toBeGreaterThan(0);

    // A known second handler is not merely a hidden-coverage uncertainty.
    await writeFile(
      join(root, "main.js"),
      'const e=require("electron"); e.ipcMain.on("shared:run", () => {}); e.ipcMain.on("shared:run", () => {});',
    );
    const competing = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(competing.exitCode, competing.stderr).toBe(0);
    const { normalized_result: competingApplication } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(competing.json);
    expect(
      competingApplication.graph.edges.some(
        (edge) =>
          edge.evidence.extractor.operation === "join-electron-wrapper-paths" &&
          edge.properties.channel === "shared:run",
      ),
    ).toBe(false);
  },
);

cliTest(
  "preserves empty bridge member segments in nested paths",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-electron-empty-bridge-key-",
    );
    await writeFixtureFiles(root, {
      "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
        contextBridge.exposeInMainWorld("desktop", {
          "": { nested: { call: () => ipcRenderer.send("empty:key") } }
        });`,
      "main.js": `const { ipcMain } = require("electron");
        ipcMain.on("empty:key", event => event.sender.copy());`,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const observations = application.graph.nodes.flatMap(
      (node) => node.observations,
    );
    expect(
      observations.some(
        (observation) =>
          observation.properties.entry === "desktop..nested.call" &&
          observation.properties.step_kind === "exposure",
      ),
    ).toBe(true);
    expect(
      application.graph.edges
        .filter(
          (edge) =>
            edge.evidence.extractor.operation === "join-electron-wrapper-paths",
        )
        .map((edge) => edge.properties.channel),
    ).toEqual(["empty:key"]);
  },
);

cliTest(
  "retains bridge and handler conditions on Electron IPC join edges",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-join-conditions-");
    await writeFixtureFiles(root, {
      "preload.js": `const e=require("electron");
        e.contextBridge.exposeInMainWorld("desktop", {
          choose: flag
            ? () => e.ipcRenderer.send("test:copy")
            : () => e.ipcRenderer.send("test:cut")
        });`,
      "main.js": `const e=require("electron");
        if(!flag)e.ipcMain.on("test:copy",event=>allowed(event)&&event.sender.copy());
        if(flag)e.ipcMain.on("test:cut",event=>allowed(event)&&event.sender.cut());`,
    });
    const { graph } = await analyzeJavaScriptDirectory("CLI", cli, root);
    const joins = graph.edges.filter(
      (edge) =>
        edge.evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(joins).toHaveLength(2);
    for (const [channel, bridgeCondition] of [
      ["test:copy", "flag"],
      ["test:cut", "!(flag)"],
    ]) {
      const edge = joins.find(
        (candidate) => candidate.properties.channel === channel,
      );
      expect(edge?.properties.bridge_conditions).toEqual([
        expect.objectContaining({ expression: bridgeCondition }),
      ]);
      expect(edge?.properties.handler_conditions).toEqual([
        expect.objectContaining({
          expression: channel === "test:copy" ? "!flag" : "flag",
        }),
        expect.objectContaining({ expression: "allowed(event)" }),
      ]);
    }
  },
);

const descriptorSender = `function(channel) { return (...args) => send(channel, ...args); }`;
const descriptorNoop = `function() { return () => {}; }`;
const descriptorCases: readonly (readonly [
  string,
  string,
  boolean,
  boolean?,
  boolean?,
])[] = [
  ["control", `{value:${descriptorSender}}`, true],
  ["accessor-noop", `{get:function(){return ${descriptorNoop}}}`, false],
  ["mixed-getter", `{get:()=>0,...{value:${descriptorSender}}}`, false, true],
  ["mixed-setter", `{value:${descriptorSender},...{set:()=>{}}}`, false, true],
  ["string-spread", `{value:${descriptorSender},..."x"}`, true],
  ["negative-number", `{value:${descriptorSender},...-1}`, true],
  ["negative-bigint", `{value:${descriptorSender},...-1n}`, true],
  [
    "method-value",
    "{value" + descriptorSender.slice("function".length) + "}",
    true,
  ],
  ["patch-after-sender", `{value:${descriptorSender}}`, true, false, false],
  ["negative-prototype", `{__proto__:-1,value:${descriptorSender}}`, true],
  ["bigint-prototype", `{__proto__:-1n,value:${descriptorSender}}`, true],
  ["successive-noops", `{enumerable:true}`, true],
  ["literal-noop", `{enumerable:true}`, true],
  ["replaced-namespace", `{value:${descriptorNoop}}`, false],
  ["namespaced-noop", `{value:${descriptorNoop}}`, true],
  ["patch-after", `{value:${descriptorNoop}}`, false],
  ["outer-patch-after", `{value:${descriptorNoop}}`, false],
  ["mutating-intrinsic", `{value:${descriptorSender}}`, false],
  ["null-prototype", `{__proto__:null,value:${descriptorSender}}`, true],
  ["function-spread", `{value:${descriptorSender},...function(){}}`, true],
  ["regexp-spread", `{value:${descriptorSender},.../x/}`, true],
  ["template-spread", "{value:" + descriptorSender + ",...`x${1}`}", true],
  ["empty-array", `{value:${descriptorSender},...[]}`, true],
  ["array", `{value:${descriptorSender},...[1]}`, true],
  ["patched-intrinsic", `{get:function(){return ${descriptorNoop}}}`, true],
  ["typescript-assertion", `({value:${descriptorSender}} as const)`, true],
  [
    "duplicate-noop",
    `{value:${descriptorSender},value:${descriptorNoop}}`,
    false,
  ],
  [
    "duplicate-sender",
    `{value:${descriptorNoop},value:${descriptorSender}}`,
    true,
  ],
  [
    "spread-sender",
    `{value:${descriptorNoop},...{value:${descriptorSender}}}`,
    true,
  ],
  [
    "spread-noop",
    `{value:${descriptorSender},...{value:${descriptorNoop}}}`,
    false,
  ],
  [
    "computed-sender",
    `{value:${descriptorNoop},["value"]:${descriptorSender}}`,
    true,
  ],
  ["null-spread", `{value:${descriptorSender},...null}`, true],
  ["undefined-spread", `{value:${descriptorSender},...undefined}`, true],
  ["void-spread", `{value:${descriptorSender},...void 0}`, true],
  ["nested-null-spread", `{value:${descriptorSender},...{...null}}`, true],
] as const;

const analyzeDescriptorFacts = async ({
  cli,
  root,
  connection,
}: {
  cli: TestCli;
  root: string;
  connection: Awaited<ReturnType<typeof connectLocalToolsMcp>> | undefined;
}) => {
  type ApplicationResult = z.infer<
    typeof javascriptApplicationAnalysisResultSchema
  >;
  type Observation = Pick<
    ApplicationResult["graph"]["nodes"][number]["observations"][number],
    "properties" | "evidence"
  >;
  let statistics: ApplicationResult["statistics"];
  const observations: Observation[] = [];
  if (connection === undefined) {
    const application = await analyzeJavaScriptDirectory("CLI", cli, root);
    statistics = application.statistics;
    for (const node of application.graph.nodes)
      observations.push(...node.observations);
  } else {
    const response = await connection.call("analyze_javascript_application", {
      input_path: root,
      format: "directory",
      detail: "summary",
    });
    expect(response.isError).not.toBe(true);
    const summary = z
      .object({
        normalized_result: javascriptApplicationSummaryViewResultSchema,
      })
      .parse(response.structuredContent).normalized_result;
    statistics =
      javascriptApplicationAnalysisResultSchema.shape.statistics.parse(
        summary.summary.statistics,
      );
    let offset: number | null = 0;
    while (offset !== null) {
      const response = await connection.call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: {
          kind: "javascript-facts",
          where: { kinds: ["javascript-expression"] },
          property_keys: ["step_kind", "terminal", "channel", "resolution"],
          offset,
          limit: 64,
        },
      });
      expect(response.isError).not.toBe(true);
      const page = z
        .object({ normalized_result: analysisViewResultSchema })
        .parse(response.structuredContent).normalized_result;
      if (page.kind !== "javascript-facts")
        throw new Error("Expected retained JavaScript facts");
      expect(page.parent_evidence_id).toBe(summary.parent_evidence_id);
      observations.push(...page.rows);
      offset = page.coverage.next_offset;
      if (offset === null) {
        expect(page.coverage.exhausted).toBe(true);
        expect(observations).toHaveLength(page.coverage.total);
      }
    }
    await connection.client.ping();
  }
  return { statistics, observations };
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "uses effective defineProperty descriptor values for bundled IPC paths through %s",
  async (surface, { cli }) => {
    const workspace = await createTestTempDirectory("rea-descriptor-values-");
    const root = join(workspace, "路径-'values");
    const files = Object.fromEntries(
      descriptorCases.map(([name, descriptor, sends, throws]) => {
        const source = `(() => {
        const modules = {
          2(module) { module.exports = require("electron"); },
          5(module, exports, load) {
            const electron = load(2);
            ${name === "successive-noops" ? "Object.defineProperty=()=>{};Object.defineProperty=()=>{};" : name === "literal-noop" ? "Object.defineProperty=(_target,_key)=>0;" : name === "replaced-namespace" ? "globalThis={Object:{}};globalThis.Object.defineProperty=()=>{};" : name === "namespaced-noop" ? "globalThis.Object.defineProperty=()=>{};" : name === "patched-intrinsic" ? "Object.defineProperty=()=>{};" : name === "mutating-intrinsic" ? "Object.defineProperty=(target,key)=>{target[key]=" + descriptorNoop + ";};" : ""}
            exports.sender = ${["accessor-noop", "successive-noops", "literal-noop", "replaced-namespace", "namespaced-noop", "patched-intrinsic", "patch-after", "outer-patch-after", "mutating-intrinsic"].includes(name) ? descriptorSender : descriptorNoop};
            Object.defineProperty(exports, "sender", ${descriptor});
            ${name.startsWith("patch-after") ? "Object.defineProperty=()=>{};" : ""}
            function send(channel, ...args) { electron.ipcRenderer.send(channel, ...args); }
          },
          9(module, exports, load) {
            const helper = load(5);
            load(2).contextBridge.exposeInMainWorld("${name}", {copy: helper.sender("${name}:copy")});
          }
        };
        function load(id) { const m = {exports:{}}; modules[id].call(m.exports,m,m.exports,load); return m.exports; }
        load(9);
        ${name === "outer-patch-after" ? "Object.defineProperty=()=>{};" : ""}
      })();`;
        // Node executes only this test-owned fixture with a recording Electron
        // substitute: an independent descriptor-semantics oracle, not provider proof.
        const channels: string[] = [];
        const run = () =>
          runInNewContext(
            name === "typescript-assertion"
              ? stripTypeScriptTypes(source)
              : source,
            {
              require: () => ({
                ipcRenderer: {
                  send: (channel: string) => channels.push(channel),
                },
                contextBridge: {
                  exposeInMainWorld: (_key: string, api: { copy(): void }) =>
                    api.copy(),
                },
              }),
            },
            { timeout: 1_000 },
          );
        if (throws) expect(run).toThrow(/Invalid property descriptor/u);
        else run();
        expect(channels, name).toEqual(sends ? [`${name}:copy`] : []);
        return [
          `${name}.${name === "typescript-assertion" ? "cts" : "cjs"}`,
          source,
        ];
      }),
    );
    await writeFixtureFiles(root, files);
    const connection =
      surface === "stdio MCP" ? await connectLocalToolsMcp() : undefined;
    if (connection !== undefined) {
      const failure = await connection.call("analyze_javascript_application", {
        input_path: join(root, "absent"),
        format: "directory",
      });
      expect(failure.isError).toBe(true);
      await connection.client.ping();
    }
    const { statistics, observations } = await analyzeDescriptorFacts({
      cli,
      root,
      connection,
    });
    for (const [name, source] of Object.entries(files))
      expect(await readFile(join(root, name), "utf8")).toBe(source);
    expect(statistics).toMatchObject({
      parsed_javascript_files: descriptorCases.length,
      parse_failures: 0,
    });
    const terminals = observations.filter(
      ({ properties }) =>
        properties.step_kind === "terminal" &&
        properties.terminal === "electron.ipcRenderer.send",
    );
    expect(
      terminals.map(({ properties }) => properties.channel).sort(),
    ).toEqual(
      descriptorCases
        // A factory with a later global patch can run repeatedly: its native
        // intrinsic is unknown even though this test invokes it only once.
        .filter(([, , sends, , admitted = sends]) => admitted)
        .map(([name]) => `${name}:copy`)
        .sort(),
    );
    for (const terminal of terminals)
      expect(terminal).toMatchObject({
        properties: { resolution: "candidate" },
        evidence: {
          state: "inferred",
          authority: "static-relationship-inference",
        },
      });
  },
);
