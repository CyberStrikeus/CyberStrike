import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { analyzeCommonJsStaticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

describe("JavaScript static analysis findings", () => {
  it("does not infer a webpack push from a dynamic computed key", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const push = "push";
      const arr = {};
      arr[push]([[1], { 1: function () {} }]);
    `);
    expect(analysis.bundler_registrations).toEqual([]);
  });

  it("retains every static reference and Electron property in large literals", () => {
    const names = Array.from({ length: 10_001 }, (_, index) => `key${index}`);
    const source = [
      'import { BrowserWindow, contextBridge } from "electron";',
      ...names.map(
        (name, index) => `import value${index} from "./${name}.js";`,
      ),
      `new BrowserWindow({ webPreferences: { ${names.map((name) => `${name}: true`).join(", ")} } });`,
      `contextBridge.exposeInMainWorld("api", { ${names.map((name) => `${name}: () => true`).join(", ")} });`,
    ].join("\n");
    const analysis = analyzeJavaScriptStaticSource(source);

    expect(analysis.parse_status).toBe("complete");
    expect(analysis.references).toHaveLength(10_002);
    expect(analysis.electron.browser_windows[0]?.web_preferences).toHaveLength(
      10_001,
    );
    expect(analysis.electron.context_bridge_apis[0]?.members).toHaveLength(
      10_001,
    );
    const commonJsSource = `const { ${names.join(", ")} } = require("./addon.node");`;
    const commonJs = analyzeCommonJsStaticFixture(commonJsSource);
    expect(commonJs.parse_status).toBe("complete");
    expect(commonJs.references).toHaveLength(1);
    expect(commonJs.electron.native_addon_bindings[0]?.members).toHaveLength(
      10_001,
    );
  });
});
