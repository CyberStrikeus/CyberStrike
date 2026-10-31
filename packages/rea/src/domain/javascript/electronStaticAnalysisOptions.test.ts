import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

describe("Electron constant option evidence", () => {
  it("keeps mixed constant, inline and unresolved windows in construction order", () => {
    const analysis = analyzeJavaScriptStaticSource(
      [
        'const { BrowserWindow } = require("electron");',
        "const options = { webPreferences: { sandbox: true } };",
        "new BrowserWindow(options);",
        "new BrowserWindow({ webPreferences: { sandbox: false } });",
        "new BrowserWindow(dynamic);",
        "new BrowserWindow(options);",
      ].join("\n"),
    );
    expect(
      analysis.electron.browser_windows.map(
        ({ location }) => location.start.line,
      ),
    ).toEqual([3, 4, 5, 6]);
    expect(
      analysis.electron.browser_windows.map(
        ({ options_status }) => options_status,
      ),
    ).toEqual([
      "object-literal",
      "object-literal",
      "dynamic",
      // The first constructor already received this object; later contents
      // remain unknown even though the declarations retain their source order.
      "dynamic",
    ]);
  });

  it("resolves local constant options despite an unrelated option write", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow } = require("electron");
      function open() {
        const preferences = { nodeIntegration: true, contextIsolation: false };
        const options = { webPreferences: preferences };
        if (linux) options.icon = "icon.png";
        new BrowserWindow(options);
      }
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        options_status: "object-literal",
        web_preferences_status: "object-literal",
        web_preferences: [
          {
            name: "contextIsolation",
            value: { status: "literal", value: false },
          },
          {
            name: "nodeIntegration",
            value: { status: "literal", value: true },
          },
        ],
        resolution_sources: [expect.any(Object), expect.any(Object)],
      },
    ]);
  });

  it.each([
    "options.webPreferences.sandbox = false;",
    "const alias = options.webPreferences; alias.sandbox = false;",
    "mutate(options);",
    "const { webPreferences: alias } = options; mutate(alias);",
    "Object.assign(options, unknown);",
    "const box = {}; box.options = options; box.options.webPreferences.sandbox = false;",
    "const box = {}; box.options = options; const saved = box.options; box.options = {}; saved.webPreferences.sandbox = false;",
    "const values = [options]; values[Symbol.iterator] = input; const box = {}; [box.options] = values; box.options.webPreferences.sandbox = false;",
    "options = replacement;",
  ])("keeps changed or escaped constant options unknown: %s", (mutation) => {
    const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow } = require("electron");
      const options = { webPreferences: { sandbox: true } };
      ${mutation}
      new BrowserWindow(options);
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        options_status: "dynamic",
        web_preferences_status: "dynamic",
        web_preferences: [],
        preload_path: null,
      },
    ]);
  });

  it.each([
    "const box = {}; box.options = options; box.options = { webPreferences: { sandbox: false } }; box.options.webPreferences.sandbox = false;",
    "let box = { options: { webPreferences: { sandbox: false } } }; const saved = box; box = {}; box.options = options; saved.options.webPreferences.sandbox = false;",
    "const values = [{ webPreferences: { sandbox: false } }]; values[Symbol.iterator] = input; const box = {}; [box.options] = values; box.options.webPreferences.sandbox = false;",
  ])(
    "keeps independent options intact after stored receiver replacement: %s",
    (mutation) => {
      const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow } = require("electron");
      const options = { webPreferences: { sandbox: true } };
      ${mutation}
      new BrowserWindow(options);
    `);
      expect(analysis.electron.browser_windows).toMatchObject([
        {
          options_status: "object-literal",
          web_preferences_status: "object-literal",
          web_preferences: [
            { name: "sandbox", value: { status: "literal", value: true } },
          ],
        },
      ]);
    },
  );
});

describe("Electron option captures and initialization", () => {
  it.each([
    ["inner.current = second;", [true, false], ["object-literal", "dynamic"]],
    [
      "source.inner = { current: second };",
      [false, true],
      ["dynamic", "object-literal"],
    ],
  ] as const)(
    "preserves shallow-copy capture depth across later writes: %s",
    (replacement, runtime, statuses) => {
      const body = `
      const first = { webPreferences: { sandbox: true } };
      const second = { webPreferences: { sandbox: true } };
      const inner = { current: first };
      const source = { inner };
      const box = {};
      ({...box.options} = source);
      ${replacement}
      box.options.inner.current.webPreferences.sandbox = false;
    `;
      expect(
        Array.from(
          runInNewContext(
            `${body};[first.webPreferences.sandbox, second.webPreferences.sandbox]`,
          ),
        ),
      ).toEqual(runtime);
      const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow } = require("electron");
      ${body}
      new BrowserWindow(first);
      new BrowserWindow(second);
    `);
      expect(
        analysis.electron.browser_windows.map(
          ({ options_status }) => options_status,
        ),
      ).toEqual(statuses);
      const intact =
        analysis.electron.browser_windows[statuses.indexOf("object-literal")];
      expect(intact?.web_preferences).toMatchObject([
        { name: "sandbox", value: { status: "literal", value: true } },
      ]);
    },
  );

  it.each([
    "new BrowserWindow(options); const options = { webPreferences: { sandbox: true } };",
    "const options = alias; const alias = { webPreferences: { sandbox: true } }; new BrowserWindow(options);",
    "const options = alias; const alias = options; new BrowserWindow(options);",
    "const options = { webPreferences: { sandbox: true } }; { const options = unknown; new BrowserWindow(options); }",
    "let options = { webPreferences: { sandbox: true } }; new BrowserWindow(options);",
  ])("does not invent a constant initializer: %s", (source) => {
    const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow } = require("electron"); ${source}
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        options_status: "dynamic",
        web_preferences_status: "dynamic",
        web_preferences: [],
      },
    ]);
  });

  it("preserves constants selected before later mutation and resolves preload context", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow } = require("electron");
      const original = { webPreferences: { preload: require("path").join(__dirname, "preload.js"), sandbox: true } };
      const options = original;
      new BrowserWindow(options);
      original.webPreferences.sandbox = false;
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        options_status: "object-literal",
        preload_path: "preload.js",
        preload_resolution_context: "filesystem-expression",
      },
    ]);
  });
});

