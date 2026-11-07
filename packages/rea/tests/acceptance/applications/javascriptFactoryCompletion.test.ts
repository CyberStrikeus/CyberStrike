import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { isNativeError } from "node:util/types";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const scenarios = [
  {
    name: "pre-exit-root-export",
    guard: "if(flag)return;exports.unrelated=1;",
    eventsFirst: true,
    bindingFirst: true,
    rootEvents: true,
    candidate: true,
  },
  {
    name: "pre-exit-export-replaced",
    guard: "if(flag)return;exports.events=null;",
    eventsFirst: true,
    bindingFirst: true,
    candidate: true,
    guarded: true,
    guardCondition: "flag",
  },

  {
    name: "pre-exit-export",
    guard: "if(flag)return;",
    eventsFirst: true,
    bindingFirst: true,
    candidate: true,
  },
  {
    name: "pre-exit-export-later-local",
    guard: "if(flag)return;const unrelated=1;",
    eventsFirst: true,
    bindingFirst: true,
    candidate: true,
  },
  {
    name: "pre-exit-export-late-capture",
    guard: "if(flag)return;",
    eventsFirst: true,
    candidate: true,
    guarded: true,
  },

  { name: "control", guard: "", candidate: true },
  { name: "false", guard: "if (false) return;", candidate: true },
  {
    name: "unknown",
    guard: "if (flag) return;",
    candidate: true,
    guarded: true,
  },
  {
    name: "block",
    guard: "{ if (flag) return; }",
    candidate: true,
    guarded: true,
  },
  {
    name: "nested-function",
    guard: "function unused() { return; }",
    candidate: true,
  },
  {
    name: "async-guard",
    guard: "async function stop(){return false;}if(stop())return;",
    candidate: false,
  },
  {
    name: "generator-guard",
    guard: "function* stop(){return false;}if(stop())return;",
    candidate: false,
  },
  {
    name: "async-generator-guard",
    guard: "async function* stop(){return false;}if(stop())return;",
    candidate: false,
  },
  { name: "true", guard: "if (true) return;", candidate: false },
  { name: "return", guard: "return;", candidate: false },
  { name: "both", guard: "if (flag) return; else return;", candidate: false },
  { name: "throw", guard: "throw new Error('stop');", candidate: false },
  { name: "labeled-exit", guard: "exit: { return; }", candidate: false },
  { name: "with-exit", guard: "with ({}) { return; }", candidate: false },
  {
    name: "export-guard",
    guard: "exports.stop=true;if(exports.stop)return;exports.stop=false;",
    candidate: false,
  },
  {
    name: "module-guard",
    guard:
      "module.exports.stop=true;if(module.exports.stop)return;module.exports.stop=false;",
    candidate: false,
  },
  {
    name: "snapshot-guard",
    guard:
      "exports.stop=true;const {stop}=exports;exports.stop=false;if(stop)return;",
    candidate: false,
  },
  {
    name: "spread-guard",
    guard:
      "exports.stop=true;const saved={...exports};exports.stop=false;if(saved.stop)return;",
    candidate: false,
  },
  {
    name: "local-guard",
    guard:
      "exports.stop=true;function stop(){return exports.stop;}if(stop())return;exports.stop=false;",
    candidate: false,
  },
  {
    name: "argument-guard",
    guard: "exports.stop=true;if(readStop(exports))return;exports.stop=false;",
    candidate: false,
  },
  {
    name: "false-export-guard",
    guard: "exports.stop=false;if(exports.stop)return;exports.stop=true;",
    candidate: true,
  },
  {
    name: "loaded-spread-snapshot",
    guard:
      "exports.stop=true;const saved={...exports};exports.stop=false;exports.check=()=>saved.stop;",
    callerGuard: "if(helper.check())return;",
    candidate: false,
  },
  {
    name: "loaded-destructured-snapshot",
    guard:
      "exports.stop=true;const {stop}=exports;exports.stop=false;exports.check=()=>stop;",
    callerGuard: "if(helper.check())return;",
    candidate: false,
  },
  {
    name: "self-alias",
    guard: "exports.self=exports;",
    listenerPath: "self.self.events",
    candidate: true,
  },
  {
    name: "module-alias",
    guard: "exports.owner=module;",
    listenerPath: "owner.exports.events",
    candidate: true,
  },
  {
    name: "returned-alias",
    guard: "exports.getSelf=()=>exports;",
    listenerPath: "getSelf().events",
    candidate: true,
  },
  {
    name: "self-alias-after-exit",
    guard: "exports.self=exports;return;",
    listenerPath: "self.events",
    candidate: false,
  },
  {
    name: "imported-guard",
    guard:
      "exports.stop=true;if(load(1).read(exports))return;exports.stop=false;",
    candidate: false,
  },
  {
    name: "imported-false-guard",
    guard:
      "exports.stop=false;if(load(1).read(exports))return;exports.stop=true;",
    candidate: true,
  },
  {
    name: "imported-nested-guard",
    guard:
      "exports.stop=true;if(load(1).read2(exports))return;exports.stop=false;",
    candidate: false,
  },
  {
    name: "imported-snapshot-guard",
    guard:
      "exports.stop=true;const saved=load(1).read(exports);exports.stop=false;if(saved)return;",
    candidate: false,
  },
  {
    name: "loaded-imported-snapshot",
    guard:
      "exports.stop=true;const saved=load(1).read(exports);exports.stop=false;exports.check=()=>saved;",
    callerGuard: "if(helper.check())return;",
    candidate: false,
  },
  {
    name: "inline-self-alias",
    guard: "exports.self=exports;",
    listenerPath: "self.events",
    inlineEvents: true,
    candidate: true,
  },
  {
    name: "export-after-exit",
    guard: "return;",
    candidate: false,
    bindingFirst: true,
  },
] as const;

