import { describe, expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("retains switch selection on a direct bridge exposure", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    switch (process.platform) {
      case "win32":
        contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
    }
  `);
  expect(result.electron.call_paths?.[0]?.conditions).toEqual([
    expect.objectContaining({
      expression: '((process.platform) === ("win32"))',
    }),
  ]);
});

it("retains a conservative selection for stacked and fallthrough cases", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    switch (platform) {
      case "first": work();
      case "second":
        contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
    }
  `);
  expect(result.electron.call_paths?.[0]?.conditions).toEqual([
    expect.objectContaining({
      expression: '((platform) === ("first")) || ((platform) === ("second"))',
    }),
  ]);
  expect(result.parse_status).toBe("partial");
});

it("includes the default selection when an earlier default can fall through", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    switch (platform) {
      default: work();
      case "second":
        contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
    }
  `);
  expect(result.electron.call_paths?.[0]?.conditions).toEqual([
    expect.objectContaining({
      expression: '((platform) === ("second")) || ((platform) !== ("second"))',
    }),
  ]);
  expect(result.parse_status).toBe("partial");
});

it("retains switch conditions in a traced bridge wrapper", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    contextBridge.exposeInMainWorld("api", {
      ping() { switch (process.platform) { case "win32": return ipcRenderer.invoke("ping"); } }
    });
  `);
  expect(result.electron.call_paths?.[0]?.conditions).toEqual([
    expect.objectContaining({
      expression: '((process.platform) === ("win32"))',
    }),
  ]);
});

it.each(["direct", "wrapped"] as const)(
  "retains the selected case near the end of a switch on a %s path",
  (kind) => {
    const exposure = `contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });`;
    const cases = Array.from(
      { length: 8 },
      (_, index) => `case ${index}:`,
    ).join("\n");
    const selected = `${cases}\ncase 8: ${kind === "direct" ? exposure : 'return ipcRenderer.invoke("ping");'}`;
    const body =
      kind === "direct"
        ? `switch (platform) { ${selected} }`
        : `contextBridge.exposeInMainWorld("api", { ping() { switch (platform) { ${selected} } } });`;
    const result = analyzeJavaScriptStaticSource(`
      const { contextBridge, ipcRenderer } = require("electron");
      ${body}
    `);
    expect(
      result.electron.call_paths?.[0]?.conditions[0]?.expression,
    ).toContain("((platform) === (8))");
  },
);

it("does not invent a selection predicate for dynamic case expressions", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    switch (platform) {
      case mutatePlatform():
        contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
    }
  `);
  expect(result.electron.call_paths?.[0]?.conditions).toEqual([]);
  expect(result.parse_status).toBe("partial");
});

it("retains the continuing predicate after a break to an enclosing label", () => {
  const result = analyzeJavaScriptStaticSource(`const e=require("electron");
    guard: {
      if (!ready) break guard;
      e.ipcMain.on("guarded", event => event.sender.copy());
    }
  `);
  expect(
    result.electron.call_paths?.map(({ conditions }) =>
      conditions.map(({ expression }) => expression),
    ),
  ).toEqual([["!(!ready)"], ["!(!ready)"]]);
});

it("retains a labelled-break guard on preload bridge paths", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    const ready = process.env.APP_READY;
    guard: {
      if (!ready) break guard;
      contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
    }
  `);
  expect(
    result.electron.call_paths?.map(({ conditions }) =>
      conditions.map(({ expression }) => expression),
    ),
  ).toEqual([["!(!ready)"]]);
});

it("does not treat a break to an inner label as an exit from its outer block", () => {
  const result = analyzeJavaScriptStaticSource(`const e=require("electron");
    outer: {
      inner: { if (stop) break inner; }
      e.ipcMain.on("after", event => event.sender.copy());
    }
  `);
  expect(result.electron.call_paths).toHaveLength(1);
  expect(result.electron.call_paths?.[0]?.conditions).toEqual([]);
});

it("preserves every direct observation in a long flat sibling block", () => {
  const channels = Array.from({ length: 256 }, (_, index) => `flat:${index}`);
  const result = analyzeJavaScriptStaticSource(`const e=require("electron"); {
    ${channels.map((channel) => `e.ipcRenderer.send("${channel}");`).join("\n")}
  }`);
  expect(result.electron.ipc.map(({ channel }) => channel)).toEqual(channels);
  expect(result.electron.call_paths ?? []).toEqual([]);
  expect(result.parse_status).toBe("complete");
});

it("keeps sibling guards, definite exits and nested shadowing separate", () => {
  const result = analyzeJavaScriptStaticSource(`const e=require("electron"); {
    if (stop) throw new Error("stop");
    e.ipcMain.on("guarded", event => event.sender.copy());
    {
      const e = {ipcMain: {on() {}}};
      e.ipcMain.on("shadowed", event => event.sender.copy());
    }
    if (true) throw new Error("end");
    e.ipcMain.on("unreachable", event => event.sender.copy());
  }`);
  expect(
    result.electron.call_paths?.map(
      ({ entry, terminal, steps, conditions }) => ({
        entry,
        terminal,
        terminalStart: steps.at(-1)?.location.start,
        conditions: conditions.map(({ expression }) => expression),
      }),
    ),
  ).toEqual([
    {
      entry: "guarded",
      terminal: "electron.ipcMain.on",
      terminalStart: { line: 3, column: 4 },
      conditions: ["!(stop)"],
    },
    {
      entry: "guarded",
      terminal: "ipc-event.sender.copy",
      terminalStart: { line: 3, column: 37 },
      conditions: ["!(stop)"],
    },
  ]);
  // Raw syntax after a definite exit remains an observation, not a reachable
  // callback path. The shadowed ordinary object provides no Electron identity.
  expect(result.electron.ipc.map(({ channel }) => channel)).toEqual([
    "guarded",
    "unreachable",
  ]);
});

it("evaluates shared return syntax separately for each invocation environment", () => {
  const result = analyzeJavaScriptStaticSource(`const e=require("electron");
    function install(channel, enabled) {
      if (!enabled) return;
      e.ipcMain.on(channel, event => event.sender.copy());
    }
    install("enabled", true);
    install("disabled", false);
    install("uncertain", externalFlag);
  `);
  expect(
    result.electron.call_paths?.map(
      ({ entry, terminal, steps, conditions }) => ({
        entry,
        terminal,
        invocationStart: steps[0]?.location.start,
        conditions: conditions.map(({ expression }) => expression),
      }),
    ),
  ).toEqual([
    {
      entry: "enabled",
      terminal: "ipc-event.sender.copy",
      invocationStart: { line: 6, column: 4 },
      conditions: [],
    },
    {
      entry: "uncertain",
      terminal: "electron.ipcMain.on",
      invocationStart: { line: 8, column: 4 },
      conditions: ["!(!enabled)"],
    },
    {
      entry: "uncertain",
      terminal: "ipc-event.sender.copy",
      invocationStart: { line: 8, column: 4 },
      conditions: ["!(!enabled)"],
    },
  ]);
  expect(result.parse_status).toBe("partial");
});

const bundle = (entry: string) => `(() => {
 const modules = {
  2(module) { module.exports = require("electron"); },
  5(module,exports,load) {
   const electron=load(2);
   Object.defineProperty(exports,"__esModule",{value:true});
   exports.sender = function(channel) {return (...args)=>send(channel,...args)};
   function send(channel,...args) {electron.ipcRenderer.send(channel,...args)}
   exports.events = {addListener(channel,handler) {
    const guarded = (event,...args) => {if (allowed(event)) handler(event,...args)};
    return electron.ipcMain.addListener(channel,guarded);
   }};
  },
  9(module,exports,load) {const electron=load(2), helper=load(5); ${entry}}
 };
 function load(id) {const m={exports:{}};modules[id].call(m.exports,m,m.exports,load);return m.exports;}
 load(9);
})();`;

