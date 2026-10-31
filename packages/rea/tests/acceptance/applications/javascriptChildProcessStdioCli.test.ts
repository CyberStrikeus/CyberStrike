import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

// Each row covers one ownership, overload or uncertainty boundary. Both public
// adapters read the same inert fixture; no Cartesian product of equivalent calls.
const cases = [
  [
    'spawn("duplicate", [], {stdio:"pipe",stdio:"inherit"})',
    "duplicate",
    "inherit",
    0,
  ],
  ['spawn("control", [], {stdio:"inherit"})', "control", "inherit", 0],
  [
    'spawn("spread-after", [], {stdio:"pipe",...input})',
    "spread-after",
    "dynamic",
    0,
  ],
  ['spawn("unknown-options", [], input)', "unknown-options", "dynamic", 0],
  [
    'spawn("spread-before", [], {...input,stdio:"inherit"})',
    "spread-before",
    "inherit",
    0,
  ],
  [
    'spawn("null-spreads", [], {stdio:"inherit",...null,...undefined,...void effect()})',
    "null-spreads",
    "inherit",
    0,
  ],
  [
    'spawn("computed", [], {stdio:"inherit",[key]:1})',
    "computed",
    "dynamic",
    0,
  ],
  [
    'spawn("coerced-keys", [], {stdio:"inherit",[true]:1,[null]:1,[-1]:1,[+(1 as number)]:1})',
    "coerced-keys",
    "inherit",
    0,
  ],
  [
    'spawn("void-key", [], {stdio:"inherit",[void effect()]:1})',
    "void-key",
    "inherit",
    0,
  ],
  [
    'spawn("primitive-spreads", [], {stdio:"inherit",...false,...42,...1n})',
    "primitive-spreads",
    "inherit",
    0,
  ],
  [
    'spawn("inline-empty", [], {stdio:"inherit",...{}})',
    "inline-empty",
    "inherit",
    0,
  ],
  [
    'spawn("inline-final", [], {stdio:"pipe",...{...{stdio:"ignore",stdio:"inherit"}}})',
    "inline-final",
    "inherit",
    0,
  ],
  [
    'spawn("inline-getter", [], {stdio:"ignore",...{get other(){this.stdio="pipe";return 0},stdio:"inherit"}})',
    "inline-getter",
    "dynamic",
    0,
  ],
  [
    'spawn("inline-helper", [], {stdio:"inherit",...{...{helper(){}}}})',
    "inline-helper",
    "inherit",
    0,
  ],
  [
    'spawn("inline-unknown", [], {stdio:"inherit",...{...input}})',
    "inline-unknown",
    "dynamic",
    0,
  ],
  [
    'spawn("getter", [], {stdio:"inherit",get stdio(){return input}})',
    "getter",
    "dynamic",
    0,
  ],
  ['spawn("method", [], {stdio:"inherit",stdio(){}})', "method", "dynamic", 0],
  [
    'spawn("array-stdio", [], {stdio:["pipe",input]})',
    "array-stdio",
    "array",
    0,
  ],
  ['spawn("missing-stdio", [])', "missing-stdio", "default", 0],
  // Async exec/execFile ignore stdio even when the supplied value is dynamic.
  ['exec("exec-inherit", {stdio:"inherit"})', "exec-inherit", "default", null],
  [
    'execFile("execfile-ignore", {stdio:"ignore"})',
    "execfile-ignore",
    "default",
    null,
  ],
  [
    'execFile("execfile-array", [], {stdio:["inherit","inherit","inherit"]})',
    "execfile-array",
    "default",
    0,
  ],
  [
    'execFile("execfile-dynamic", ["one"], {stdio:input,env:{A:"1"}})',
    "execfile-dynamic",
    "default",
    1,
  ],
  ['fork("fork-silent", [], {silent:true})', "fork-silent", "pipe", 0],
  [
    'fork("fork-explicit", [], {silent:true,stdio:"inherit"})',
    "fork-explicit",
    "inherit",
    0,
  ],
  ['exec("null-stdio", {stdio:null})', "null-stdio", "default", null],
  [
    'execFile("undefined-options", [], undefined)',
    "undefined-options",
    "default",
    0,
  ],
  ['fork("void-options", [], void effect())', "void-options", "default", 0],
  [
    'spawn("options-only", {stdio:"inherit"}, {stdio:null})',
    "options-only",
    "inherit",
    null,
  ],
  [
    'spawn("ambiguous-slot", input, {stdio:"inherit"})',
    "ambiguous-slot",
    "dynamic",
    null,
  ],
  [
    'fork("nullish-slot", null, {stdio:"inherit"})',
    "nullish-slot",
    "inherit",
    null,
  ],
  [
    'spawn("wrapped-argv", ([] as string[])!, {stdio:"inherit"})',
    "wrapped-argv",
    "inherit",
    0,
  ],
  [
    'spawn("named-argv", argv, {env:{A:"1"},stdio:"inherit"})',
    "named-argv",
    "inherit",
    null,
  ],
  [
    'spawn("captured-argv", captured, {stdio:"inherit"})',
    "captured-argv",
    "dynamic",
    null,
  ],
  [
    'spawn("spread-argv", ["a",...input], {stdio:"inherit"})',
    "spread-argv",
    "inherit",
    null,
  ],
  ['spawn("fixed-argv", ["a"], {stdio:"inherit"})', "fixed-argv", "inherit", 1],
  [
    'spawn("spread-slot", ...input, {stdio:"inherit"})',
    "spread-slot",
    "dynamic",
    null,
  ],
  ['spawn(...input, [], {stdio:"inherit"})', null, "dynamic", null],
  ['exec("named-callback", done)', "named-callback", "default", null],
  ['execFile("callback-alias", [], callback)', "callback-alias", "default", 0],
  ['exec("imported-callback", imported)', "imported-callback", "default", null],
  [
    'exec("reassigned-callback", changed)',
    "reassigned-callback",
    "default",
    null,
  ],
  ['spawn("named-nullish", [], {stdio:absent})', "named-nullish", "dynamic", 0],
  [
    'spawn("named-null-spread", [], {stdio:"inherit",...absent})',
    "named-null-spread",
    "dynamic",
    0,
  ],
] as const;

