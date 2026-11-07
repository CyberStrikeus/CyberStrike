import { expect, it } from "vitest";

import { analyzeCommonJsSemanticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

it("shares required process writes with globals while keeping earlier observations", () => {
  const ir = analyzeCommonJsSemanticFixture(`const proc=require('process');
    process.cwd(); const before=proc.env.BEFORE;
    proc.env={}; const after=process.env.AFTER;`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["BEFORE"]);
});

it("does not propagate replacement-object writes from import-equals direct origins", () => {
  const ir = analyzeCommonJsSemanticFixture(`import fs = require('fs');
    const other=require('fs'); fs={}; fs.readFileSync=custom; other.readFileSync('kept');`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it("retains original import-equals aliases captured before reassignment", () => {
  const ir = analyzeCommonJsSemanticFixture(`import fs = require('fs');
    const alias=fs; const other=require('fs'); fs={}; alias.readFileSync=custom; other.readFileSync('wrong');`);
  expect(ir.configurationOperations).toEqual([]);
});

it("keeps computed namespace calls as unknown receiver escapes", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const fs=require('fs'); fs.hook=custom; fs[key](); fs.readFileSync('wrong');`,
  );
  expect(ir.configurationOperations).toEqual([]);
});

it.each(["(0, fs.readFileSync)", "(assigned = fs.readFileSync)"])(
  "checks captured function validity through %s",
  (value) => {
    const ir =
      analyzeCommonJsSemanticFixture(`const fs=require('fs'); let assigned;
    const saved=${value}; fs.readFileSync=custom; const late=${value}; saved('kept'); late('wrong');`);
    expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
  },
);

it.each(['process.env={MODE:"local"};', "process.argv=[];", "patch(process);"])(
  "shares unbound process object effects with required aliases: %s",
  (write) => {
    const ir =
      analyzeCommonJsSemanticFixture(`${write} const proc=require('process');
    ${write.includes("argv") ? "const arg=proc.argv[2];" : "const mode=proc.env.MODE;"}`);
    expect(ir.configurationOperations).toEqual([]);
  },
);

it.each([
  "function local(process) {process.env={};}",
  "process={}; process.env={};",
])("keeps unrelated process replacements separate: %s", (write) => {
  const ir = analyzeCommonJsSemanticFixture(
    `${write} const proc=require('process'); const mode=proc.env.MODE;`,
  );
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["MODE"]);
});

it("preserves exports captured before a later loader overwrite", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs=require('node:fs'); fs.readFileSync('before');
    const read=fs.readFileSync;
    require('fs').readFileSync('direct-before');
    require=replacement;
    fs.readFileSync('after'); read('saved');
    const late=require('fs'); late.readFileSync('wrong');
    require('fs').readFileSync('also-wrong');
  `);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual([
    "before",
    "direct-before",
    "after",
    "saved",
  ]);
});

it.each([
  `for (;;) { require('fs').readFileSync('wrong'); require=replacement; }`,
  `function run() { require('fs').readFileSync('wrong'); require=replacement; }`,
  `require=replacement; const fs=require('fs'); fs.readFileSync('wrong'); require=again;`,
])(
  "keeps repeated or already replaced loader captures uncertain: %s",
  (source) => {
    expect(
      analyzeCommonJsSemanticFixture(source).configurationOperations,
    ).toEqual([]);
  },
);

it.each([
  ["fs.readFileSync = custom;", "other.readFileSync('wrong');"],
  ["other.readFileSync = custom;", "fs.readFileSync('wrong');"],
  ["patch(fs);", "other.readFileSync('wrong');"],
])(
  "shares require-mode import-equals effects in both directions: %s",
  (write, call) => {
    const ir = analyzeCommonJsSemanticFixture(`import fs = require('node:fs');
    const other = require('fs'); other.readFileSync('before'); ${write} ${call}`);
    expect(ir.configurationOperations.map(({ key }) => key)).toEqual([
      "before",
    ]);
  },
);

it.each([
  "import {readFileSync as read} from 'node:fs';",
  "const {readFileSync:read}=require('node:fs');",
  "const fs=require('fs'); const read=fs.readFileSync;",
])(
  "retains captured native function calls after argument escape: %s",
  (capture) => {
    const ir = analyzeCommonJsSemanticFixture(
      `${capture} observe(read); read('kept');`,
    );
    expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
  },
);

it("distinguishes escaping a method value from escaping its namespace", () => {
  const ir = analyzeCommonJsSemanticFixture(`const fs=require('fs');
    observe(fs.readFileSync); fs.readFileSync('kept');
    observe(fs); fs.readFileSync('wrong');`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it("still invalidates escaped process configuration containers", () => {
  const ir = analyzeCommonJsSemanticFixture(`const proc=require('process');
    observe(proc.env); const mode=proc.env.MODE;`);
  expect(ir.configurationOperations).toEqual([]);
});

it("retains direct require effects without poisoning later cached receivers", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    require('node:fs').readFileSync('first');
    const fs = require('fs'); fs.readFileSync('second');
    require('node:fs').createReadStream('stream');
    require('node:child_process').spawn('tool', []);
    require('node:timers').setTimeout(callback, 1);
    require('node:http').get('http://example.test');
    require('fs').readFileSync = custom;
    require('node:fs').readFileSync('wrong'); fs.readFileSync('wrong');
  `);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual([
    "first",
    "second",
  ]);
  expect(ir.resourceOperations).toHaveLength(1);
  expect(ir.childProcessSpawns).toHaveLength(1);
  expect(ir.timerOperations).toHaveLength(1);
  expect(ir.requestOperations).toHaveLength(1);
});

it.each([
  "const fs = require('fs'); fs.promises.open = custom;",
  "require('node:fs').promises.open = custom;",
  "const fsp = require('fs/promises'); fsp.open = custom;",
])("shares fs.promises object writes with fs/promises: %s", (write) => {
  const ir = analyzeCommonJsSemanticFixture(`
    const before = require('node:fs/promises'); before.open('before');
    ${write}
    const after = require('node:fs/promises'); after.open('wrong');
  `);
  expect(ir.resourceOperations).toHaveLength(1);
});

it.each([
  "require = () => ({ readFileSync() {} });",
  "({ loader: require } = other);",
  "for (require of loaders) {}",
])("rejects provenance from an overwritten ambient loader: %s", (write) => {
  const ir = analyzeCommonJsSemanticFixture(`${write}
    const fs = require('node:fs'); fs.readFileSync('wrong');
    require('node:fs').readFileSync('also-wrong');
  `);
  expect(ir.configurationOperations).toEqual([]);
  const binding = ir.bindings.find(({ name }) => name === "fs");
  expect(binding).toBeDefined();
  expect(binding?.provenance.status).not.toBe("module");
});

it("keeps local loader reassignment separate from the ambient loader", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    function local(require) { require = replacement; }
    const fs = require('node:fs'); fs.readFileSync('kept');
  `);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it("keeps wrapper require separate from global-object property writes", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    globalThis.require = replacement;
    function polyfill(key) { globalThis[key] = replacement; }
    require('node:fs').readFileSync('kept');
  `);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it.each(["import fs from 'node:fs';", "const fs = require('node:fs');"])(
  "retains reads and saved methods before a later write: %s",
  (declaration) => {
    const ir = analyzeCommonJsSemanticFixture(`${declaration}
      fs.readFileSync('before');
      const saved = fs.readFileSync;
      const { readFileSync: destructured } = fs;
      const namespace = fs;
      fs.readFileSync = custom;
      saved('saved'); destructured('destructured');
      namespace.readFileSync('wrong'); fs.readFileSync('wrong');
    `);
    expect(ir.configurationOperations.map(({ key }) => key)).toEqual([
      "before",
      "saved",
      "destructured",
    ]);
  },
);

it.each([
  "const { readFileSync: read } = require('fs');",
  "const read = require('fs').readFileSync;",
])("checks cached module writes at the projected capture: %s", (capture) => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs = require('node:fs');
    const saved = require('fs').readFileSync;
    fs.readFileSync = custom;
    ${capture}
    read('wrong'); saved('saved');
  `);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["saved"]);
});

it("retains captured methods across later escapes without freezing a namespace alias", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs = require('node:fs'); const saved = require('fs').readFileSync;
    const namespace = require('fs'); patch(fs);
    const late = require('fs').readFileSync;
    saved('saved'); late('wrong'); namespace.readFileSync('wrong');
  `);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["saved"]);
});

it("keeps writes in repeated callable and loop activations conservative", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs = require('node:fs');
    function run() { fs.readFileSync('wrong'); fs.readFileSync = custom; }
    for (;;) { const read = require('fs').readFileSync; read('wrong'); fs.readFileSync = custom; }
  `);
  expect(ir.configurationOperations).toEqual([]);
});