describe("wrapped Electron control-flow alternatives", () => {
  it.each(["flag ? copy : cut", "flag ? copy : unknownHandler", "choose()"])(
    "does not select one IPC handler from %s",
    (handler) => {
      const result = analyzeJavaScriptStaticSource(`
        const e = require("electron");
        const copy = event => event.sender.copy();
        const cut = event => event.sender.cut();
        function choose() { if (flag) return copy; }
        function register(channel, handler) { e.ipcMain.on(channel, handler); }
        register("test:copy", ${handler});
      `);
      expect(result.electron.ipc).toContainEqual(
        expect.objectContaining({
          channel: "test:copy",
          side: "main",
          handler_kind: "dynamic-expression",
          resolution_basis: "wrapper-substitution",
        }),
      );
      expect(result.electron.call_paths ?? []).toEqual([]);
      expect(result.parse_status).toBe("partial");
    },
  );
  it.each(["'ready'", "false", "0", "''", "({})", "(()=>{})"])(
    "short-circuits nullish fallback for %s in callbacks and seed calls",
    (left) => {
      for (const source of [
        `e.ipcMain.on("test:copy", event => { ${left} ?? event.sender.copy(); });`,
        `${left} ?? e.ipcMain.on("test:copy", event => event.sender.copy());`,
        `e.ipcMain.on("test:copy", event => { const selected = ${left} ?? (()=>event.sender.copy()); selected(); });`,
      ])
        expect(
          analyzeJavaScriptStaticSource(`const e=require("electron");${source}`)
            .electron.call_paths ?? [],
        ).toEqual([]);
    },
  );
  it.each(["null", "undefined", "void 0"])(
    "follows nullish fallback for %s",
    (left) => {
      const result = analyzeJavaScriptStaticSource(`const e=require("electron");
        ${left} ?? e.ipcMain.on("test:copy", event => { ${left} ?? event.sender.copy(); });`);
      expect(result.electron.call_paths).toContainEqual(
        expect.objectContaining({
          terminal: "ipc-event.sender.copy",
          conditions: [],
        }),
      );
    },
  );
  it("retains a nullish guard for unknown fallback rather than a falsy guard", () => {
    for (const source of [
      `e.ipcMain.on("test:copy", event => { value ?? event.sender.copy(); });`,
      `value ?? e.ipcMain.on("test:copy", event => event.sender.copy());`,
    ]) {
      const result = analyzeJavaScriptStaticSource(
        `const e=require("electron");${source}`,
      );
      expect(result.electron.call_paths).toContainEqual(
        expect.objectContaining({
          terminal: "ipc-event.sender.copy",
          conditions: [
            expect.objectContaining({
              expression: "(value) === null || (value) === undefined",
            }),
          ],
        }),
      );
    }
  });
  it.each([
    "if (flag) return copy; else return cut; return dead;",
    "if (flag) { return copy; } return cut;",
    "if (flag) { if (other) return copy; else return cut; } else return cut; return dead;",
  ])("retains every possible factory return: %s", (body) => {
    const result = analyzeJavaScriptStaticSource(`const e=require("electron");
      const copy=()=>e.ipcRenderer.send("test:copy"), cut=()=>e.ipcRenderer.send("test:cut"), dead=()=>e.ipcRenderer.send("test:dead");
      function choose(){${body}}
      e.contextBridge.exposeInMainWorld("desktop", {copy:choose()});`);
    expect(
      [
        ...new Set(result.electron.call_paths?.map((path) => path.channel)),
      ].sort(),
    ).toEqual(["test:copy", "test:cut"]);
    const paths = result.electron.call_paths ?? [];
    expect(
      paths
        .find(({ channel }) => channel === "test:copy")
        ?.conditions.map(({ expression }) => expression),
    ).toContain("flag");
    expect(
      paths
        .filter(({ channel }) => channel === "test:cut")
        .some((path) =>
          path.conditions.some(({ expression }) => expression === "!(flag)"),
        ),
    ).toBe(true);
  });
});

it("preserves an observed empty contextBridge API object", () => {
  const result = analyzeJavaScriptStaticSource(`
      const electron = require("electron");
      electron.contextBridge.exposeInMainWorld("desktop", {});
    `);
  expect(result.electron.context_bridge_apis).toContainEqual(
    expect.objectContaining({
      api_key: "desktop",
      api_status: "object-literal",
      members: [],
      unknown_members: 0,
    }),
  );
  expect(result.electron.context_bridge_apis?.[0]).not.toHaveProperty(
    "resolution_basis",
  );
  expect(result.parse_status).toBe("complete");
});

it.each([
  [
    "explicit nested paths after an unknown spread",
    `{ ...extra, a: { b: 1 }, c: 2 }`,
    ["a", "a.b", "c"],
    1,
    "dynamic",
  ],
  [
    "a direct object literal",
    `{ a: { b: 1 }, c: 2 }`,
    ["a", "a.b", "c"],
    0,
    "object-literal",
  ],
  ["a dynamic API argument", "getApi()", [], 1, "dynamic"],
] as const)(
  "preserves directly observed nested bridge members for %s",
  (_name, api, members, unknownMembers, apiStatus) => {
    const result = analyzeJavaScriptStaticSource(`
      const { contextBridge } = require("electron");
      contextBridge.exposeInMainWorld("api", ${api});
    `);
    expect(result.electron.context_bridge_apis).toContainEqual(
      expect.objectContaining({
        api_key: "api",
        api_status: apiStatus,
        members,
        unknown_members: unknownMembers,
      }),
    );
  },
);

describe("wrapped contextBridge exposure methods", () => {
  it("retains the original expression for a dynamic isolated world id", () => {
    const result = analyzeJavaScriptStaticSource(
      bundle(
        `const worldId = selectWorld(); electron.contextBridge.exposeInIsolatedWorld(worldId, "isolatedApi", {ping: true});`,
      ),
    );
    // The proven Webpack bootstrap resolves `load(2)` directly, so the complete
    // direct observation is retained instead of a wrapper substitution.
    expect(result.electron.context_bridge_apis).toEqual([
      expect.objectContaining({
        world: "isolated",
        world_id: {
          status: "dynamic",
          value: null,
          expression: "worldId",
        },
        api_key: "isolatedApi",
        api_status: "object-literal",
        members: ["ping"],
        unknown_members: 0,
        module_key: "9",
        module_runtime: "webpack-bootstrap@0",
      }),
    ]);
    expect(result.electron.context_bridge_apis[0]).not.toHaveProperty(
      "resolution_basis",
    );
    expect(result.parse_status).toBe("partial");
  });

  it("does not report a conditionally selected world as unconditional", () => {
    const result = analyzeJavaScriptStaticSource(
      bundle(
        `if (useIsolated) electron.contextBridge.exposeInIsolatedWorld(1001, "isolatedApi", {ping: true});`,
      ),
    );
    expect(result.electron.context_bridge_apis).not.toContainEqual(
      expect.objectContaining({
        api_key: "isolatedApi",
        resolution_basis: "wrapper-substitution",
      }),
    );
    expect(result.parse_status).toBe("partial");
  });

  it("does not report conditionally resolved world ids as unconditional", () => {
    const result = analyzeJavaScriptStaticSource(
      bundle(
        `const worldId = useFirstWorld ? 1001 : 1002; electron.contextBridge.exposeInIsolatedWorld(worldId, "isolatedApi", {ping: true});`,
      ),
    );
    expect(result.electron.context_bridge_apis).not.toContainEqual(
      expect.objectContaining({
        api_key: "isolatedApi",
        resolution_basis: "wrapper-substitution",
      }),
    );
    expect(result.parse_status).toBe("partial");
  });
});

describe("contextBridge helper invocations", () => {
  const exposures = (source: string) => {
    const result = analyzeJavaScriptStaticSource(`
      const { contextBridge, ipcRenderer } = require("electron");
      ${source}`);
    return {
      result,
      apis: result.electron.context_bridge_apis.map(
        ({
          api_key,
          api_key_expression,
          world_id,
          members,
          unknown_members,
        }) => ({
          api_key,
          api_key_expression,
          world_id,
          members,
          unknown_members,
        }),
      ),
    };
  };
  const literalKey = { api_key_expression: null, world_id: null };

  it("binds a site-literal object to each invocation's key", () => {
    const { apis } = exposures(`
      function expose(key) { contextBridge.exposeInMainWorld(key, { ping() {} }); }
      expose("one"); expose("two");`);
    expect(apis).toEqual([
      { api_key: "one", ...literalKey, members: ["ping"], unknown_members: 0 },
      { api_key: "two", ...literalKey, members: ["ping"], unknown_members: 0 },
    ]);
  });

  it("counts a repeated identical invocation once", () => {
    const { apis } = exposures(`
      function expose(key, api) { contextBridge.exposeInMainWorld(key, api); }
      const api = { ping() {} };
      expose("one", api); expose("one", api);`);
    expect(apis).toEqual([
      { api_key: "one", ...literalKey, members: ["ping"], unknown_members: 0 },
    ]);
  });

  it("describes one key's alternative objects as one exposure", () => {
    const { apis } = exposures(`
      function expose(key, api) { contextBridge.exposeInMainWorld(key, api); }
      expose("api", { a() {} });
      expose("api", { ...globalThis.extra, b: { c() {} } });`);
    expect(apis).toEqual([
      {
        api_key: "api",
        ...literalKey,
        members: ["a", "b", "b.c"],
        unknown_members: 1,
      },
    ]);
  });

  it("keeps one key's differing world ids unknown", () => {
    const { apis, result } = exposures(`
      function expose(key, id, api) { contextBridge.exposeInIsolatedWorld(id, key, api); }
      expose("api", 1, { a() {} }); expose("api", 2, { b() {} });`);
    expect(apis).toEqual([
      {
        api_key: "api",
        api_key_expression: null,
        world_id: { status: "dynamic", value: null, expression: "id" },
        members: ["a", "b"],
        unknown_members: 0,
      },
    ]);
    expect(result.parse_status).toBe("partial");
  });

  it("bounds nested member paths at the direct syntax depth", () => {
    const deep = `{ a: { b: { c: { d: { e: { f: { g: { h: { i: {} } } } } } } } } }`;
    const { apis } = exposures(`
      function expose(key, api) { contextBridge.exposeInMainWorld(key, api); }
      expose("helper", ${deep});
      contextBridge.exposeInMainWorld("direct", ${deep});`);
    const paths = ["a", "a.b", "a.b.c", "a.b.c.d", "a.b.c.d.e"];
    const members = [
      ...paths,
      "a.b.c.d.e.f",
      "a.b.c.d.e.f.g",
      "a.b.c.d.e.f.g.h",
    ];
    expect(apis).toEqual([
      { api_key: "helper", ...literalKey, members, unknown_members: 1 },
      { api_key: "direct", ...literalKey, members, unknown_members: 1 },
    ]);
  });

  it("keeps the site observation for a guarded invocation", () => {
    const { apis } = exposures(`
      function expose(key, api) { contextBridge.exposeInMainWorld(key, api); }
      expose("one", { ping() {} });
      if (globalThis.flag) expose("two", { pong() {} });`);
    expect(apis).toEqual([
      {
        api_key: null,
        api_key_expression: "key",
        world_id: null,
        members: [],
        unknown_members: 1,
      },
      { api_key: "one", ...literalKey, members: ["ping"], unknown_members: 0 },
    ]);
  });

  it("keeps a site-literal key singular beside a guarded invocation", () => {
    const { apis } = exposures(`
      function expose(api) { contextBridge.exposeInMainWorld("fixed", api); }
      function relay(label, api) { expose(api); }
      relay("label", { ping() {} });
      if (globalThis.flag) relay("label", { pong() {} });`);
    // The site's own scope leaves the API unknown; the guarded object is not
    // recorded as an unconditional member.
    expect(apis).toEqual([
      {
        api_key: "fixed",
        ...literalKey,
        members: ["ping"],
        unknown_members: 1,
      },
    ]);
  });
});