const annexBSource = `
  const {spawn,execFile}=require("node:child_process");
  var argv=[]; {function argv(){}}
  spawn("annex-b-argv",argv,{stdio:"inherit"});
  function run(){
    var args=[]; switch(input){case 0:function args(){}}
    spawn("annex-b-local",args,{stdio:"inherit"});
  }
  var stable=[]; function done(){}
  spawn("cjs-var-argv",stable,{stdio:"inherit"});
  execFile("cjs-hoisted-callback",done);
`;

const importEqualsSource = `
  import cp = require("node:child_process");
  const argv=[]; function done(){}
  cp.spawn("import-equals-argv",argv,{stdio:"inherit"});
  cp.exec("import-equals-callback",done);
`;

const exportAssignmentSource = `
  const {spawn}=require("node:child_process");
  const argv=[]; spawn("export-assignment-argv",argv,{stdio:"inherit"});
  var args=[]; {function args(){}}
  spawn("export-assignment-annex",args,{stdio:"inherit"});
  export = argv;
`;

// Callback/options ambiguity cannot change exec's effective stdio.
const opaqueExecCallbackCommands = [
  "eval-callback",
  "constructed-callback",
  "mapped-callback",
  "cjs-wrapper-callback",
];

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves effective stdio, overloads and explicit unknowns through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-child-stdio-");
    await writeFixtureFiles(root, {
      "entry.ts": `
        import {spawn,exec,execFile,fork} from "node:child_process";
        import {done as imported} from "./external.mjs";
        throw new Error("static fixture must never execute");
        function done(){}
        const captured=[]; const absent=null;
        function run(input,key){
          const callback=done; const argv=[];
          let changed=()=>{}; changed=input;
          ${cases.map(([source]) => `${source};`).join("\n")}
        }
      `,
      "external.mjs": "export function done(){}",
      "globals.js": `
        const {spawn,exec}=require("node:child_process");
        var argv=[];(()=>{}).constructor("argv={stdio:'inherit'}")();
        spawn("constructed-argv",argv,{stdio:"pipe"});
        let done=()=>{};(()=>{}).constructor("done={stdio:'inherit'}")();
        exec("constructed-callback",done);
      `,
      "wrapper.cjs": `
        const {spawn,exec}=require("node:child_process");
        const argv=[]; const done=()=>{};
        spawn("cjs-argv",argv,{stdio:"inherit"});exec("cjs-callback",done);
        var module=[]; const args=arguments; args[2]={stdio:"inherit"};
        spawn("cjs-wrapper-argv",module,{stdio:"pipe"});
        function exports(){}; args[0]={stdio:"inherit"};
        exec("cjs-wrapper-callback",exports);
      `,
      "wrapper.cts": `
        const {spawn,exec}=require("node:child_process");
        const argv: string[]=[]; const done=()=>{};
        spawn("cts-argv",argv,{stdio:"inherit"});exec("cts-callback",done);
      `,
      "annex-b.cjs": annexBSource,
      "import-equals.ts": importEqualsSource,
      "export-assignment.ts": exportAssignmentSource,
      "parameters.cjs": `
        const {exec}=require("node:child_process");
        function mapped(cb){cb=()=>{};arguments[0]={stdio:'inherit'};exec("mapped-callback",cb)}
      `,
      "exposed.cjs": `
        const {spawn,exec}=require("node:child_process");
        var mode=null; Function("mode='inherit'")();
        spawn("Function-global",[],{stdio:mode});
        var frameMode=null; frames.frameMode='inherit';
        spawn("frames-global",[],{stdio:frameMode});
        function mapped(mode){mode=null;arguments[0]='inherit';spawn("mapped-arguments",[],{stdio:mode})}
        function exposed(options){let done=()=>{};eval("done=options");exec("eval-callback",done)}
        function shadowed(undefined){spawn("shadowed-undefined",[],{stdio:"inherit",...undefined})}
      `,
    });
    const graph = (await analyzeJavaScriptDirectory(surface, cli, root))
      .semantic_graph;
    const expected = new Map<string | null, readonly [string, number | null]>(
      cases.map(([, command, mode, count]) => [command, [mode, count]]),
    );
    for (const extension of ["cjs", "cts"]) {
      expected.set(`${extension}-argv`, ["inherit", null]);
      expected.set(`${extension}-callback`, ["default", null]);
    }
    expected.set("cjs-var-argv", ["inherit", null]);
    expected.set("cjs-hoisted-callback", ["default", null]);
    expected.set("import-equals-argv", ["inherit", null]);
    expected.set("import-equals-callback", ["default", null]);
    expected.set("export-assignment-argv", ["inherit", null]);
    for (const command of opaqueExecCallbackCommands)
      expected.set(command, ["default", null]);
    for (const [command, count] of [
      ["Function-global", 0],
      ["frames-global", 0],
      ["mapped-arguments", 0],
      ["shadowed-undefined", 0],
      ["constructed-argv", null],
      ["cjs-wrapper-argv", null],
      ["annex-b-argv", null],
      ["annex-b-local", null],
      ["export-assignment-annex", null],
    ] as const)
      expected.set(command, ["dynamic", count]);
    const children = graph.nodes.filter(
      (node) => node.kind === "child-process",
    );
    expect(children).toHaveLength(expected.size);
    expect(children.map((child) => child.properties.command).sort()).toEqual(
      [...expected.keys()].sort(),
    );
    const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
    for (const child of children) {
      const command = child.properties.command as string | null;
      const entry = expected.get(command);
      if (entry === undefined) throw new Error(`Unexpected child ${command}`);
      const [mode, count] = entry;
      expect(child.properties.stdio_mode, String(command)).toBe(mode);
      expect(child.properties.argv_count, String(command)).toBe(count);
      expect(child.properties.environment_supplied, String(command)).toBe(
        ["named-argv", "execfile-dynamic"].includes(String(command)),
      );
      expect(child.identity.source_range).not.toBeNull();
      const stdio = graph.relations.filter(
        (relation) =>
          relation.relation === "connects-stdio" &&
          relation.source_node_id === child.node_id,
      );
      expect(stdio, String(command)).toHaveLength(1);
      expect(stdio[0]?.resolution).toBe(
        mode === "dynamic" ? "candidate" : "resolved",
      );
      expect(nodes.get(stdio[0]!.target_node_id)).toMatchObject({
        kind: "stdio",
        properties: { mode },
      });
      const unknowns = graph.unknowns.filter(
        (unknown) =>
          unknown.node_id === child.node_id &&
          unknown.family === "child-process" &&
          unknown.relation_kinds.includes("connects-stdio"),
      );
      expect(unknowns, String(command)).toHaveLength(
        mode === "dynamic" ? 1 : 0,
      );
      if (mode === "dynamic")
        expect(unknowns[0]).toMatchObject({ reason: "unknown-value" });
      expect(
        graph.relations.filter(
          (relation) =>
            relation.relation === "supplies-env" &&
            relation.target_node_id === child.node_id,
        ),
      ).toHaveLength(
        ["named-argv", "execfile-dynamic"].includes(String(command)) ? 1 : 0,
      );
      expect(
        graph.relations.filter(
          (relation) =>
            relation.relation === "supplies-argv" &&
            relation.target_node_id === child.node_id,
        ),
      ).toHaveLength(count === null ? 0 : 1);
    }
    for (const relation of graph.relations) {
      expect(nodes.has(relation.source_node_id)).toBe(true);
      expect(nodes.has(relation.target_node_id)).toBe(true);
    }
  },
);