const factorySource = (scenario: (typeof scenarios)[number]) => {
  const { guard } = scenario;
  const bindingFirst = "bindingFirst" in scenario && scenario.bindingFirst;
  const callerGuard = "callerGuard" in scenario ? scenario.callerGuard : "";
  const listenerPath =
    "listenerPath" in scenario ? scenario.listenerPath : "events";
  const events =
    "rootEvents" in scenario && scenario.rootEvents
      ? `module.exports={events:{addListener(channel,handler){return electron.ipcMain.addListener(channel,handler);}}};`
      : "inlineEvents" in scenario && scenario.inlineEvents
        ? 'exports.events = require("electron").ipcMain;'
        : `exports.events = { addListener(channel,handler) {
          return electron.ipcMain.addListener(channel,handler);
        }};`;
  const binding = "const electron = load(2);";
  return `function readStop(value) { return value.stop; }
  (() => {
    const modules = {
      1(module,exports) {
        exports.read = value => value.stop;
        exports.read2 = value => readStop(value);
      },
      2(module) { module.exports = require("electron"); },
      5(module,exports,load) {
        ${bindingFirst ? binding : ""}
        ${"eventsFirst" in scenario && scenario.eventsFirst ? events : ""}
        ${guard}
        ${bindingFirst ? "" : binding}
        ${"eventsFirst" in scenario && scenario.eventsFirst ? "" : events}
      },
      9(module,exports,load) {
        const helper = load(5);
        ${callerGuard}
        helper.${listenerPath}.addListener("test:copy", () => {});
      }
    };
    function load(id) { const m={exports:{}}; modules[id].call(m.exports,m,m.exports,load); return m.exports; }
    load(9);
  })();`;
};

const runtimeChannels = (source: string, flag: boolean) => {
  const channels: string[] = [];
  try {
    // Only this authored fixture executes. REA reads the same bytes as inert
    // source; the stub does not establish real Electron runtime behavior.
    runInNewContext(
      source,
      {
        flag,
        require: (name: string) => {
          if (name !== "electron") throw new Error(`Unexpected module ${name}`);
          return {
            ipcMain: {
              addListener: (channel: string) => channels.push(channel),
            },
          };
        },
      },
      { timeout: 1_000 },
    );
  } catch (error) {
    // A skipped export makes the caller throw before it registers a handler.
    if (
      !isNativeError(error) ||
      channels.length !== 0 ||
      !(
        error.message === "stop" ||
        (error.name === "TypeError" && error.message.includes("addListener")) ||
        (error.name === "ReferenceError" &&
          error.message === "Cannot access 'electron' before initialization")
      )
    )
      throw error;
  }
  return channels;
};

type Application = ReturnType<
  typeof javascriptApplicationAnalysisResultSchema.parse
>;

const verifyApplication = (
  result: Application,
  candidate: boolean,
  guarded: string | false,
  coverage: "partial" | "complete",
) => {
  expect(result.statistics.parse_failures).toBe(0);
  expect(result.summary.ipc.literal_channels).toBe(
    candidate && !guarded ? 1 : 0,
  );
  const handlers = result.graph.nodes.filter(
    (node) =>
      node.identity.strategy === "artifact-local-key" &&
      node.identity.namespace === "electron-ipc-handler" &&
      node.identity.key.includes("main:on:test:copy:"),
  );
  expect(handlers).toHaveLength(candidate && !guarded ? 1 : 0);
  for (const handler of handlers) {
    expect(handler.observations[0]?.evidence).toMatchObject({
      authority: "static-relationship-inference",
      state: "inferred",
      location: { available: true, value: { source: "main.js" } },
      coverage: { status: coverage },
    });
  }
  expect(result.graph.coverage).toMatchObject({
    status: coverage,
    truncated: false,
  });
  const paths = result.graph.nodes
    .flatMap((node) => node.observations)
    .filter(
      (observation) =>
        observation.properties.terminal === "electron.ipcMain.addListener" &&
        observation.properties.channel === "test:copy",
    );
  if (!candidate || !guarded) expect(paths).toEqual([]);
  if (guarded) {
    expect(paths.map((observation) => observation.properties)).toContainEqual(
      expect.objectContaining({
        resolution: "candidate",
        conditions: expect.arrayContaining([
          expect.objectContaining({ expression: guarded }),
        ]),
      }),
    );
    expect(paths[0]?.evidence).toMatchObject({
      authority: "static-relationship-inference",
      state: "inferred",
      location: { available: true, value: { source: "main.js" } },
    });
  }
};