it("connects exposed closures to IPC sends and text clipboard calls", () => {
  const result = analyzeJavaScriptStaticSource(
    bundle(`
   const text = value => navigator.clipboard.writeText(value);
   const api={copy:helper.sender("example:copy"),copyText:text};
   electron.contextBridge.exposeInMainWorld("desktop",api);
  `),
  );
  expect(result.electron.context_bridge_apis).toMatchObject([
    { api_key: "desktop", members: ["copy", "copyText"] },
  ]);
  expect(result.electron.ipc).toContainEqual(
    expect.objectContaining({
      side: "renderer",
      channel: "example:copy",
      operation: "send",
    }),
  );
  expect(result.electron.call_paths).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entry: "desktop.copy",
        channel: "example:copy",
        terminal: "electron.ipcRenderer.send",
      }),
      expect.objectContaining({
        entry: "desktop.copyText",
        terminal: "navigator.clipboard.writeText",
      }),
    ]),
  );
  const ipcFinding = result.electron.ipc.find(
    ({ channel }) => channel === "example:copy",
  );
  const ipcPath = result.electron.call_paths?.find(
    ({ entry }) => entry === "desktop.copy",
  );
  expect(ipcFinding).toBeDefined();
  expect(ipcPath?.steps.at(-1)).toBeDefined();
  expect(ipcFinding?.location).toEqual(ipcPath?.steps.at(-1)?.location);
});
it("resolves a helper factory listed after its bundle consumer", () => {
  const result = analyzeJavaScriptStaticSource(`(() => {
      const modules = {
        2(module) { module.exports = require("electron"); },
        9(module,exports,load) {
          const electron=load(2),helper=load(5);
          electron.contextBridge.exposeInMainWorld("desktop", {copy:helper.sender("after:copy")});
        },
        5(module,exports,load) {
          const electron=load(2);
          exports.sender=channel=>()=>electron.ipcRenderer.send(channel);
        }
      };
      function load(id) { const m={exports:{}}; modules[id].call(m.exports,m,m.exports,load); return m.exports; }
      load(9);
    })();`);
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({
      entry: "desktop.copy",
      channel: "after:copy",
      terminal: "electron.ipcRenderer.send",
    }),
  );
});
it("substitutes guarded listener callbacks and preserves guard evidence", () => {
  const result = analyzeJavaScriptStaticSource(
    bundle(
      `helper.events.addListener("example:copy",event=>event.sender.copy());`,
    ),
  );
  expect(result.electron.ipc).toContainEqual(
    expect.objectContaining({
      side: "main",
      channel: "example:copy",
      operation: "on",
    }),
  );
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({
      entry_kind: "ipc-handler",
      channel: "example:copy",
      terminal: "ipc-event.sender.copy",
      conditions: [expect.objectContaining({ expression: "allowed(event)" })],
    }),
  );
  const ipcFinding = result.electron.ipc.find(
    ({ channel, operation }) =>
      channel === "example:copy" && operation === "on",
  );
  const ipcStep = result.electron.call_paths
    ?.find(({ entry_kind }) => entry_kind === "ipc-handler")
    ?.steps.find(({ kind }) => kind === "ipc");
  expect(ipcFinding).toBeDefined();
  expect(ipcStep).toBeDefined();
  expect(ipcFinding?.location).toEqual(ipcStep?.location);
});
it("retains distinct wrapper invocation ranges for one IPC API source", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const copy=event=>event.sender.copy();
      function register(channel,handler){e.ipcMain.on(channel,handler);}
      register("same:channel",copy);
      register("same:channel",copy);
    `);
  const findings = result.electron.ipc.filter(
    ({ resolution_basis, channel }) =>
      resolution_basis === "wrapper-substitution" && channel === "same:channel",
  );
  expect(findings).toHaveLength(2);
  expect(findings[0]?.location).toEqual(findings[1]?.location);
  expect(findings[0]?.invocation_location).toBeDefined();
  expect(findings[1]?.invocation_location).toBeDefined();
  expect(findings[0]?.invocation_location).not.toEqual(
    findings[1]?.invocation_location,
  );
});
it("keeps one wrapper registration when one invocation reaches it twice", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const copy=event=>event.sender.copy();
      function register(channel,handler){e.ipcMain.on(channel,handler);}
      function twice(channel){register(channel,copy);register(channel,copy);}
      twice("same:invocation");
    `);
  expect(
    result.electron.ipc.filter(
      ({ resolution_basis, channel }) =>
        resolution_basis === "wrapper-substitution" &&
        channel === "same:invocation",
    ),
  ).toHaveLength(1);
});
it("keeps a directly observed renderer operation singular when tracing its exposed callback", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    contextBridge.exposeInMainWorld("desktop",{ping:()=>ipcRenderer.invoke("ping")});
  `);
  expect(result.electron.ipc).toHaveLength(1);
  expect(result.electron.ipc[0]).toMatchObject({
    channel: "ping",
    operation: "invoke",
  });
  expect(result.electron.ipc[0]).not.toHaveProperty("resolution_basis");
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({ entry: "desktop.ping", channel: "ping" }),
  );
});
it("resolves a site-determined constant channel in place of its dynamic observation", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    const PING = "ping";
    contextBridge.exposeInMainWorld("desktop",{ping:()=>ipcRenderer.send(PING)});
  `);
  expect(result.electron.ipc).toEqual([
    expect.objectContaining({
      side: "renderer",
      operation: "send",
      channel: "ping",
      resolution_basis: "wrapper-substitution",
    }),
  ]);
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({ entry: "desktop.ping", channel: "ping" }),
  );
  // The syntax pass's unknown channel is resolved, not left as partial.
  expect(result.parse_status).toBe("complete");
});
it("resolves a site-determined registration whose handler is a named local", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    const CH = "ch";
    const handler = () => {};
    contextBridge.exposeInMainWorld("desktop",{on:()=>ipcRenderer.on(CH, handler)});
  `);
  expect(result.electron.ipc).toEqual([
    expect.objectContaining({
      side: "renderer",
      mode: "listen",
      channel: "ch",
      handler_kind: "inline-function",
    }),
  ]);
  expect(result.parse_status).toBe("complete");
});
it("keeps an argument-supplied channel unresolved beside its resolved candidates", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    const forward = channel => ipcRenderer.send(channel);
    contextBridge.exposeInMainWorld("desktop",{
      a:()=>forward("a"),
      b:()=>forward("b"),
      any:name=>forward(name),
    });
  `);
  const sends = result.electron.ipc.filter(
    ({ side, operation }) => side === "renderer" && operation === "send",
  );
  expect(sends.map(({ channel }) => channel).sort()).toEqual(["a", "b", null]);
  expect(
    new Set(sends.map(({ location }) => JSON.stringify(location))).size,
  ).toBe(1);
});
it.each([
  [
    "an exposed member",
    `const forward = (channel, callback) => ipcRenderer.on(channel, callback);
     contextBridge.exposeInMainWorld("desktop",{on:()=>forward("pong",()=>{})});`,
  ],
  [
    "an enclosing local call",
    `const forward = (channel, callback) => ipcRenderer.on(channel, callback);
     const notify = kind => forward("pong", () => {});
     notify("ready");`,
  ],
])(
  "keeps one invocation of a wrapper call also reached through %s",
  (_, entry) => {
    const result = analyzeJavaScriptStaticSource(`
      const {contextBridge,ipcRenderer}=require("electron");
      ${entry}
    `);
    expect(
      result.electron.ipc.filter(({ channel }) => channel === "pong"),
    ).toHaveLength(1);
  },
);
it("keeps distinct handlers that separate outer calls pass through one wrapper call", () => {
  const result = analyzeJavaScriptStaticSource(`
    const e = require("electron");
    function register(channel, handler) { e.ipcMain.on(channel, handler); }
    function setup(tag, handler) { register("same", handler); }
    setup("first", () => 1);
    setup("second", () => 2);
  `);
  const registrations = result.electron.ipc.filter(
    ({ channel }) => channel === "same",
  );
  // The wrapper call traced alone has an unresolved handler; each outer call
  // supplies its own concrete handler.
  expect(registrations.map(({ handler_kind }) => handler_kind).sort()).toEqual([
    "dynamic-expression",
    "inline-function",
    "inline-function",
  ]);
  expect(
    new Set(
      registrations.map(({ handler_location }) =>
        JSON.stringify(handler_location),
      ),
    ).size,
  ).toBe(3);
});
it("keeps the source registration when only its channel is site-determined", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { ipcMain } = require("electron");
    const CH = "ch";
    function register(seed, handler) { ipcMain.on(CH, handler); }
    register("seed", () => 1);
  `);
  expect(
    result.electron.ipc.map(({ channel, handler_kind, resolution_basis }) => [
      channel,
      handler_kind,
      resolution_basis ?? "direct",
    ]),
  ).toEqual([
    [null, "identifier", "direct"],
    ["ch", "inline-function", "wrapper-substitution"],
  ]);
});
it.each([
  [
    "a closure over a wrapper parameter",
    `function register(seed) {
       const handler = () => ipcRenderer.send(seed);
       ipcRenderer.on(CH, handler);
     }`,
  ],
  [
    "an arrow function reading its wrapper's arguments",
    `function register(seed) {
       const handler = () => arguments[0];
       ipcRenderer.on(CH, handler);
     }`,
  ],
  [
    "an arrow function reading its wrapper's new.target",
    `function register(seed) {
       const handler = () => new.target;
       ipcRenderer.on(CH, handler);
     }`,
  ],
  [
    "a closure returned from a factory of a wrapper parameter",
    `const make = value => () => value;
     function register(seed) {
       const handler = make(seed);
       ipcRenderer.on(CH, handler);
     }`,
  ],
])("keeps distinct listeners when one handler node is %s", (_, wrapper) => {
  const result = analyzeJavaScriptStaticSource(`
      const { contextBridge, ipcRenderer } = require("electron");
      const CH = "ch", A = "a", B = "b";
      ${wrapper}
      contextBridge.exposeInMainWorld("first", { on: () => register(A) });
      contextBridge.exposeInMainWorld("second", { on: () => register(B) });
    `);
  // Each invocation installs its own closure; the direct source observation
  // stays for callers this pass does not trace.
  expect(
    result.electron.ipc
      .filter(({ mode }) => mode === "listen")
      .map(({ channel, resolution_basis }) => [
        channel,
        resolution_basis ?? "direct",
      ]),
  ).toEqual([
    [null, "direct"],
    ["ch", "wrapper-substitution"],
    ["ch", "wrapper-substitution"],
  ]);
  expect(
    (result.electron.call_paths ?? [])
      .filter(({ channel }) => channel === "ch")
      .map(({ entry }) => entry)
      .sort(),
  ).toEqual(["first.on", "second.on"]);
});
it("resolves a bundle module's handler in place as one shared listener", () => {
  const result = analyzeJavaScriptStaticSource(
    bundle(`const CH = "ch";
      const handler = () => electron.ipcRenderer.send("reply");
      electron.contextBridge.exposeInMainWorld("api", {
        on: () => electron.ipcRenderer.on(CH, handler),
      });`),
  );
  expect(
    result.electron.ipc
      .filter(({ mode, module_key }) => mode === "listen" && module_key === "9")
      .map(({ channel, resolution_basis }) => [
        channel,
        resolution_basis ?? "direct",
      ]),
  ).toEqual([["ch", "wrapper-substitution"]]);
});
it("resolves an arrow handler in place when its inherited this is module scope", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    const CH = "ch";
    const register = () => {
      const handler = () => this;
      ipcRenderer.on(CH, handler);
    };
    contextBridge.exposeInMainWorld("api", { on: () => register() });
  `);
  expect(
    result.electron.ipc
      .filter(({ mode }) => mode === "listen")
      .map(({ channel, resolution_basis }) => [
        channel,
        resolution_basis ?? "direct",
      ]),
  ).toEqual([["ch", "wrapper-substitution"]]);
});
it.each(["interface Shape { marker(): void }", "type Shape = typeof marker;"])(
  "does not give a handler invocation identity through erased syntax: %s",
  (declaration) => {
    const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    const CH = "ch";
    function register(marker) {
      const handler = () => { ${declaration} };
      ipcRenderer.on(CH, handler);
    }
    contextBridge.exposeInMainWorld("api", { on: () => register("unused") });
  `);
    expect(
      result.electron.ipc
        .filter(({ mode }) => mode === "listen")
        .map(({ channel, resolution_basis }) => [
          channel,
          resolution_basis ?? "direct",
        ]),
    ).toEqual([["ch", "wrapper-substitution"]]);
    expect(result.parse_status).toBe("complete");
  },
);
it("resolves a handler a module-level factory call created once in place", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { ipcMain } = require("electron");
    const CH = "ch";
    const make = () => { const value = Math.random(); return () => value; };
    const handler = make();
    function register(seed) { ipcMain.on(CH, handler); }
    register("x");
  `);
  expect(
    result.electron.ipc.map(({ channel, resolution_basis }) => [
      channel,
      resolution_basis ?? "direct",
    ]),
  ).toEqual([["ch", "wrapper-substitution"]]);
  expect(result.parse_status).toBe("complete");
});
it("keeps separate outer calls that pass one shared handler through a wrapper", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { ipcMain } = require("electron");
    const copy = () => {};
    function register(ch, handler) { ipcMain.on(ch, handler); }
    function setup(tag) { register("same", copy); }
    setup("first");
    setup("second");
  `);
  const registrations = result.electron.ipc.filter(
    ({ channel }) => channel === "same",
  );
  // The shorter entry traced the same wrapper call alone; both outer calls
  // supersede it as distinct invocations.
  expect(registrations).toHaveLength(2);
  expect(
    new Set(
      registrations.map(({ invocation_location }) =>
        JSON.stringify(invocation_location),
      ),
    ).size,
  ).toBe(2);
});
it("keeps a parameterless factory's closure as a per-invocation handler", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    const CH = "ch";
    const make = () => { const value = Math.random(); return () => value; };
    function register() {
      const handler = make();
      ipcRenderer.on(CH, handler);
    }
    contextBridge.exposeInMainWorld("api", { on: () => register() });
  `);
  expect(
    result.electron.ipc
      .filter(({ mode }) => mode === "listen")
      .map(({ resolution_basis }) => resolution_basis ?? "direct"),
  ).toEqual(["direct", "wrapper-substitution"]);
});
it("resolves a module-level handler in place when the entry binds an unused parameter", () => {
  const result = analyzeJavaScriptStaticSource(`
    const { contextBridge, ipcRenderer } = require("electron");
    const CH = "ch";
    const handler = () => {};
    contextBridge.exposeInMainWorld("api", {
      on: unused => ipcRenderer.on(CH, handler),
    });
  `);
  expect(result.electron.ipc).toEqual([
    expect.objectContaining({
      mode: "listen",
      channel: "ch",
      resolution_basis: "wrapper-substitution",
    }),
  ]);
  expect(result.parse_status).toBe("complete");
});
it.each([
  ["a named local", 'const handler = () => tag; register("same", handler);'],
  ["an inline argument", 'register("same", () => tag);'],
  [
    "a nested helper",
    'const inner = () => register("same", () => tag); inner();',
  ],
])("keeps closures that separate outer calls create through %s", (_, body) => {
  const result = analyzeJavaScriptStaticSource(`
      const { ipcMain } = require("electron");
      function register(ch, handler) { ipcMain.on(ch, handler); }
      function setup(tag) { ${body} }
      setup("first");
      setup("second");
    `);
  const invocations = result.electron.ipc
    .filter(
      ({ channel, resolution_basis }) =>
        channel === "same" && resolution_basis === "wrapper-substitution",
    )
    .map(({ invocation_location }) => JSON.stringify(invocation_location));
  // Both outer calls stay, beside the shorter entry that traced the same
  // wrapper call without either caller's value.
  expect(new Set(invocations).size).toBe(3);
});
it("counts one exposed renderer listener callsite once and retains its bridge path", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    contextBridge.exposeInMainWorld("desktop", {
      onPong: callback => ipcRenderer.on("pong", callback),
    });
  `);
  expect(
    result.electron.ipc.filter(
      ({ side, mode, channel }) =>
        side === "renderer" && mode === "listen" && channel === "pong",
    ),
  ).toHaveLength(1);
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({
      entry: "desktop.onPong",
      channel: "pong",
      terminal: "electron.ipcRenderer.on",
    }),
  );
});
it("keeps separate bridge callers while counting their shared listener callsite once", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    const subscribe = callback => ipcRenderer.once("pong", callback);
    contextBridge.exposeInMainWorld("desktop", {
      onPong: subscribe,
      onPongAgain: subscribe,
    });
  `);
  const listeners = result.electron.ipc.filter(
    ({ side, mode, channel }) =>
      side === "renderer" && mode === "listen" && channel === "pong",
  );
  expect(listeners).toHaveLength(1);
  expect(listeners[0]?.operation).toBe("once");
  expect(
    result.electron.call_paths
      ?.filter(({ channel }) => channel === "pong")
      .map(({ entry }) => entry),
  ).toEqual(["desktop.onPong", "desktop.onPongAgain"]);
});
it("keeps distinct exposed renderer listener callsites distinct", () => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge,ipcRenderer}=require("electron");
    contextBridge.exposeInMainWorld("desktop", {
      onPong: callback => ipcRenderer.on("pong", callback),
      onPongAgain: callback => ipcRenderer.on("pong", callback),
    });
  `);
  expect(
    result.electron.ipc.filter(
      ({ side, mode, channel }) =>
        side === "renderer" && mode === "listen" && channel === "pong",
    ),
  ).toHaveLength(2);
  expect(
    result.electron.call_paths?.filter(({ channel }) => channel === "pong"),
  ).toHaveLength(2);
});
it("does not identify overwritten Electron namespaces or shadowed require", () => {
  for (const source of [
    `const e=require("electron");e.ipcMain={on(){}};e.ipcMain.on("bad",event=>event.sender.copy());`,
    `function require(){return {ipcMain:{on(){}}}};const e=require("electron");e.ipcMain.on("bad",event=>event.sender.copy());`,
  ])
    expect(
      analyzeJavaScriptStaticSource(source).electron.call_paths ?? [],
    ).toEqual([]);
});
it("preserves guarded alternatives in direct exposed object literals", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const copy=()=>e.ipcRenderer.send("copy");
      const cut=()=>e.ipcRenderer.send("cut");
      e.contextBridge.exposeInMainWorld("desktop", {action: flag ? copy : cut});
    `);
  expect(result.electron.call_paths).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entry: "desktop.action",
        channel: "copy",
        conditions: [expect.objectContaining({ expression: "flag" })],
      }),
      expect.objectContaining({
        entry: "desktop.action",
        channel: "cut",
        conditions: [expect.objectContaining({ expression: "!(flag)" })],
      }),
    ]),
  );
});
it("preserves bridge member segments and excludes prototype setters", () => {
  const result = analyzeJavaScriptStaticSource(`
    const e=require("electron");
    const write=()=>e.ipcRenderer.send("write");
    e.contextBridge.exposeInMainWorld("desktop", {
      "nested.write": write,
      nested: { write },
      __proto__: { inherited: write },
      ["__proto__"]: { own: write },
    });
  `);
  expect(result.electron.call_paths).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entry: "desktop.nested.write",
        entry_path: ["desktop", "nested.write"],
      }),
      expect.objectContaining({
        entry: "desktop.nested.write",
        entry_path: ["desktop", "nested", "write"],
      }),
      expect.objectContaining({
        entry: "desktop.__proto__.own",
        entry_path: ["desktop", "__proto__", "own"],
      }),
    ]),
  );
  expect(result.electron.call_paths).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entry_path: ["desktop", "__proto__", "inherited"],
      }),
    ]),
  );
});
it("follows an explicit object-literal prototype lookup in a bridge wrapper", () => {
  const result = analyzeJavaScriptStaticSource(`
    const e=require("electron");
    const prototype={send:()=>e.ipcRenderer.send("through-prototype")};
    const object={__proto__:prototype};
    e.contextBridge.exposeInMainWorld("desktop", {
      action:()=>object.__proto__.send(),
    });
  `);
  expect(result.electron.call_paths).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entry_path: ["desktop", "action"],
        channel: "through-prototype",
      }),
    ]),
  );
});
it("does not spread a large nested bridge member list into function arguments", () => {
  const members = Array.from(
    { length: 125_000 },
    (_, index) => `m${index}(){}`,
  ).join(",");
  const source = `const e=require("electron");e.contextBridge.exposeInMainWorld("desktop",{nested:{${members}}});`;
  expect(() => analyzeJavaScriptStaticSource(source)).not.toThrow();
});
it("reports nested bridge depth truncation while retaining shallow paths", () => {
  const nested =
    Array.from({ length: 130 }, (_, index) => `level${index}:{`).join("") +
    `deep:()=>e.ipcRenderer.send("deep")` +
    "}".repeat(130);
  const result = analyzeJavaScriptStaticSource(`
    const e=require("electron");
    e.contextBridge.exposeInMainWorld("desktop", {
      shallow:()=>e.ipcRenderer.send("shallow"), ${nested}
    });
  `);
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({ entry: "desktop.shallow", channel: "shallow" }),
  );
  expect(result.limitations.join(" ")).toContain("depth 128");
});
it("preserves conditions when a wrapper dispatches through conditional external methods", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const send=flag ? e.ipcRenderer.send : e.ipcRenderer.invoke;
      e.contextBridge.exposeInMainWorld("desktop", {action:()=>send("channel")});
    `);
  expect(result.electron.call_paths).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entry: "desktop.action",
        channel: "channel",
        terminal: "electron.ipcRenderer.send",
        conditions: [expect.objectContaining({ expression: "flag" })],
      }),
      expect.objectContaining({
        entry: "desktop.action",
        channel: "channel",
        terminal: "electron.ipcRenderer.invoke",
        conditions: [expect.objectContaining({ expression: "!(flag)" })],
      }),
    ]),
  );
  expect(
    result.electron.ipc.filter(
      ({ resolution_basis, channel }) =>
        resolution_basis === "wrapper-substitution" && channel === "channel",
    ),
  ).toEqual([]);
  expect(result.parse_status).toBe("partial");
});
it("keeps conditional IPC channels unknown instead of reporting them unconditionally", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const channel=flag ? "copy" : "cut";
      e.contextBridge.exposeInMainWorld("desktop", {action:()=>e.ipcRenderer.send(channel)});
    `);
  expect(result.electron.call_paths ?? []).toEqual([]);
  expect(result.parse_status).toBe("partial");
});
it("retains enclosing branch predicates without emitting unconditional wrapper findings", () => {
  const result = analyzeJavaScriptStaticSource(`
    const e=require("electron");
    function expose(key,api){e.contextBridge.exposeInMainWorld(key,api);}
    function register(channel,handler){e.ipcMain.on(channel,handler);}
    if(flag){
      expose("conditional",{copy:()=>navigator.clipboard.writeText("copy")});
      register("only:flag",event=>event.sender.copy());
    }
  `);
  expect(result.electron.context_bridge_apis).not.toContainEqual(
    expect.objectContaining({
      api_key: "conditional",
      resolution_basis: "wrapper-substitution",
    }),
  );
  expect(result.electron.ipc).not.toContainEqual(
    expect.objectContaining({
      channel: "only:flag",
      resolution_basis: "wrapper-substitution",
    }),
  );
  for (const entry of ["conditional.copy", "only:flag"])
    expect(result.electron.call_paths).toContainEqual(
      expect.objectContaining({
        entry,
        conditions: [expect.objectContaining({ expression: "flag" })],
      }),
    );
  expect(result.parse_status).toBe("partial");
});
it("preserves the raw bridge observation for a guarded object value", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const api=flag ? {copy:()=>e.ipcRenderer.send("copy")} : {};
      e.contextBridge.exposeInMainWorld("desktop", api);
    `);
  expect(result.electron.context_bridge_apis).toContainEqual(
    expect.objectContaining({
      api_key: "desktop",
      api_status: "dynamic",
    }),
  );
  expect(result.parse_status).toBe("partial");
});
it("preserves the source expression for a guarded bridge world key", () => {
  const result = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      const world=flag ? "desktop" : "shell";
      e.contextBridge.exposeInMainWorld(world, {copy:()=>e.ipcRenderer.send("copy")});
    `);
  expect(result.electron.context_bridge_apis).toContainEqual(
    expect.objectContaining({ api_key: null, api_key_expression: "world" }),
  );
  expect(result.parse_status).toBe("partial");
});
it.each(["const", "var"])(
  "does not use a %s callback initializer before exposure",
  (declaration) => {
    const result = analyzeJavaScriptStaticSource(
      bundle(`
          const electron=load(2);
          electron.contextBridge.exposeInMainWorld("desktop", {copy: callback});
          ${declaration} callback=()=>electron.ipcRenderer.send("late");
        `),
    );
    expect(result.electron.call_paths ?? []).toEqual([]);
    expect(result.parse_status).toBe("partial");
  },
);
it("does not use an original Electron module factory after its slot is replaced", () => {
  const result = analyzeJavaScriptStaticSource(
    bundle(`
      modules[2] = function(module) {
        module.exports = {contextBridge:{exposeInMainWorld(){}},ipcRenderer:{send(){}}};
      };
      const electron=load(2);
      electron.contextBridge.exposeInMainWorld("desktop", {copy:()=>electron.ipcRenderer.send("fake")});
    `),
  );
  expect(result.electron.call_paths ?? []).toEqual([]);
});
it.each(["({})", "load(2)"])(
  "does not emit the impossible logical-RHS terminal after %s",
  (left) => {
    const result = analyzeJavaScriptStaticSource(
      bundle(`
        electron.ipcMain.on("guard", event => { ${left} || event.sender.copy(); });
      `),
    );
    expect(result.electron.call_paths ?? []).toEqual([]);
  },
);
it.each([
  ["flag -= 1", true],
  ["flag = 0", false],
  ["flag -= step", true],
  ["flag += 0", true],
  ["flag &= 2", true],
  ["flag &&= 0", true],
  ["flag ||= 0", true],
  ["flag ??= 0", true],
] as const)(
  "preserves contextual IPC candidates for assignment test %s",
  (test, uncertain) => {
    const result = analyzeJavaScriptStaticSource(`
      const {contextBridge, ipcRenderer} = require("electron");
      function action(step) {
        let flag = 1;
        if ((${test})) ipcRenderer.send("channel-then");
        else ipcRenderer.send("channel-else");
      }
      contextBridge.exposeInMainWorld("desktop", {action});
    `);
    expect(result.electron.ipc.map(({ channel }) => channel).sort()).toEqual([
      "channel-else",
      "channel-then",
    ]);
    const paths = result.electron.call_paths
      ?.filter(({ entry }) => entry === "desktop.action")
      .map(({ channel, conditions, resolution }) => ({
        channel,
        conditions: conditions.map(({ expression }) => expression),
        resolution,
      }))
      .sort((a, b) => String(a.channel).localeCompare(String(b.channel)));
    expect(paths).toEqual([
      {
        channel: "channel-else",
        conditions: uncertain ? [`!(${test})`] : [],
        resolution: "candidate",
      },
      ...(uncertain
        ? [
            {
              channel: "channel-then",
              conditions: [test],
              resolution: "candidate",
            },
          ]
        : []),
    ]);
  },
);
it.each([
  ["exports.flag = 1; exports.flag -= 1", "helper.flag", true],
  ["exports.flag = 0", "helper.flag", false],
  [
    "module.exports = {flag: 1}; module.exports += {flag: 0}",
    "helper.flag",
    true,
  ],
  ["module.exports = {flag: 0}", "helper.flag", false],
] as const)(
  "preserves assignment semantics through module writes: %s",
  (writes, test, uncertain) => {
    const source = bundle(`
      electron.contextBridge.exposeInMainWorld("desktop", {action() {
        if (${test}) electron.ipcRenderer.send("channel-then");
        else electron.ipcRenderer.send("channel-else");
      }});
    `).replace("exports.sender =", `${writes}; exports.sender =`);
    const result = analyzeJavaScriptStaticSource(source);
    const paths = result.electron.call_paths
      ?.filter(({ entry }) => entry === "desktop.action")
      .map(({ channel, conditions }) => ({
        channel,
        conditions: conditions.map(({ expression }) => expression),
      }))
      .sort((a, b) => String(a.channel).localeCompare(String(b.channel)));
    expect(paths).toEqual([
      { channel: "channel-else", conditions: uncertain ? [`!(${test})`] : [] },
      ...(uncertain ? [{ channel: "channel-then", conditions: [test] }] : []),
    ]);
  },
);
it.each([
  ["cb ||=", ["!(cb)"]],
  ["cb &&=", ["cb"]],
  ["cb ??=", ["(cb) === null || (cb) === undefined"]],
  ["({cb: false}).cb ||=", []],
  ["({cb: true}).cb &&=", []],
  ["({cb: null}).cb ??=", []],
] as const)(
  "retains the reachable callable RHS of %s",
  (assignment, conditions) => {
    const result = analyzeJavaScriptStaticSource(`
      const {contextBridge, ipcRenderer} = require("electron");
      contextBridge.exposeInMainWorld("desktop", {action(cb) {
        (${assignment} () => ipcRenderer.send("rhs"))();
      }});
    `);
    expect(
      result.electron.call_paths?.map(
        ({ channel, conditions, resolution }) => ({
          channel,
          conditions: conditions.map(({ expression }) => expression),
          resolution,
        }),
      ),
    ).toEqual([{ channel: "rhs", conditions, resolution: "candidate" }]);
  },
);
it.each([
  "({cb: true}).cb ||=",
  "({cb: false}).cb &&=",
  "({cb: false}).cb ??=",
])("does not invoke the skipped callable RHS of %s", (assignment) => {
  const result = analyzeJavaScriptStaticSource(`
    const {contextBridge, ipcRenderer} = require("electron");
    contextBridge.exposeInMainWorld("desktop", {action() {
      (${assignment} () => ipcRenderer.send("skipped"))();
    }});
  `);
  expect(result.electron.call_paths ?? []).toEqual([]);
  expect(result.electron.ipc).toContainEqual(
    expect.objectContaining({ channel: "skipped" }),
  );
});
it.each(["||=", "??="])(
  "retains the selected left callable of %s",
  (operator) => {
    const result = analyzeJavaScriptStaticSource(`
    const {contextBridge, ipcRenderer} = require("electron");
    contextBridge.exposeInMainWorld("desktop", {action() {
      (({cb: () => ipcRenderer.send("left")}).cb ${operator} () => ipcRenderer.send("right"))();
    }});
  `);
    expect(
      result.electron.call_paths?.map(({ channel, conditions }) => ({
        channel,
        conditions,
      })),
    ).toEqual([{ channel: "left", conditions: [] }]);
  },
);
it.each([
  ["||=", "!(exports.action)"],
  ["&&=", "exports.action"],
  ["??=", "(exports.action) === null || (exports.action) === undefined"],
])(
  "retains a guarded namespace callable assigned with %s",
  (operator, condition) => {
    const source = bundle(`
    electron.contextBridge.exposeInMainWorld("desktop", {action: helper.action});
  `).replace(
      "exports.sender =",
      `exports.action ${operator} () => electron.ipcRenderer.send("rhs"); exports.sender =`,
    );
    const result = analyzeJavaScriptStaticSource(source);
    expect(
      result.electron.call_paths?.map(({ channel, conditions }) => ({
        channel,
        conditions: conditions.map(({ expression }) => expression),
      })),
    ).toEqual([{ channel: "rhs", conditions: [condition] }]);
  },
);
// A synthetic module record establishes identity, not the value of its mutable
// exports slot. These are guarded candidates, including when runtime evaluation
// might skip the RHS; they must not claim execution or select a stale value.
const expectGuardedRoot = (
  source: string,
  operator: string,
  target = "module.exports",
  channel = "rhs",
) => {
  const result = analyzeJavaScriptStaticSource(source);
  const condition =
    operator === "&&="
      ? target
      : operator === "||="
        ? `!(${target})`
        : `(${target}) === null || (${target}) === undefined`;
  expect(
    result.electron.call_paths
      ?.filter(({ entry }) => entry === "desktop.action")
      .map(({ channel, conditions, resolution }) => ({
        channel,
        conditions: conditions.map(({ expression }) => expression),
        resolution,
      })) ?? [],
  ).toEqual([{ channel, conditions: [condition], resolution: "candidate" }]);
  expect(result.electron.ipc).toContainEqual(
    expect.objectContaining({ channel }),
  );
};
const rootFixture = (body: string, expose = true) =>
  bundle(
    expose
      ? `electron.contextBridge.exposeInMainWorld("desktop", helper);`
      : "",
  ).replace("exports.sender =", `${body}; exports.sender =`);