describe("Electron option evidence", () => {
  it.each([
    '({ webPreferences: { preload: "./preload.js", sandbox: true } } as const)',
    '{ webPreferences: ({ preload: "./preload.js", sandbox: true } as const) }',
    '{ webPreferences: { preload: "./preload.js" as const, sandbox: true } }',
  ])("unwraps type-only wrappers around inline options: %s", (options) => {
    const analysis = analyzeJavaScriptStaticSource(`
      import { BrowserWindow } from "electron";
      new BrowserWindow(${options});
    `);

    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        options_status: "object-literal",
        web_preferences_status: "object-literal",
        preload_path: "./preload.js",
        preload_resolution_context: "module-specifier",
        web_preferences: [
          {
            name: "preload",
            value: { status: "literal", value: "./preload.js" },
          },
          { name: "sandbox", value: { status: "literal", value: true } },
        ],
      },
    ]);
  });

  it("keeps the final explicit preload and service name with unrelated keys", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow, utilityProcess } = require("electron");
      new BrowserWindow({ webPreferences: { preload: "./kept.js", sandbox: true }, title: "App" });
      utilityProcess.fork("./worker.js", [], { serviceName: "kept", cwd: "/app" });
    `);

    expect(analysis.parse_status).toBe("complete");
    expect(analysis.electron.browser_windows[0]).toMatchObject({
      preload_path: "./kept.js",
      preload_resolution_context: "module-specifier",
      web_preferences: [
        { name: "preload", value: { status: "literal", value: "./kept.js" } },
        { name: "sandbox", value: { status: "literal", value: true } },
      ],
    });
    expect(analysis.electron.utility_processes[0]).toMatchObject({
      module_path: "./worker.js",
      service_name: "kept",
    });
  });

  it.each([
    ["for initializer", 'for (var electron = require("electron"); false;) {}'],
    ["do body", 'do { var electron = require("electron"); } while (false);'],
  ])(
    "recovers Electron bindings initialized unconditionally in a %s",
    (_name, declaration) => {
      const analysis = analyzeJavaScriptStaticSource(
        `${declaration} new electron.BrowserWindow({webPreferences:{preload:"./preload.js"}});`,
      );
      expect(analysis.parse_error_count).toBe(0);
      expect(analysis.electron.browser_windows).toMatchObject([
        { preload_path: "./preload.js" },
      ]);
    },
  );

  it.each([
    'for (; false;) { var electron = require("electron"); }',
    'while (false) { var electron = require("electron"); }',
    'if (flag) { for (var electron = require("electron"); false;) {} }',
  ])(
    "keeps conditionally skipped loop declarations unresolved: %s",
    (declaration) => {
      const analysis = analyzeJavaScriptStaticSource(
        `${declaration} new electron.BrowserWindow({});`,
      );
      expect(analysis.electron.browser_windows).toEqual([]);
    },
  );

  it("selects proven Electron preloads while ignoring media attributes and unrelated properties", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      jsx("audio", { controls: true, preload: "metadata", src });
      (0, React.createElement)(\`video\`, { preload: "auto" });
      jsx("webview", { preload: "./guest.js" });
      const options = { preload: "./unrelated.js" };
      const { BrowserWindow } = require("electron");
      new BrowserWindow({webPreferences: {preload: "./preload.js"}});
    `);

    expect(analysis.role_paths.map(({ path }) => path)).toEqual([
      "./preload.js",
    ]);
  });

  it("keeps values unknown when a later computed key can override them", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const { BrowserWindow, utilityProcess } = require("electron");
      new BrowserWindow({ webPreferences: { preload: "./maybe.js" }, [key]: null });
      utilityProcess.fork("./worker.js", [], { serviceName: "maybe", [key]: null });
    `);

    expect(analysis.parse_status).toBe("partial");
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.limitations.join(" ")).toContain("remain unknown");
    expect(analysis.electron.browser_windows[0]).toMatchObject({
      preload_path: null,
      preload_resolution_context: null,
      web_preferences_status: "dynamic",
      web_preferences: [],
    });
    expect(analysis.electron.utility_processes[0]).toMatchObject({
      module_path: "./worker.js",
      service_name: null,
    });
  });

  it("keeps recovered templates with invalid escapes dynamic", () => {
    const source = [
      'const { BrowserWindow } = require("electron");',
      "new BrowserWindow({ webPreferences: { sandbox: `",
      String.raw`\unicode`,
      "` } });",
    ].join("");
    const analysis = analyzeJavaScriptStaticSource(source);

    expect(analysis.parse_status).toBe("partial");
    expect(analysis.parse_error_count).toBe(1);
    expect(
      analysis.electron.browser_windows[0]?.web_preferences,
    ).toContainEqual(
      expect.objectContaining({
        name: "sandbox",
        value: expect.objectContaining({ status: "dynamic", value: null }),
      }),
    );
  });
});