it("does not propagate a reassigned local object's writes into cached exports", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `let a = require('node:fs'); const b = require('node:fs'); a = {}; a.readFileSync = custom; b.readFileSync('kept');`,
  );
  expect(ir.configurationOperations).toMatchObject([{ key: "kept" }]);
});

it("shares repeated require mutations for every built-in effect family", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs = require('fs'); const otherFs = require('node:fs'); fs.createReadStream = custom; otherFs.createReadStream('wrong');
    const cp = require('child_process'); const otherCp = require('node:child_process'); cp.spawn = custom; otherCp.spawn('wrong', []);
    const timers = require('timers'); const otherTimers = require('node:timers'); timers.setTimeout = custom; otherTimers.setTimeout(callback, 1);
    const http = require('http'); const otherHttp = require('node:http'); http.get = custom; otherHttp.get('http://wrong.test');
    const proc = require('process'); const otherProc = require('node:process'); proc.env = replacement; const mode = otherProc.env.MODE;
  `);
  expect(ir.configurationOperations).toEqual([]);
  expect(ir.resourceOperations).toEqual([]);
  expect(ir.childProcessSpawns).toEqual([]);
  expect(ir.timerOperations).toEqual([]);
  expect(ir.requestOperations).toEqual([]);
});

it.each(["node:fs", "fs"])(
  "shares repeated built-in require identity across %s",
  (specifier) => {
    const ir = analyzeCommonJsSemanticFixture(
      `const a = require('node:fs'); const b = require('${specifier}'); const alias = b; a.readFileSync = custom; b.createReadStream('kept'); alias.readFileSync('wrong');`,
    );
    expect(ir.configurationOperations).toEqual([]);
    expect(ir.resourceOperations).toMatchObject([
      { method: "createReadStream" },
    ]);
  },
);

it("shares unknown escapes across repeated requires without losing earlier effects", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const a = require('node:fs'); const b = require('fs'); b.readFileSync('before'); patch(a); b.readFileSync('after');`,
  );
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["before"]);
});

