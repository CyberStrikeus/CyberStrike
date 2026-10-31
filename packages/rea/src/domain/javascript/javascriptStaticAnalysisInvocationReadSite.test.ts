import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  "handlers[key]()",
  "handlers[key].call(null)",
  "handlers[key].apply(null,[])",
])("selects a local table callee before its own opaque effects: %s", (call) => {
  const result = analyzeJavaScriptStaticSource(
    `const handlers={first(){},second(){}};${call};`,
  );
  expect(result.references).toEqual([]);
  expect(result.parse_status).toBe("complete");
});

it.each([
  'handlers[key]=module.require;handlers[key].call(module,"./shared.cjs");',
  'handlers.first=module.require;handlers.first.call(module,"./shared.cjs");',
])("retains earlier uncertainty or a real delegate: %s", (use) => {
  const result = analyzeJavaScriptStaticSource(
    `const handlers={first(){},second(){}};${use}`,
  );
  expect(result.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: null }),
  );
  expect(result.parse_status).toBe("partial");
});

it("retains complete coverage for an inline Electron factory export", () => {
  const result = analyzeJavaScriptStaticSource(`(() => {
    const modules={
      5(module,exports){
        exports.self=exports;
        exports.events=require("electron").ipcMain;
      },
      9(module,exports,load){
        const helper=load(5);
        helper.self.events.addListener("test:copy",()=>{});
      }
    };
    function load(id){
      const m={exports:{}};
      modules[id].call(m.exports,m,m.exports,load);
      return m.exports;
    }
    load(9);
  })();`);
  expect(result.parse_status).toBe("complete");
  expect(result.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: "electron" }),
  );
  expect(result.references.every(({ specifier }) => specifier !== null)).toBe(
    true,
  );
  expect(result.electron.ipc).toContainEqual(
    expect.objectContaining({ channel: "test:copy", side: "main" }),
  );
});