cliTest(
  "retains guarded factory fallthrough through CLI and real stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-factory-completion-");
    const { call } = await connectLocalToolsMcp();
    const contract = toolContract("analyze_javascript_application");
    for (const scenario of scenarios) {
      const source = factorySource(scenario);
      const directory = join(root, scenario.name);
      await mkdir(directory);
      await writeFile(join(directory, "main.js"), source);
      const runtime = [false, true].map((flag) =>
        runtimeChannels(source, flag),
      );
      const hasRuntimePath = runtime.some((channels) =>
        channels.includes("test:copy"),
      );
      expect(hasRuntimePath, scenario.name).toBe(scenario.candidate);
      if (
        "guarded" in scenario &&
        scenario.guarded &&
        !("guardCondition" in scenario)
      )
        expect(runtime).toEqual([["test:copy"], []]);
      const response = await call("analyze_javascript_application", {
        input_path: directory,
        format: "directory",
      });
      expect(
        response.isError,
        response.isError
          ? `${scenario.name}: ${JSON.stringify(response.content)}`
          : scenario.name,
      ).not.toBe(true);
      const evidence = contract.outputSchema.parse(response.structuredContent);
      verifyApplication(
        javascriptApplicationAnalysisResultSchema.parse(
          evidence.normalized_result,
        ),
        scenario.candidate,
        "guarded" in scenario && scenario.guarded
          ? "guardCondition" in scenario
            ? scenario.guardCondition
            : "!(flag)"
          : false,
        "inlineEvents" in scenario && scenario.inlineEvents
          ? "complete"
          : "partial",
      );
      if (["control", "false", "unknown"].includes(scenario.name)) {
        const analyzed = await cli.run({
          arguments: [
            "analyze-javascript-application",
            directory,
            "--artifact-format",
            "directory",
            "--json",
          ],
        });
        expect(analyzed.exitCode, analyzed.stderr).toBe(0);
        expect(contract.outputSchema.parse(analyzed.json).evidence_id).toBe(
          evidence.evidence_id,
        );
      }
    }
  },
  120_000,
);

cliTest(
  "does not execute unadvanced generator calls through public CLI/MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-generator-call-");
    const { call } = await connectLocalToolsMcp();
    const contract = toolContract("analyze_javascript_application");
    for (const [name, kind, expected, advance] of [
      ["regular", "", 1, false],
      ["generator", "*", 0, false],
      ["async-generator", "async *", 0, false],
      ["advanced-generator", "*", 1, true],
    ] as const) {
      const declaration =
        kind === "async *" ? "async function*" : `function${kind}`;
      const source = `const e=require("electron");
      ${declaration} send(channel){e.ipcRenderer.send(channel);}
      e.contextBridge.exposeInMainWorld("api",{start:()=>send("generator:test")${advance ? ".next()" : ""}});`;
      const channels: string[] = [];
      runInNewContext(
        source,
        {
          require: () => ({
            ipcRenderer: { send: (channel: string) => channels.push(channel) },
            contextBridge: {
              exposeInMainWorld: (
                _key: string,
                api: { start: () => unknown },
              ) => api.start(),
            },
          }),
        },
        { timeout: 1_000 },
      );
      expect(channels.length, name).toBe(expected);
      const directory = join(root, name);
      await mkdir(directory);
      await writeFile(join(directory, "main.js"), source);
      const response = await call("analyze_javascript_application", {
        input_path: directory,
        format: "directory",
      });
      expect(response.isError, name).not.toBe(true);
      const evidence = contract.outputSchema.parse(response.structuredContent);
      const result = javascriptApplicationAnalysisResultSchema.parse(
        evidence.normalized_result,
      );
      expect(result.summary.ipc.literal_channels, name).toBe(
        advance ? 0 : expected,
      );
      if (advance) expect(result.graph.coverage.status).toBe("partial");
      const paths = result.graph.nodes
        .filter(
          (node) =>
            node.identity.strategy === "artifact-local-key" &&
            node.identity.namespace === "electron-call-path-step",
        )
        .flatMap((node) => node.observations)
        .filter(
          (observation) =>
            observation.properties.terminal === "electron.ipcRenderer.send" &&
            observation.properties.entry === "api.start" &&
            observation.properties.step_kind === "terminal",
        );
      expect(paths.length, name).toBe(advance ? 0 : expected);
      const analyzed = await cli.run({
        arguments: [
          "analyze-javascript-application",
          directory,
          "--artifact-format",
          "directory",
          "--json",
        ],
      });
      expect(analyzed.exitCode, analyzed.stderr).toBe(0);
      expect(contract.outputSchema.parse(analyzed.json).evidence_id).toBe(
        evidence.evidence_id,
      );
    }
  },
  30_000,
);