it("preserves exact default ESM import mutation paths", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `import fs from 'node:fs'; fs.writeFileSync = custom; fs.readFileSync('kept'); fs.writeFileSync('replaced');`,
  );
  expect(ir.configurationOperations).toMatchObject([
    { kind: "file", key: "kept" },
  ]);
});

it("retains built-in effects before later top-level escapes", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs = require('node:fs'); const cp = require('node:child_process'); const timers = require('node:timers'); const http = require('node:http');
    fs.readFileSync('before'); fs.createReadStream('before'); cp.spawn('tool', []); timers.setTimeout(callback, 1); http.get('http://example.test');
    patch(fs); patch(cp); patch(timers); patch(http);
    fs.readFileSync('after'); fs.createReadStream('after'); cp.spawn('wrong', []); timers.setTimeout(callback, 1); http.get('http://wrong.test');
  `);
  expect(ir.configurationOperations).toMatchObject([{ key: "before" }]);
  expect(ir.resourceOperations).toHaveLength(1);
  expect(ir.childProcessSpawns).toMatchObject([{ command: "tool" }]);
  expect(ir.timerOperations).toHaveLength(1);
  expect(ir.requestOperations).toMatchObject([
    { endpoint: "http://example.test" },
  ]);
});

it.each(["env", "argv"])(
  "does not treat a replaced process %s as configuration",
  (family) => {
    const ir = analyzeCommonJsSemanticFixture(
      `const proc = require('node:process'); proc.${family} = replacement; const value = proc.${family}[${family === "env" ? "'MODE'" : "2"}];`,
    );
    expect(ir.configurationOperations).toEqual([]);
  },
);

it("does not infer temporal safety across repeated callable or loop activations", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const fs = require('node:fs'); function run() { fs.readFileSync('callable'); patch(fs); } for (;;) { fs.readFileSync('loop'); patch(fs); }`,
  );
  expect(ir.configurationOperations).toEqual([]);
});