it.each([
  ["null", "||="],
  ["0", "||="],
  ["false", "??="],
  ["null", "??="],
  ["void 0", "??="],
  ["true", "&&="],
  ["null", "&&="],
  ["({action: () => electron.ipcRenderer.send('prior')})", "||="],
  ["({action: () => electron.ipcRenderer.send('prior')})", "??="],
  ["({action: () => electron.ipcRenderer.send('prior')})", "&&="],
])(
  "keeps mutable root result uncertain after %s with %s",
  (prior, operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports = ${prior}; module.exports ${operator} {action: () => electron.ipcRenderer.send("rhs")}`,
      ),
      operator,
    );
  },
);
it.each(["||=", "??=", "&&="])(
  "keeps a guarded candidate without a prior root write for %s",
  (operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports ${operator} {action: () => electron.ipcRenderer.send("rhs")}`,
      ),
      operator,
    );
  },
);
it.each(["||=", "??=", "&&="])(
  "keeps unknown prior root replacement guarded for %s",
  (operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports = unknownValue; module.exports ${operator} {action: () => electron.ipcRenderer.send("rhs")}`,
      ),
      operator,
    );
  },
);
it.each(["||=", "??="])(
  "does not claim a known prior root callable for %s",
  (operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports = () => electron.ipcRenderer.send("prior");
    const selected = (module.exports ${operator} () => electron.ipcRenderer.send("rhs"));
    electron.contextBridge.exposeInMainWorld("desktop", {action: selected});`,
        false,
      ),
      operator,
    );
  },
);
it.each(["||=", "??="])(
  "does not borrow a later root write when evaluating %s",
  (operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports = null;
    const selected = (module.exports ${operator} {action: () => electron.ipcRenderer.send("selected")});
    module.exports = {action: () => electron.ipcRenderer.send("later")};
    electron.contextBridge.exposeInMainWorld("desktop", selected);`,
        false,
      ),
      operator,
      "module.exports",
      "selected",
    );
  },
);
it.each(["if (flag) module.exports = null;", "module[key] = null;"])(
  "keeps ambiguous earlier root writes uncertain: %s",
  (prior) => {
    expectGuardedRoot(
      rootFixture(
        `${prior}
    const selected = (module.exports ||= () => electron.ipcRenderer.send("rhs"));
    electron.contextBridge.exposeInMainWorld("desktop", {action: selected});`,
        false,
      ),
      "||=",
    );
  },
);
it.each([
  ["null", "const alias = module; alias.exports = {};", "&&="],
  ["{}", "const alias = module; alias.exports = null;", "||="],
  ["{}", "const alias = module; alias.exports = null;", "??="],
  ["null", "Object.assign(module, {exports: {}});", "&&="],
  ["null", "replaceExports(module);", "&&="],
  ["null", "const box = {holder: module}; box.holder.exports = {};", "&&="],
  [
    "null",
    "const {holder: alias} = {holder: module}; alias.exports = {};",
    "&&=",
  ],
])(
  "keeps guarded root candidates after escape: %s; %s; %s",
  (prior, escape, operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports = ${prior}; ${escape} module.exports ${operator} {action: () => electron.ipcRenderer.send("rhs")}`,
      ),
      operator,
    );
  },
);
it("keeps root candidates guarded in the presence of a shadowed module parameter", () => {
  expectGuardedRoot(
    rootFixture(`function unrelated(module) {replaceExports(module);}
    module.exports = null; module.exports ||= {action: () => electron.ipcRenderer.send("rhs")}`),
    "||=",
  );
});
it.each([
  "module.exports()",
  "module.exports?.()",
  "module.exports``",
  "(module.exports)()",
  "(module.exports as Function)()",
  "(module.exports!)()",
  "const fn = module.exports; fn()",
  "(0, module.exports)()",
])(
  "keeps mutable root candidates guarded across invocation: %s",
  (invocation) => {
    expectGuardedRoot(
      rootFixture(`module.exports = function() {this.exports = null;};
    ${invocation}; module.exports ||= {action: () => electron.ipcRenderer.send("rhs")}`),
      "||=",
    );
  },
);
it.each([
  "module.exports = null; exports = {};",
  "module.exports = null; module.exports = module.exports;",
])(
  "does not infer a root value from detached or self-referential writes: %s",
  (prior) => {
    expectGuardedRoot(
      rootFixture(
        `${prior} module.exports ||= {action: () => electron.ipcRenderer.send("rhs")}`,
      ),
      "||=",
    );
  },
);
it.each(["||=", "??=", "&&="])(
  "keeps aliased logical assignment targets guarded for %s",
  (operator) => {
    expectGuardedRoot(
      rootFixture(
        `const alias = module;
    const selected = (alias.exports ${operator} {action: () => electron.ipcRenderer.send("rhs")});
    electron.contextBridge.exposeInMainWorld("desktop", selected);`,
        false,
      ),
      operator,
      "alias.exports",
    );
  },
);
it.each(["||=", "??=", "&&="])(
  "keeps conditional synthetic receivers guarded for %s",
  (operator) => {
    for (const receiver of [
      "(flag ? module : module)",
      "(flag ? {exports: true} : module)",
      "(flag ? module : {exports: true})",
    ]) {
      expectGuardedRoot(
        rootFixture(
          `module.exports = null;
    const selected = (${receiver}.exports ${operator} {action: () => electron.ipcRenderer.send("rhs")});
    electron.contextBridge.exposeInMainWorld("desktop", selected);`,
          false,
        ),
        operator,
        `${receiver}.exports`,
      );
    }
  },
);
it.each(["||=", "??=", "&&="])(
  "preserves ordinary values beside synthetic receivers for %s",
  (operator) => {
    for (const moduleFirst of [false, true]) {
      const ordinary =
        operator === "&&="
          ? "{exports: false}"
          : "{exports: () => electron.ipcRenderer.send('left')}";
      const receiver = moduleFirst
        ? `(flag ? module : ${ordinary})`
        : `(flag ? ${ordinary} : module)`;
      const target = `${receiver}.exports`;
      const result = analyzeJavaScriptStaticSource(
        rootFixture(
          `const selected = (${target} ${operator} () => electron.ipcRenderer.send("right"));
        electron.contextBridge.exposeInMainWorld("desktop", {action: selected});`,
          false,
        ),
      );
      const paths = result.electron.call_paths
        ?.map(({ channel, conditions, resolution }) => ({
          channel,
          conditions: conditions.map(({ expression }) => expression),
          resolution,
        }))
        .sort((a, b) => String(a.channel).localeCompare(String(b.channel)));
      expect(paths).toEqual([
        ...(operator === "&&="
          ? []
          : [
              {
                channel: "left",
                conditions: [
                  moduleFirst ? "!(flag)" : "flag",
                  operator === "||="
                    ? target
                    : `(${target}) !== null && (${target}) !== undefined`,
                ],
                resolution: "candidate",
              },
            ]),
        {
          channel: "right",
          conditions: [
            operator === "&&="
              ? target
              : operator === "||="
                ? `!(${target})`
                : `(${target}) === null || (${target}) === undefined`,
          ],
          resolution: "candidate",
        },
      ]);
      expect(result.electron.ipc).toContainEqual(
        expect.objectContaining({ channel: "right" }),
      );
      if (operator !== "&&=")
        expect(result.electron.ipc).toContainEqual(
          expect.objectContaining({ channel: "left" }),
        );
    }
  },
);
it.each(["(module)", "(module as any)", "(module!)"])(
  "recognizes wrapped synthetic receivers: %s",
  (receiver) => {
    expectGuardedRoot(
      rootFixture(
        `const selected = (${receiver}.exports ||= {action: () => electron.ipcRenderer.send("rhs")});
    electron.contextBridge.exposeInMainWorld("desktop", selected);`,
        false,
      ),
      "||=",
      `${receiver}.exports`,
    );
  },
);
it.each(["||=", "??=", "&&="])(
  "preserves uncertainty through module exports snapshots for %s",
  (operator) => {
    for (const [setup, target] of [
      ["", "({exports: module.exports}).exports"],
      ["const snapshot = module.exports;", "({exports: snapshot}).exports"],
      ["", "[module.exports][0]"],
    ]) {
      expectGuardedRoot(
        rootFixture(
          `module.exports = null; ${setup}
          const selected = (${target} ${operator} {action: () => electron.ipcRenderer.send("rhs")});
          electron.contextBridge.exposeInMainWorld("desktop", selected);`,
          false,
        ),
        operator,
        target,
      );
    }
  },
);
it.each(["saved", "!saved"])(
  "keeps primitive root snapshot branch uncertainty for %s",
  (test) => {
    const result = analyzeJavaScriptStaticSource(
      rootFixture(
        `module.exports = null; const saved = module.exports;
      electron.contextBridge.exposeInMainWorld("desktop", {action() {
        if (${test}) electron.ipcRenderer.send("then");
        else electron.ipcRenderer.send("else");
      }});`,
        false,
      ),
    );
    expect(
      result.electron.call_paths
        ?.map(({ channel, conditions }) => ({
          channel,
          conditions: conditions.map((c) => c.expression),
        }))
        .sort((a, b) => String(a.channel).localeCompare(String(b.channel))),
    ).toEqual([
      { channel: "else", conditions: [`!(${test})`] },
      { channel: "then", conditions: [test] },
    ]);
  },
);
it.each(["||", "??", "&&"])(
  "keeps primitive root logical snapshots uncertain for %s",
  (operator) => {
    expectGuardedRoot(
      rootFixture(
        `module.exports = null; const saved = module.exports;
      const selected = saved ${operator} {action: () => electron.ipcRenderer.send("rhs")};
      electron.contextBridge.exposeInMainWorld("desktop", selected);`,
        false,
      ),
      `${operator}=`,
      "saved",
    );
  },
);
it.each(["module.exports", "({saved: module.exports}).saved"])(
  "preserves namespace members through plain logical selection of %s",
  (target) => {
    for (const operator of ["||", "??"]) {
      const result = analyzeJavaScriptStaticSource(
        rootFixture(
          `exports.action = () => electron.ipcRenderer.send("left");
        const selected = ${target} ${operator} {};
        electron.contextBridge.exposeInMainWorld("desktop", selected);`,
          false,
        ),
      );
      expect(
        result.electron.call_paths?.map(({ channel, conditions }) => ({
          channel,
          conditions: conditions.map((c) => c.expression),
        })),
      ).toEqual([
        {
          channel: "left",
          conditions: [
            operator === "||"
              ? target
              : `(${target}) !== null && (${target}) !== undefined`,
          ],
        },
      ]);
    }
  },
);
it("preserves later member writes through a saved module exports reference", () => {
  const result = analyzeJavaScriptStaticSource(
    rootFixture(
      `const saved = module.exports;
    exports.action = () => electron.ipcRenderer.send("later-member");
    electron.contextBridge.exposeInMainWorld("desktop", saved);`,
      false,
    ),
  );
  expect(
    result.electron.call_paths?.map(({ channel, conditions }) => ({
      channel,
      conditions,
    })),
  ).toEqual([{ channel: "later-member", conditions: [] }]);
});
it.each(["||=", "??=", "&&="])(
  "recognizes whole-target wrappers for %s",
  (operator) => {
    for (const target of [
      "(module.exports as any)",
      "(module.exports!)",
      "(module.exports satisfies any)",
      "(module.exports)",
    ]) {
      expectGuardedRoot(
        rootFixture(
          `module.exports = null;
          const selected = (${target} ${operator} {action: () => electron.ipcRenderer.send("rhs")});
          electron.contextBridge.exposeInMainWorld("desktop", selected);`,
          false,
        ),
        operator,
        target.slice(1, -1),
      );
      const ordinary = target.replace(
        "module.exports",
        `({exports: ${operator === "&&=" ? "false" : "true"}}).exports`,
      );
      const result =
        analyzeJavaScriptStaticSource(`const e = require("electron");
        e.contextBridge.exposeInMainWorld("desktop", {action() {
          (${ordinary} ${operator} () => e.ipcRenderer.send("skipped"))();
        }});`);
      expect(result.electron.call_paths ?? []).toEqual([]);
      expect(result.electron.ipc).toContainEqual(
        expect.objectContaining({ channel: "skipped" }),
      );
    }
  },
);
it.each(["||=", "??="])(
  "keeps an ordinary object's exports slot precise for %s",
  (operator) => {
    const result = analyzeJavaScriptStaticSource(`const e=require("electron");
    function action(){(({exports: true}).exports ${operator} () => e.ipcRenderer.send("skipped"))();}
    e.contextBridge.exposeInMainWorld("desktop",{action});`);
    expect(result.electron.call_paths ?? []).toEqual([]);
  },
);
it("does not follow a statically false callback branch", () => {
  const result = analyzeJavaScriptStaticSource(
    bundle(
      `helper.events.addListener("example:copy",event=>{if(false)event.sender.copy()});`,
    ),
  );
  expect(result.electron.call_paths ?? []).toEqual([]);
});
it("retains early rejection guards and excludes calls after definite returns", () => {
  const guarded = analyzeJavaScriptStaticSource(
    `const e=require("electron");e.ipcMain.on("guard",event=>{if(!allowed(event))return;event.sender.copy()});`,
  );
  expect(guarded.electron.call_paths).toContainEqual(
    expect.objectContaining({
      conditions: [
        expect.objectContaining({ expression: "!(!allowed(event))" }),
      ],
    }),
  );
  for (const body of [
    "return;event.sender.copy()",
    "if(true)return;event.sender.copy()",
    "if(false)event.sender.copy()",
  ])
    expect(
      analyzeJavaScriptStaticSource(
        `const e=require("electron");e.ipcMain.on("dead",event=>{${body}});`,
      ).electron.call_paths ?? [],
    ).toEqual([]);
  expect(
    analyzeJavaScriptStaticSource(
      `const e=require("electron");if(false)e.ipcMain.on("dead",event=>event.sender.copy());`,
    ).electron.call_paths ?? [],
  ).toEqual([]);
});
it("rejects dynamic channels, computed overwrites, unknown spreads and reassigned callback parameters", () => {
  for (const entry of [
    `helper.events.addListener(runtimeChannel,event=>event.sender.copy());`,
    `electron[runtimeKey]={};electron.ipcMain.on("bad",event=>event.sender.copy());`,
    `const api={copy:helper.sender("bad"),...unknownApi};electron.contextBridge.exposeInMainWorld("desktop",api);`,
    `helper.events.addListener("bad",event=>{event=other;event.sender.copy()});`,
  ])
    expect(
      analyzeJavaScriptStaticSource(bundle(entry)).electron.call_paths ?? [],
    ).toEqual([]);
});
it("resolves renamed default and namespace import helpers from their syntax", () => {
  const result = analyzeJavaScriptStaticSource(
    bundle(`
   const defaultImport=x=>x&&x.__esModule?x:{default:x};
   function namespaceImport(x){if(x&&x.__esModule)return x;return unknownWrap(x)}
   const E=defaultImport(load(2)),H=namespaceImport(load(5));
   E.default.contextBridge.exposeInMainWorld("renamed",{copy:(0,H.sender)("test:renamed")});
  `),
  );
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({
      entry: "renamed.copy",
      channel: "test:renamed",
      terminal: "electron.ipcRenderer.send",
    }),
  );
  expect(
    result.electron.call_paths
      ?.flatMap((p) => p.steps)
      .every((step) => step.label.length > 0),
  ).toBe(true);
});
it("resolves an empty bootstrap module key through an exported Electron bridge", () => {
  const result = analyzeJavaScriptStaticSource(`(() => {
    const modules = {
      ""(module) { module.exports = require("electron"); },
      9(module, exports, load) {
        const electron = load("");
        electron.contextBridge.exposeInMainWorld("desktop", {
          copy: () => electron.ipcRenderer.send("test:empty-module"),
        });
      },
    };
    function load(id) {
      const module = { exports: {} };
      modules[id].call(module.exports, module, module.exports, load);
      return module.exports;
    }
    load(9);
  })();`);
  expect(result.bundler_registrations).toMatchObject([
    {
      entry_module_keys: ["9"],
      modules: [{ module_key: "" }, { module_key: "9" }],
    },
  ]);
  expect(result.electron.call_paths).toContainEqual(
    expect.objectContaining({
      entry: "desktop.copy",
      channel: "test:empty-module",
      terminal: "electron.ipcRenderer.send",
    }),
  );
});
it("does not trust helper names or follow returns after a definite throw", () => {
  for (const helper of [
    `function __toESM() {return {ipcRenderer:{send(){}}}}`,
    `function __toESM(value) {throw Error("inert");return value;}`,
    `function __toESM(value) {if(true){throw Error("inert")}return value;}`,
  ]) {
    const result = analyzeJavaScriptStaticSource(`
        const electron = require("electron");
        ${helper}
        const wrapped = __toESM(electron);
        electron.contextBridge.exposeInMainWorld("desktop",{
          copy:()=>wrapped.ipcRenderer.send("test:copy")
        });
      `);
    expect(result.electron.call_paths ?? []).toEqual([]);
  }
});

