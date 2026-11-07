import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  {
    name: "typed member store retains returned module ownership",
    mainFile: "main.ts",
    load: 'const box={make:()=>({require(){}})};(box.make as any)=()=>module;box.make().require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "typed local member store stays inert",
    mainFile: "main.ts",
    load: 'const box={make:()=>module};(box.make as any)=()=>({require(){}});box.make().require("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "assignment result retains module receiver",
    load: 'let holder;(holder=module).require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "assignment result retains local receiver",
    load: 'let holder;(holder={require(){}}).require("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "captured wrapper require retains loader ownership",
    load: 'const load=require;load("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "captured local callable stays inert",
    load: 'const local=()=>{};const load=local;load("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "require.resolve does not execute its resolved module",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    load: 'require.resolve("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "resolution discovery does not suppress a subsequent executable load",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    load: 'require.resolve("../shared/window.cjs");require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "sibling wrapper property writes preserve resolver identity",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    load: 'require.unrelated=custom;require.resolve("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "later resolver writes do not change an earlier lookup",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    load: 'require.resolve("../shared/window.cjs");require.resolve=custom;',
    possible: false,
  },
  {
    name: "conditional wrapper resolver writes retain possible execution",
    uncertainResolver: true,
    load: 'if(flag)require.resolve=custom;require.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "escaped wrapper resolver retains possible execution",
    uncertainResolver: true,
    load: 'consume(require);require.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "invoked getter retains ambient resolver mutation",
    uncertainResolver: true,
    load: 'const box={loader:require,get trigger(){this.loader.resolve=this.loader;return 0}};box.trigger;require.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "invoked getter retains qualified ambient resolver mutation",
    uncertainResolver: true,
    load: 'const box={loader:globalThis.require,get trigger(){this.loader.resolve=this.loader;return 0}};box.trigger;require.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "unused getter preserves ambient resolver identity",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    load: 'const box={loader:require,get trigger(){this.loader.resolve=this.loader;return 0}};require.resolve("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "later getter read preserves earlier ambient resolution",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    load: 'const box={loader:require,get trigger(){this.loader.resolve=this.loader;return 0}};require.resolve("../shared/window.cjs");box.trigger;',
    possible: false,
  },
  {
    name: "invoked getter retains lexical created resolver mutation",
    uncertainResolver: true,
    mainFile: "main.mjs",
    load: 'import {createRequire} from "node:module";const loader=createRequire(import.meta.url);const box={loader,get trigger(){this.loader.resolve=this.loader;return 0}};box.trigger;loader.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "replaced resolver retains possible executable ownership",
    uncertainResolver: true,
    load: 'require.resolve=require;require.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "created resolver retains discovery without module execution",
    resolverSpecifier: "../shared/window.cjs",
    resolverTarget: "shared/window.cjs",
    mainFile: "main.mjs",
    load: 'import {createRequire} from "node:module";const load=createRequire(import.meta.url);load.resolve("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "missing resolver target does not create executable ownership gaps",
    missingTargetOperation: "resolve",
    resolverSpecifier: "../missing/window.cjs",
    resolverTarget: null,
    load: 'require.resolve("../missing/window.cjs");',
    possible: false,
  },
  {
    name: "dynamic executable target retains application ownership uncertainty",
    unresolvedExecutable: true,
    load: "require(runtimeTarget);",
    possible: true,
  },
  {
    name: "modified created resolver retains possible executable ownership",
    uncertainResolver: true,
    mainFile: "main.mjs",
    load: 'import {createRequire} from "node:module";const load=createRequire(import.meta.url);load.resolve=load;load.resolve("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "require.main is not an implicit module loader",
    load: 'require.main("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "createRequire alias retains its source module base",
    mainFile: "main.mjs",
    load: 'import {createRequire} from "node:module";const load=createRequire(import.meta.url);load("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "conditional opaque factory retains competing loader ownership",
    mainFile: "main.mjs",
    load: 'import {createRequire as native} from "node:module";const make=flag?native:getFactory();const load=make(import.meta.url);load("./window.cjs");',
    possible: true,
  },
  {
    name: "only local returned factory stays inert",
    mainFile: "main.mjs",
    load: 'const getFactory=()=>()=>()=>({});const make=getFactory();const load=make(import.meta.url);load("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "local createRequire name stays inert",
    mainFile: "main.mjs",
    load: 'const createRequire=()=>()=>{};const load=createRequire(import.meta.url);load("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "replaced createRequire factory stays inert",
    mainFile: "main.mjs",
    load: 'import * as mod from "node:module";mod.default.createRequire=()=>()=>({});const load=mod.default.createRequire(import.meta.url);load("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "CommonJS module has no synthetic default factory",
    load: 'const load=require("node:module").default.createRequire(import.meta.url);load("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "conditional call replacement retains native loader alternative",
    mainFile: "main.mjs",
    load: 'import {createRequire as make} from "node:module";const load=make(import.meta.url);if(flag)load.call=()=>{};load.call(null,"../shared/window.cjs");',
    possible: true,
  },
  {
    name: "conditional apply replacement retains native loader alternative",
    mainFile: "main.mjs",
    load: 'import {createRequire as make} from "node:module";const load=make(import.meta.url);if(flag)load.apply=()=>{};load.apply(null,["../shared/window.cjs"]);',
    possible: true,
  },
  {
    name: "replaced created-loader call stays inert",
    mainFile: "main.mjs",
    load: 'import {createRequire as make} from "node:module";const load=make(import.meta.url);load.call=()=>{};load.call(null,"../shared/window.cjs");',
    possible: false,
  },
  {
    name: "changed Function call retains loader argument uncertainty",
    mainFile: "main.mjs",
    load: 'import {createRequire as make} from "node:module";const load=make(import.meta.url);Function.prototype.call=()=>({});load.call(null,"./inert.cjs");',
    possible: true,
  },
  {
    name: "changed Function apply retains loader argument uncertainty",
    mainFile: "main.mjs",
    load: 'import {createRequire as make} from "node:module";const load=make(import.meta.url);Function.prototype.apply=()=>({});load.apply(null,["./inert.cjs"]);',
    possible: true,
  },
  {
    name: "custom array iterator preserves loader ownership",
    load: 'Array.prototype[Symbol.iterator]=function*(){yield "../shared/window.cjs"};require(...["./inert.cjs"]);',
    possible: true,
  },
  {
    name: "Reflect.apply retains module delegate ownership",
    load: 'Reflect.apply(module.require,module,["../shared/window.cjs"]);',
    possible: true,
  },
  {
    name: "local Reflect.apply stays inert",
    load: 'const Reflect={apply(){}};Reflect.apply(module.require,module,["../shared/window.cjs"]);',
    possible: false,
  },
  {
    name: "noncallable generic receiver excludes callable children",
    load: 'const get=()=>({});const invoke=get.call;const holder={invoke,other:()=>module};holder.invoke(null).require("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "callable generic receiver retains its return",
    load: 'const get=()=>({});const invoke=get.call;const holder=()=>module;holder.invoke=invoke;holder.other=()=>({});holder.invoke(null).require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "destructured module alias retains own copied delegate",
    load: 'let selected;({selected}={selected:module});selected.require=module.require;const copy={...module};const load=copy.require;load.call(module,"../shared/window.cjs");',
    possible: true,
  },
  {
    name: "destructured local alias does not change module copies",
    load: 'let selected;({selected}={selected:{require(){}}});selected.require=module.require;const copy={...module};const load=copy.require;load.call(module,"../shared/window.cjs");',
    possible: false,
  },
  {
    name: "inherited delegate excluded from rest",
    load: 'const {...h}=module;h.require.call(module,"../shared/window.cjs");',
    possible: false,
  },
  {
    name: "own delegate retained in spread",
    load: 'module.require=module.require;const h={...module};h.require.call(module,"../shared/window.cjs");',
    possible: true,
  },
  {
    name: "nested module retained in spread",
    load: 'const h={...{loader:module}};h.loader.require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "require-named delegate",
    load: 'const h={require:module.require};h.require.call(module,"../shared/window.cjs");',
    possible: true,
  },
  {
    name: "require-named local",
    load: 'const h={require(){}};h.require.call(module,"../shared/window.cjs");',
    possible: false,
  },
  {
    name: "require-named applied delegate",
    load: 'const h={require:module.require};h.require.apply(module,["../shared/window.cjs"]);',
    possible: true,
  },
  {
    name: "require-named applied local",
    load: 'const h={require(){}};h.require.apply(module,["../shared/window.cjs"]);',
    possible: false,
  },
  {
    name: "module receiver",
    load: '(0,module).require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "main module receiver",
    load: 'require.main.require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "process main module receiver",
    load: 'process.mainModule.require("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "local process main module receiver",
    load: 'const process={mainModule:{require(){}}};process.mainModule.require("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "local main module receiver",
    load: 'const require={main:{require(){}}};require.main.require("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "captured delegate",
    load: 'const load=(0,module.require);load("../shared/window.cjs");',
    possible: true,
  },
  {
    name: "local receiver",
    load: '(module,{require(){}}).require("../shared/window.cjs");',
    possible: false,
  },
  {
    name: "local final delegate",
    load: 'const load=(module.require,()=>{});load("../shared/window.cjs");',
    possible: false,
  },
] as const;

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((test) => ({ ...test, surface })),
  ),
)(
  "preserves $name loader owner uncertainty through $surface",
  async (testCase, { cli }) => {
    const { surface, load, possible } = testCase;
    const mainFile = "mainFile" in testCase ? testCase.mainFile : "main.cjs";
    const root = await createTestTempDirectory("rea-sequence-loader-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: mainFile }),
      [`a/${mainFile}`]: `throw new Error('Static fixture must never execute');${load}`,
      "a/inert.cjs":
        "throw new Error('Static inert decoy must never execute');",
      "a/window.cjs":
        "throw new Error('Static factory-base decoy must never execute');",
      "a/index.html": "possible page",
      "b/package.json": '{"main":"main.cjs"}',
      "b/main.cjs": `throw new Error('Static fixture must never execute');require('../shared/window.cjs');`,
      "b/index.html": "proven page",
      "shared/window.cjs": `throw new Error('Static fixture must never execute');const {BrowserWindow}=require('electron');new BrowserWindow().loadFile('index.html');`,
      "shared/index.html": "source-relative decoy",
      "index.html": "artifact-root decoy",
    });
    const { graph, statistics } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      root,
    );
    expect(statistics.parse_failures).toBe(0);
    if ("resolverSpecifier" in testCase) {
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "imports",
            properties: expect.objectContaining({
              kind: "require",
              operation: "resolve",
              specifier: testCase.resolverSpecifier,
              resolution_mode: "require",
              resolved_path: testCase.resolverTarget,
            }),
          }),
        ]),
      );
    }

    if ("uncertainResolver" in testCase)
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "imports",
            properties: expect.objectContaining({
              kind: "require",
              operation: "load",
              specifier: null,
            }),
            evidence: expect.objectContaining({
              coverage: expect.objectContaining({ status: "partial" }),
            }),
          }),
        ]),
      );
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    if (
      "missingTargetOperation" in testCase ||
      "unresolvedExecutable" in testCase
    ) {
      const baseLimitation =
        "Inventoried package metadata does not establish one application root for this source; the loadFile base is unknown.";
      const executable = "unresolvedExecutable" in testCase;
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "imports",
            properties: expect.objectContaining({
              operation: executable ? "load" : "resolve",
              specifier: executable ? null : "../missing/window.cjs",
              expression: executable ? "require(runtimeTarget)" : null,
              resolved_path: null,
              resolution_status: executable ? null : "not-found",
            }),
            evidence: expect.objectContaining({
              coverage: expect.objectContaining({ status: "complete" }),
              limitations: expect.arrayContaining([
                "Static syntax does not prove that this relationship executes at runtime.",
              ]),
            }),
          }),
        ]),
      );
      expect(roles[0]?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              limitations: executable ? [baseLimitation] : [],
            }),
            evidence: expect.objectContaining({
              coverage: expect.objectContaining({ status: "complete" }),
              limitations: executable
                ? expect.arrayContaining([baseLimitation])
                : expect.not.arrayContaining([baseLimitation]),
            }),
          }),
        ]),
      );
    }

    expect(roles[0]?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolution_status: possible ? "unavailable" : "resolved",
          }),
        }),
      ]),
    );
    const mapped = graph.edges.filter(
      ({ relation, source_node_id }) =>
        relation === "maps_to" && source_node_id === roles[0]?.node_id,
    );
    expect(mapped).toHaveLength(possible ? 0 : 1);
    if (!possible)
      expect(mapped[0]?.properties.resolved_path).toBe("b/index.html");
  },
);