it("does not recover a replaced method through a subsequent alias", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const fs = require('node:fs'); fs.readFileSync = custom; const read = fs.readFileSync; read('config.json');`,
  );
  expect(ir.configurationOperations).toEqual([]);
});

it.each([
  "fs.readFileSync = custom; fs.createReadStream = custom; cp.spawn = custom; timers.setTimeout = custom; http.get = custom;",
  "patch(fs); patch(cp); patch(timers); patch(http);",
  "const fsAlias = fs; fsAlias.readFileSync = custom; fsAlias.createReadStream = custom; const cpAlias = cp; cpAlias.spawn = custom; timers[key] = custom; delete http.get;",
])("excludes replaced or escaped CommonJS methods: %s", (mutation) => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fs = require('node:fs'); const cp = require('node:child_process');
    const timers = require('node:timers'); const http = require('node:http');
    ${mutation}
    fs.readFileSync('config.json'); fs.createReadStream('config.json');
    cp.spawn('tool', []); timers.setTimeout(callback, 1); http.get('http://example.test');
  `);
  expect(ir.configurationOperations).toEqual([]);
  expect(ir.resourceOperations).toEqual([]);
  expect(ir.childProcessSpawns).toEqual([]);
  expect(ir.timerOperations).toEqual([]);
  expect(ir.requestOperations).toEqual([]);
});

it("preserves unaffected CommonJS methods after sibling property mutation", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const fs = require('node:fs'); fs.writeFileSync = custom; fs.readFileSync('config.json');`,
  );
  expect(ir.configurationOperations).toMatchObject([
    { kind: "file", key: "config.json" },
  ]);
});

it.each([
  `const fs = require("node:fs"); const cp = require("node:child_process");
   const timers = require("node:timers"); const http = require("node:http");
   const read = fs.readFileSync; const launch = cp.spawn;
   const schedule = timers.setTimeout; const get = http.get;`,
  `const fs = require("fs"); const { readFileSync: read } = fs;
   const { spawn: launch } = require("child_process");
   const { setTimeout: schedule } = require("timers");
   const { get } = require("http");`,
])("recovers builtin effects from CommonJS provenance: %s", (declarations) => {
  const ir = analyzeCommonJsSemanticFixture(`${declarations}
    const text = read("config.json", "utf8");
    const stream = fs.createReadStream("config.json"); stream.destroy();
    const child = launch("tool", []); child.kill("SIGTERM");
    const timer = schedule(callback, 10); clearTimeout(timer);
    get("http://example.test");
  `);
  expect(ir.configurationOperations).toMatchObject([
    { kind: "file", key: "config.json" },
  ]);
  expect(
    ir.resourceOperations.map(({ kind, method }) => ({ kind, method })),
  ).toEqual([
    { kind: "acquire", method: "createReadStream" },
    { kind: "release", method: "destroy" },
  ]);
  expect(ir.childProcessSpawns).toMatchObject([
    { method: "spawn", command: "tool" },
  ]);
  expect(ir.childProcessInteractions).toMatchObject([
    { kind: "signal", signalName: "SIGTERM" },
  ]);
  expect(
    ir.timerOperations.map(({ kind, method }) => ({ kind, method })),
  ).toEqual([
    { kind: "schedule", method: "setTimeout" },
    { kind: "cancel", method: "clearTimeout" },
  ]);
  expect(ir.requestOperations).toMatchObject([
    { method: "get", endpoint: "http://example.test" },
  ]);
});

it("does not promote ambiguous or non-namespace CommonJS origins to builtin effects", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    const fake = require("./fs.js"); fake.readFileSync("external");
    const absentDefault = require("node:fs").default; absentDefault.readFileSync("default");
    const { constants } = require("node:fs"); constants.createReadStream("nested");
    let replaced = require("node:fs"); replaced = other; replaced.readFileSync("replaced");
    const mixed = condition ? require("node:fs") : other; mixed.readFileSync("mixed");
    function shadowed(require) { const fs = require("node:fs"); fs.readFileSync("shadowed"); }
  `);
  expect(ir.configurationOperations).toEqual([]);
  expect(ir.resourceOperations).toEqual([]);
});

it("does not assign built-in APIs to unrelated or shadowed bindings", () => {
  const ir = analyzeCommonJsSemanticFixture(`
    import fs from "./fs.js";
    import { constants as constantsFs } from "node:fs";
    fs.createReadStream("config.json");
    constantsFs.createReadStream("config.json");
    function run(fs) { fs.createReadStream("config.json"); }
  `);

  expect(ir.resourceOperations).toEqual([]);
});

it.each([
  `const fs = require('fs'); class Reader { text = fs.readFileSync('wrong'); } fs.readFileSync = custom; new Reader();`,
  `const fs = require('fs'); class Reader { #text = fs.readFileSync('wrong'); } fs.readFileSync = custom; new Reader();`,
  `const fs = require('fs'); fs.__defineGetter__('readFileSync', () => custom); fs.readFileSync('wrong');`,
  `import proc from 'node:process'; proc.env = {}; const value = process.env.MODE;`,
  `import fs from 'node:fs'; fs.readFileSync = custom; const other = require('fs'); other.readFileSync('wrong');`,
])("keeps delayed or replaced built-in identities unknown: %s", (source) => {
  expect(
    analyzeCommonJsSemanticFixture(source).configurationOperations,
  ).toEqual([]);
});

