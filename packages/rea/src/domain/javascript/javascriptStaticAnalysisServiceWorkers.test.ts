import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const serviceWorkers = (source: string) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.parse_error_count).toBe(0);
  return analysis.references
    .filter(({ kind }) => kind === "service-worker")
    .map(({ specifier, expression }) => ({ specifier, expression }));
};

describe("service-worker API identity", () => {
  it.each([
    "navigator.serviceWorker.register",
    "window.navigator.serviceWorker.register",
    "self.navigator.serviceWorker.register",
    "globalThis.navigator.serviceWorker.register",
    "window?.navigator?.serviceWorker?.register",
    'navigator["serviceWorker"]["register"]',
  ])("resolves a module-relative URL for %s", (callee) => {
    const expression = `${callee}(new URL("./sw.js?version=2", import.meta.url))`;
    expect(serviceWorkers(expression)).toEqual([
      { specifier: "./sw.js?version=2", expression: null },
    ]);
  });

  it.each([
    'const navigator = vendor; navigator.serviceWorker.register("./sw.js");',
    'import navigator from "vendor"; navigator.serviceWorker.register("./sw.js");',
    'function register(navigator) { navigator.serviceWorker.register("./sw.js"); }',
    'vendor.serviceWorker.register("./sw.js");',
    'serviceWorker.register("./sw.js");',
    'navigator["serviceWorker.register"]("./sw.js");',
    'navigator.serviceWorker[method]("./sw.js");',
    'navigator.serviceWorker.register = load; navigator.serviceWorker.register(new URL("./ordinary.js", import.meta.url));',
    'const sw = navigator.serviceWorker; sw.register = load; navigator.serviceWorker.register("./sw.js");',
    'Object.assign(navigator.serviceWorker, { register: load }); navigator.serviceWorker.register("./sw.js");',
    'Reflect.set(navigator.serviceWorker, "register", load); navigator.serviceWorker.register("./sw.js");',
    'navigator.serviceWorker = vendor; navigator.serviceWorker.register("./sw.js");',
    'window.navigator = vendor; navigator.serviceWorker.register("./sw.js");',
    'window = vendor; window.navigator.serviceWorker.register("./sw.js");',
  ])("does not attribute a replaced or unproven API: %s", (source) => {
    expect(serviceWorkers(source)).toEqual([]);
  });

  it.each([
    '"./sw.js"',
    'new URL("./sw.js", document.baseURI)',
    'new URL("/sw.js", import.meta.url)',
    'new URL("./sw.js", import.meta.url)',
  ])(
    "retains the expression when its module-relative URL is unknown: %s",
    (argument) => {
      // The last case is a replaced URL constructor, not the platform intrinsic.
      const prefix =
        argument === 'new URL("./sw.js", import.meta.url)'
          ? "const URL = vendor; "
          : "";
      const expression = `navigator.serviceWorker.register(${argument})`;
      expect(serviceWorkers(prefix + expression)).toEqual([
        { specifier: null, expression },
      ]);
    },
  );

  it("does not invalidate registration for an unrelated member write", () => {
    const expression =
      'navigator.serviceWorker.register(new URL("./sw.js", import.meta.url))';
    expect(
      serviceWorkers(
        `navigator.serviceWorker.unrelated = value; ${expression}`,
      ),
    ).toEqual([{ specifier: "./sw.js", expression: null }]);
  });
});