describe("Electron empty option keys", () => {
  describe.each([
    ["plain empty string", '[""]'],
    ["empty template", "[``]"],
    ["wrapped empty string", '["" as const]'],
  ])("unrelated %s option keys", (_label, key) => {
    it("retains an earlier explicit webPreferences object", () => {
      const analysis = analyzeJavaScriptStaticSource(`
        const { BrowserWindow } = require("electron");
        new BrowserWindow({
          webPreferences: { preload: "./kept.js", sandbox: true },
          ${key}: true
        });
      `);

      expect(analysis.parse_error_count).toBe(0);
      expect(analysis.parse_status).toBe("complete");
      expect(analysis.electron.browser_windows).toMatchObject([
        {
          web_preferences_status: "object-literal",
          preload_path: "./kept.js",
          preload_resolution_context: "module-specifier",
          web_preferences: [
            {
              name: "preload",
              value: { status: "literal", value: "./kept.js" },
            },
            { name: "sandbox", value: { status: "literal", value: true } },
          ],
        },
      ]);
    });

    it("retains an earlier explicit preload within webPreferences", () => {
      const analysis = analyzeJavaScriptStaticSource(`
        const { BrowserWindow } = require("electron");
        new BrowserWindow({ webPreferences: {
          preload: "./kept.js", sandbox: true, ${key}: false
        } });
      `);

      expect(analysis.parse_error_count).toBe(0);
      expect(analysis.parse_status).toBe("complete");
      expect(analysis.electron.browser_windows).toMatchObject([
        {
          web_preferences_status: "object-literal",
          preload_path: "./kept.js",
          preload_resolution_context: "module-specifier",
          web_preferences: [
            { name: "", value: { status: "literal", value: false } },
            {
              name: "preload",
              value: { status: "literal", value: "./kept.js" },
            },
            { name: "sandbox", value: { status: "literal", value: true } },
          ],
        },
      ]);
    });

    it("retains an earlier explicit utility-process service name", () => {
      const analysis = analyzeJavaScriptStaticSource(`
        const { utilityProcess } = require("electron");
        utilityProcess.fork("./worker.js", [], {
          serviceName: "kept", ${key}: true
        });
      `);

      expect(analysis.parse_error_count).toBe(0);
      expect(analysis.parse_status).toBe("complete");
      expect(analysis.electron.utility_processes).toMatchObject([
        { module_path: "./worker.js", service_name: "kept" },
      ]);
    });
  });

  it.each([
    ["dynamic key", "[key]: null"],
    ["spread", "...options"],
  ])(
    "keeps a preceding %s override unknown after an unrelated empty template key",
    (_label, override) => {
      const analysis = analyzeJavaScriptStaticSource(`
        const { BrowserWindow, utilityProcess } = require("electron");
        new BrowserWindow({
          webPreferences: { preload: "./maybe.js" },
          ${override}, [\`\`]: true
        });
        new BrowserWindow({ webPreferences: {
          preload: "./maybe.js", ${override}, [\`\`]: true
        } });
        utilityProcess.fork("./worker.js", [], {
          serviceName: "maybe", ${override}, [\`\`]: true
        });
      `);

      expect(analysis.parse_error_count).toBe(0);
      expect(analysis.parse_status).toBe("partial");
      expect(analysis.electron.browser_windows).toMatchObject([
        {
          web_preferences_status: "dynamic",
          web_preferences: [],
          preload_path: null,
          preload_resolution_context: null,
        },
        {
          web_preferences_status: "object-literal",
          preload_path: null,
          preload_resolution_context: null,
        },
      ]);
      expect(analysis.electron.browser_windows[1]?.web_preferences).toEqual(
        expect.arrayContaining([
          {
            name: "",
            value: { status: "literal", value: true, expression: null },
          },
          {
            name: "preload",
            value: { status: "literal", value: "./maybe.js", expression: null },
          },
          expect.objectContaining({
            name: expect.stringMatching(/^\[(?:dynamic|spread)@/u),
            value: expect.objectContaining({ status: "dynamic", value: null }),
          }),
        ]),
      );
      expect(analysis.electron.utility_processes).toMatchObject([
        { module_path: "./worker.js", service_name: null },
      ]);
    },
  );
});