it.each([
  `const fs = require('fs'); const before = fs.readFileSync('kept'), patch = (fs.readFileSync = custom);`,
  `globalThis.process = {env: {}}; process.env = {}; const proc = require('process'); const value = proc.env.kept;`,
  `import fs from 'node:fs'; fs.writeFileSync = custom; const other = require('fs'); other.readFileSync('kept');`,
])("keeps earlier and independent built-in observations: %s", (source) => {
  expect(
    analyzeCommonJsSemanticFixture(source).configurationOperations.map(
      ({ key }) => key,
    ),
  ).toEqual(["kept"]);
});

it("shares equivalent alias subproblems and repeated intact receiver facts", () => {
  const aliases = Array.from({ length: 30 }, (_, index) => {
    const previous = index === 0 ? "fs" : `a${index - 1}`;
    return `const a${index} = flag ? ${previous} : ${previous};`;
  });
  const calls = Array.from(
    { length: 128 },
    (_, index) => `a29.readFileSync('file-${index}');`,
  );
  const ir = analyzeCommonJsSemanticFixture(
    ["const fs = require('fs');", ...aliases, ...calls].join("\n"),
  );
  expect(ir.configurationOperations).toHaveLength(128);
});

it.each([
  `import tls from 'node:tls'; const socket = tls.connect(443, 'example.test'); socket.end();`,
  `import * as tls from 'node:tls'; const socket = tls.connect(443, 'example.test'); socket.end();`,
  `const tls = require('tls'); const socket = tls.connect(443, 'example.test'); socket.end();`,
])("retains TLS acquisitions and their release: %s", (source) => {
  expect(
    analyzeCommonJsSemanticFixture(source).resourceOperations.map(
      ({ kind, method }) => ({ kind, method }),
    ),
  ).toEqual([
    { kind: "acquire", method: "connect" },
    { kind: "release", method: "end" },
  ]);
});

it.each([
  `globalThis.process.env = {}; const proc = require('process'); const value = proc.env.MODE;`,
  `const host = globalThis; host.process.env = {}; const proc = require('process'); const value = proc.env.MODE;`,
  `import * as procNs from 'node:process'; procNs.default.env = {}; const value = process.env.MODE;`,
  `globalThis.process.env = { MODE: 'local' }; const proc = require('process'); const value = proc.env.MODE;`,
  `const proc = require('process'); proc.env.MODE = 'local'; const value = proc.env.MODE;`,
])("shares writes through the original process object: %s", (source) => {
  expect(
    analyzeCommonJsSemanticFixture(source).configurationOperations,
  ).toEqual([]);
});

it.each([
  [
    `const fs = require('fs'); const result = (fs.readFileSync('kept'), fs.readFileSync = custom);`,
    "kept",
  ],
  [
    `const fs = require('fs'); const read = fs.readFileSync; const result = (read('kept'), fs.readFileSync = custom);`,
    "kept",
  ],
  [
    `const fs = require('fs'); consume(fs.readFileSync('before'), fs.readFileSync = custom);`,
    "before",
  ],
])(
  "retains reads before a later sequence operand: %s",
  (source, expectedKey) => {
    expect(
      analyzeCommonJsSemanticFixture(source).configurationOperations.map(
        ({ key }) => key,
      ),
    ).toEqual([expectedKey]);
  },
);

it("does not use source offsets for destructuring assignment evaluation order", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`const fs = require('fs'); const target = {};
    [target[fs.readFileSync('wrong')]] = (fs.readFileSync = custom, []);`);
  expect(ir.configurationOperations).toEqual([]);
});

it("keeps process reads after an alias is reassigned away from the global", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`let host = globalThis; host = {process: {env: {}}};
    host.process.env = {}; const proc = require('process'); const value = proc.env.MODE;`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["MODE"]);
});

it("rejects CommonJS require after the wrapper module replaces its delegate", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`module.require = () => ({ readFileSync() {} });
    const fs = require('node:fs'); fs.readFileSync('unknown');`);
  expect(ir.configurationOperations).toEqual([]);
});