describe("wrapped Electron API identity", () => {
  it("does not restore rejected Electron identities through wrapper substitution", () => {
    for (const source of [
      `const e=require("electron");e.ipcMain={on(){}};e.ipcMain.on("bad",event=>event.sender.copy());`,
      `function require(){return {ipcMain:{on(){}}}};const e=require("electron");e.ipcMain.on("bad",event=>event.sender.copy());`,
      `const e=require("electron");const ipc=e.ipcRenderer,alias=ipc;delete alias.send;function send(channel){ipc.send(channel)}send("bad");`,
      `require("electron/renderer").ipcRenderer={};const e=require("electron");function send(channel){e.ipcRenderer.send(channel)}send("bad");`,
      `const e=require("electron");[e.ipcRenderer]=replacements;function send(channel){e.ipcRenderer.send(channel)}send("bad");`,
      `const e=require("electron");for(e.contextBridge of replacements){}function expose(api){e.contextBridge.exposeInMainWorld("api",api)}expose({copy:()=>navigator.clipboard.writeText("bad")});`,
      `const e=require("electron");const ipc=e.ipcRenderer;Reflect.deleteProperty(ipc,"send");function send(channel){ipc.send(channel)}send("bad");`,
    ]) {
      const { electron } = analyzeJavaScriptStaticSource(source);
      expect(electron.call_paths ?? []).toEqual([]);
      expect(electron.ipc).toEqual([]);
      expect(electron.context_bridge_apis).toEqual([]);
    }
  });
  it("keeps unaffected Electron methods available after a sibling method write", () => {
    const { electron } = analyzeJavaScriptStaticSource(`
      const e=require("electron");
      delete e.ipcRenderer.send;
      function invoke(channel){e.ipcRenderer.invoke(channel)}
      invoke("good");
    `);
    expect(electron.ipc).toContainEqual(
      expect.objectContaining({ channel: "good", operation: "invoke" }),
    );
  });
});

it.each([false, true])(
  "preserves a guarded bridge entry sharing a registration with an unconditional member (reverse=%s)",
  (reverse) => {
    const members = ["always:register", "conditional:flag?register:()=>{}"];
    if (reverse) members.reverse();
    const result = analyzeJavaScriptStaticSource(`const e=require("electron");
    function register(){e.ipcMain.on("bridge:register",()=>{});}
    e.contextBridge.exposeInMainWorld("api",{${members.join(",")}});`);
    expect(result.electron.call_paths).toContainEqual(
      expect.objectContaining({
        entry_kind: "bridge-member",
        entry: "api.conditional",
        terminal: "electron.ipcMain.on",
        conditions: expect.arrayContaining([
          expect.objectContaining({ expression: "flag" }),
        ]),
      }),
    );
  },
);