it.each([
  `module.require.extra = true; const fs = require('fs'); fs.readFileSync('kept');`,
  `const owner = module; owner.require = () => ({}); const fs = require('fs'); fs.readFileSync('wrong');`,
  `Object.defineProperty(module, 'require', {value: () => ({})}); const fs = require('fs'); fs.readFileSync('wrong');`,
])("tracks only actual wrapper require replacements: %s", (source) => {
  const ir = analyzeCommonJsSemanticFixture(source);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(
    source.includes("extra") ? ["kept"] : [],
  );
});

it("preserves a saved promises object after deleting its parent export", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`const fs = require('fs'); const fsp = fs.promises;
    delete fs.promises; const handle = fsp.open('kept'); handle.close();`);
  expect(
    ir.resourceOperations.map(({ kind, method }) => ({ kind, method })),
  ).toEqual([
    { kind: "acquire", method: "open" },
    { kind: "release", method: "close" },
  ]);
});

it("does not infer network acquisition methods from another built-in", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const { open } = require('node:net'); open();`,
  );
  expect(ir.resourceOperations).toEqual([]);
});

it("recognizes nested ESM namespace receivers as original built-ins", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`import * as ns from 'node:fs'; import fs from 'node:fs';
    ns.default.readFileSync('first'); fs.readFileSync('second');`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual([
    "first",
    "second",
  ]);
});

it("keeps intact fs/promises identity after deleting the fs.promises slot", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`const fs=require('fs'); delete fs.promises;
    const fsp=require('fs/promises'); const handle=fsp.open('kept'); handle.close();`);
  expect(
    ir.resourceOperations.map(({ kind, method }) => ({ kind, method })),
  ).toEqual([
    { kind: "acquire", method: "open" },
    { kind: "release", method: "close" },
  ]);
});

it.each([
  `import fs from 'node:fs'; fs.promises = { open() {} }; fs.promises.open('wrong');`,
  `const fs = require('fs'); patch(fs.promises); require('fs/promises').open('wrong');`,
  `const fs = require('fs'); patch(fs.promises); require('node:fs/promises').open('wrong');`,
])("keeps replaced or escaped promises receivers unknown: %s", (source) => {
  expect(analyzeCommonJsSemanticFixture(source).resourceOperations).toEqual([]);
});

it("follows final sequence expressions for direct built-in method calls", () => {
  const ir = analyzeCommonJsSemanticFixture(`const fs = require('fs');
    (0, fs.readFileSync)('kept'); fs.readFileSync = custom;
    (0, fs.readFileSync)('wrong');`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it.each([
  `import { env } from 'node:process'; patch(env); process.env.MODE;`,
  `import { argv } from 'node:process'; patch(argv); process.argv[2];`,
])(
  "shares named process containers with their namespace aliases: %s",
  (source) => {
    expect(
      analyzeCommonJsSemanticFixture(source).configurationOperations,
    ).toEqual([]);
  },
);

it("retains uncertainty after a computed write to module's require delegate", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`const key = 'require'; module[key] = replacement;
    const fs = require('fs'); fs.readFileSync('wrong');`);
  expect(ir.configurationOperations).toEqual([]);
});

it("retains a module namespace captured before its binding is reassigned", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`let fs = require('fs'); const saved = fs;
    fs = {}; saved.readFileSync('kept');`);
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it("does not let own fs probe calls hide later builtin reads", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `const fs=require('fs'); fs.existsSync('probe'); fs.readFileSync('kept');`,
  );
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it("resolves nested ESM default namespace methods", () => {
  const ir = analyzeCommonJsSemanticFixture(
    `import * as ns from 'node:fs'; ns.default.readFileSync('kept');`,
  );
  expect(ir.configurationOperations.map(({ key }) => key)).toEqual(["kept"]);
});

it("tracks process objects passed through qualified global references", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`patch(globalThis.process); const proc = require('process');
    const mode = proc.env.MODE;`);
  expect(ir.configurationOperations).toEqual([]);
});

it("checks a saved child object's method when that function is selected", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`const fs = require('fs'); const fsp = fs.promises;
    fs.promises.open = custom; const open = fsp.open; open('wrong');`);
  expect(ir.resourceOperations).toEqual([]);
});

it("retains an earlier captured function after its object method is replaced", () => {
  const ir =
    analyzeCommonJsSemanticFixture(`const fs = require('fs'); const fsp = fs.promises;
    const open = fsp.open; fs.promises.open = custom; open('kept');`);
  expect(ir.resourceOperations).toMatchObject([
    { kind: "acquire", method: "open" },
  ]);
});
