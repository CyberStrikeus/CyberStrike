import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import { parseExpression } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { analyzeCommonJsStaticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

it.each([
  ['path.join(__dirname, "page.html")', "page.html", "source-directory"],
  ['path.resolve(__dirname, "page.html")', "page.html", "source-directory"],
  ['__dirname + "/page.html"', "page.html", "source-directory"],
  ['path.join("pages", "page.html")', "pages/page.html", undefined],
  ['path.join("prefix", __dirname, "page.html")', null, undefined],
  ['path.join(__dirname, __dirname, "page.html")', null, undefined],
  ["path.join(__dirname, runtimePage)", null, undefined],
] as const)(
  "retains the owned renderer path base for %s",
  (expression, path, base) => {
    const analysis = analyzeCommonJsStaticFixture(
      `const path=require('node:path');const{BrowserWindow}=require('electron');new BrowserWindow().loadFile(${expression});`,
    );
    if (path === null) {
      expect(analysis.role_paths).toEqual([]);
      expect(
        analysis.analysis_coverage?.semantics.unknown_findings,
      ).toBeGreaterThan(0);
    } else {
      expect(analysis.role_paths).toMatchObject([
        { role: "renderer", path, resolution_context: "filesystem-expression" },
      ]);
      expect(analysis.role_paths[0]?.path_base).toBe(base);
    }
  },
);

it.each(["loadFile", "loadURL"])(
  "reports an unresolved proven BrowserWindow %s expression",
  (method) => {
    const analysis = analyzeCommonJsStaticFixture(
      `const{BrowserWindow}=require('electron');new BrowserWindow().${method}(runtimePage);`,
    );
    expect(analysis.role_paths).toEqual([]);
    expect(
      analysis.analysis_coverage?.semantics.unknown_findings,
    ).toBeGreaterThan(0);
    expect(analysis.limitations).toContain(
      "One or more static keys, expressions, or Electron boundary values were dynamic and remain unknown.",
    );
  },
);
import { parserPluginsForPath } from "./javascriptSourceParser.js";
import {
  calleeName,
  staticPath,
  staticPathResolutionContext,
} from "./javascriptStaticAnalysisHelpers.js";
import type { JavaScriptStaticPathContext } from "./javascriptStaticAnalysisTypes.js";

const absoluteParts = [
  ["/app", "/shared/preload.js"],
  ["ignored", "/app", "preload.js"],
  ["/app", "first", "/shared", "nested", "../preload.js"],
  ["/app", "preload///"],
  ["/app", "../../.."],
  ["///"],
  ["", "/app", "", "preload.js", ""],
];

const anchoredExpressions = [
  ['path.resolve(__dirname, "preload.cjs")', "preload.cjs"],
  ['path[`resolve`](__dirname, "preload.js")', "preload.js"],
  ['path.posix.resolve("ignored", __dirname, "preload.js")', "preload.js"],
  ['path.resolve("/ignored", __dirname, "preload.js")', "preload.js"],
  ['path.resolve(runtimeBase, "/app/preload.js")', "/app/preload.js"],
  ['path.resolve(runtimeBase, __dirname, "preload.js")', "preload.js"],
  ['path.resolve(...parts, "/app/preload.js")', "/app/preload.js"],
  ['path.resolve(42, "/app/preload.js")', "/app/preload.js"],
  [
    'path.resolve(new URL("./", import.meta.url), __dirname, "preload.js")',
    "preload.js",
  ],
  [
    'path.resolve(new URL("./", import.meta.url), dirname(fileURLToPath(import.meta.url)), "preload.js")',
    "preload.js",
  ],
  [
    'path.posix.resolve(new URL("./", import.meta.url), "/app", "preload.js")',
    "/app/preload.js",
  ],
  [
    'path.posix.resolve("ignored", dirname(fileURLToPath(import.meta.url)), "preload.js")',
    "preload.js",
  ],
  [
    'path.resolve("ignored", path.dirname(__filename), "preload.js")',
    "preload.js",
  ],
  ['path.resolve(__dirname, "../preload.js")', "../preload.js"],
  ['path.resolve(__dirname, "sub", __dirname, "preload.js")', "preload.js"],
  ['path.resolve(__dirname, "/shared", "preload.js")', "/shared/preload.js"],
  ["path.resolve(__dirname)", "."],
  ['path.posix.resolve(`/app`, `/shared`, "preload.js")', "/shared/preload.js"],
  ['path.posix.resolve("" + "/app", "preload.js")', "/app/preload.js"],
  ['__dirname + "/preload.js"', "preload.js"],
  ['__dirname + "/" + "preload.js"', "preload.js"],
  ['path.dirname(__filename) + "/lib" + "/preload.js"', "lib/preload.js"],
] as const;

const unknownExpressions = [
  "runtimePath as string",
  "path.join(__dirname as string, runtimeFile as string) as string",
  'path[method](__dirname, "preload.js")',
  'path[`join${suffix}`](__dirname, "preload.js")',
  '(path[method] as typeof path.join)(__dirname, "preload.js")',
  '((useJoin ? path.join : path.resolve) as typeof path.join)(__dirname, "preload.js")',
  'fileURLToPath(new (runtimeURL as typeof URL)("./preload.js", import.meta.url))',
  "path.resolve()",
  "path.posix.resolve()",
  'path.resolve("sub", "../preload.js")',
  'path.resolve("", "")',
  'path.resolve("/app", runtimeFile)',
  "path.resolve(__dirname, runtimeFile)",
  'path.resolve("/app", ...parts)',
  'path.resolve("/app", null)',
  "path.resolve(`/app/${runtimeFile}`)",
  'path.win32.resolve("/app", "/shared/preload.js")',
  'path.win32.resolve(__dirname, "preload.js")',
  'win32.resolve("/app", "preload.js")',
  'resolve("/app", "preload.js")',
  '__dirname + "preload.js"',
  'path.dirname(__filename) + "preload.js"',
  'new URL("./pre%2Fload.js", import.meta.url)',
  'path.join(new URL("./", import.meta.url), "preload.js")',
  'path.resolve(new URL("./", import.meta.url), "preload.js")',
  'path.join(__dirname, new URL("./pre%2Fload.js", import.meta.url))',
  'path.resolve(__dirname, new URL("./", import.meta.url), "preload.js")',
  'path.resolve("/app", new URL("./", import.meta.url), "preload.js")',
];

const pathValueExpressions = [
  ['"./preload.js" as const', "./preload.js", "module-specifier"],
  [
    'path.join(__dirname, "preload.js") as string',
    "preload.js",
    "filesystem-expression",
  ],
  [
    'path.join(__dirname as string, "preload.js" as const)',
    "preload.js",
    "filesystem-expression",
  ],
  [
    'path.resolve(__dirname as string, "preload.js" as const)',
    "preload.js",
    "filesystem-expression",
  ],
  [
    'fileURLToPath(new URL("./preload.js", import.meta.url as string) as URL) as string',
    "./preload.js",
    "filesystem-expression",
  ],
  [
    'path.join(path.dirname(__filename as string), "preload.js")',
    "preload.js",
    "filesystem-expression",
  ],
  [
    'path.join(path.dirname(__filename) as string, "preload.js")',
    "preload.js",
    "filesystem-expression",
  ],
  [
    '((__dirname + "/lib") as string) + "/preload.js"',
    "lib/preload.js",
    "filesystem-expression",
  ],
  ['"/app/preload.js"', "/app/preload.js", "filesystem-expression"],
  ["`/app/preload.js`", "/app/preload.js", "filesystem-expression"],
  [
    'path.join(`/app`, "preload.js")',
    "/app/preload.js",
    "filesystem-expression",
  ],
  ["`./preload.js`", "./preload.js", "module-specifier"],
] as const;

const pathCallTargetExpressions = [
  ['(path.join as typeof path.join)(__dirname, "preload.js")', "preload.js"],
  ['path.join!(__dirname, "preload.js")', "preload.js"],
  [
    '(path.resolve satisfies typeof path.resolve)(__dirname, "preload.js")',
    "preload.js",
  ],
  [
    '((path as typeof path).posix as typeof path.posix).resolve("/app", "preload.js")',
    "/app/preload.js",
  ],
  [
    '(fileURLToPath as typeof fileURLToPath)(new URL("./preload.js", import.meta.url))',
    "./preload.js",
  ],
  [
    'fileURLToPath(new (URL as typeof URL)("./preload.js", import.meta.url))',
    "./preload.js",
  ],
  [
    'fileURLToPath(new (url.URL as typeof URL)("./preload.js", import.meta.url))',
    "./preload.js",
  ],
  [
    'path.join((path.dirname as typeof path.dirname)(__filename), "preload.js")',
    "preload.js",
  ],
  [
    'path.join(dirname((fileURLToPath as typeof fileURLToPath)(import.meta.url)), "preload.js")',
    "preload.js",
  ],
] as const;

describe("inert JavaScript path resolution", () => {
  it.each(pathCallTargetExpressions)(
    "preserves exact path values and context through call target %s",
    (expression, path) => {
      assertPathProjection(expression, path, "filesystem-expression");
    },
  );

  it.each(pathValueExpressions)(
    "preserves exact path values and context through %s",
    (expression, path, context) => {
      assertPathProjection(expression, path, context);
    },
  );

  it.each(absoluteParts)(
    "matches the POSIX resolve oracle for %j",
    (...parts) => {
      assertPathProjection(
        `path.posix.resolve(${parts.map((part) => JSON.stringify(part)).join(", ")})`,
        posix.resolve(...parts),
        "filesystem-expression",
      );
    },
  );

  it.each(anchoredExpressions)(
    "projects the source anchor in %s",
    (expression, path) => {
      assertPathProjection(expression, path, "filesystem-expression");
    },
  );

  it.each([
    [
      'path.join("/app", "/shared/preload.js")',
      posix.join("/app", "/shared/preload.js"),
      "filesystem-expression",
    ],
    [
      'path.posix.join("/app", "preload/")',
      posix.join("/app", "preload/"),
      "filesystem-expression",
    ],
    [
      'path.join("sub", "../preload.js")',
      posix.join("sub", "../preload.js"),
      "filesystem-expression",
    ],
    [
      'path.join(__dirname, "preload.js")',
      "preload.js",
      "filesystem-expression",
    ],
    [
      'path[`join`](__dirname, "preload.js")',
      "preload.js",
      "filesystem-expression",
    ],
    [
      'path.join(__dirname, "/preload.js")',
      "preload.js",
      "filesystem-expression",
    ],
    [
      'path.join(dirname(fileURLToPath(import.meta.url)), "/lib", "/preload.js")',
      "lib/preload.js",
      "filesystem-expression",
    ],
    [
      'path.join("ignored", __dirname, "preload.js")',
      "ignored/preload.js",
      "filesystem-expression",
    ],
    [
      'path.join(dirname(fileURLToPath(import.meta.url)), "preload.js")',
      "preload.js",
      "filesystem-expression",
    ],
    ['join("sub", "preload.js")', "sub/preload.js", "filesystem-expression"],
    ["path.join(__dirname)", ".", "filesystem-expression"],
  ] as const)("preserves join behavior in %s", (expression, path, context) => {
    assertPathProjection(expression, path, context);
  });

  it.each(unknownExpressions)("keeps unsupported %s unknown", (expression) => {
    expect(staticPath(parsePathExpression(expression))).toBeUndefined();
    const { analysis, windowExpression, utilityExpression } =
      analyzePathConsumers(expression);
    expect(analysis.parse_status).toBe("partial");
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.role_paths).toEqual([]);
    expect(analysis.electron.browser_windows).toEqual([
      expect.objectContaining({
        preload_path: null,
        preload_resolution_context: null,
        web_preferences: [
          {
            name: "preload",
            value: { status: "dynamic", value: null, expression },
          },
        ],
        location: lineRange(2, 0, windowExpression.length),
      }),
    ]);
    expect(analysis.electron.utility_processes).toEqual([
      {
        module_path: null,
        module_resolution_context: null,
        module_expression: expression,
        service_name: null,
        module_key: null,
        location: lineRange(3, 0, utilityExpression.length),
      },
    ]);
    expect(analysis.limitations).toContain(
      "One or more static keys, expressions, or Electron boundary values were dynamic and remain unknown.",
    );
  });

  it("keeps recovered templates with invalid escapes unknown as paths", () => {
    const expression = ["`", String.raw`\unicode`, "`"].join("");
    const { analysis } = analyzePathConsumers(expression);

    expect(analysis.parse_status).toBe("partial");
    expect(analysis.parse_error_count).toBe(3);
    expect(analysis.role_paths).toEqual([]);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        preload_path: null,
        preload_resolution_context: null,
        web_preferences: [
          {
            name: "preload",
            value: { status: "dynamic", value: null, expression },
          },
        ],
      },
    ]);
    expect(analysis.electron.utility_processes).toEqual([
      expect.objectContaining({
        module_path: null,
        module_resolution_context: null,
        module_expression: expression,
      }),
    ]);
  });

  it.each([
    "path.join()",
    'path.join("/app", runtimeFile)',
    "path.join(...parts)",
  ])("preserves unresolved join syntax in %s", (expression) =>
    expect(staticPath(parsePathExpression(expression))).toBeUndefined(),
  );
});

it.each([
  "file:///app/preload%20file.js",
  "file:///app/%E2%9C%93.js",
  "file:///app/preload.js?query=1#fragment",
])("decodes literal file URL %s as a filesystem expression", (url) => {
  assertPathProjection(
    `fileURLToPath(${JSON.stringify(url)})`,
    fileURLToPath(url, { windows: false }),
    "filesystem-expression",
  );
});

it("decodes a source-relative file URL once before composing a filesystem path", () => {
  assertPathProjection(
    'fileURLToPath(new URL("./pre%252Fload.js", import.meta.url))',
    "./pre%2Fload.js",
    "filesystem-expression",
  );
  assertPathProjection(
    'path.join(dirname(fileURLToPath(import.meta.url)), "pre%2Fload.js")',
    "pre%2Fload.js",
    "filesystem-expression",
  );
});

it("retains Worker URL references through their separate URL-aware producer", () => {
  const specifier = "./worker%252Fentry.js?version=1#worker";
  const analysis = analyzeCommonJsStaticFixture(`
    import { Worker } from "node:worker_threads";
    new Worker(new URL(${JSON.stringify(specifier)}, import.meta.url));
  `);

  expect(analysis.parse_status).toBe("complete");
  expect(analysis.parse_error_count).toBe(0);
  expect(
    analysis.references
      .filter(({ kind }) => kind === "worker")
      .map(({ specifier, expression }) => ({ specifier, expression })),
  ).toEqual([{ specifier, expression: null }]);
  expect(analysis.role_paths).toEqual([]);
});

it.each([
  'fileURLToPath("file:///app/%2Fpreload.js")',
  'fileURLToPath("file:///app/%5Cpreload.js")',
  'fileURLToPath("file:///app/%")',
  'fileURLToPath("file:///C:/app/preload.js")',
  'fileURLToPath("file://remote/share/preload.js")',
  'fileURLToPath("file:///app/preload.js", options)',
  "fileURLToPath(selectedUrl)",
])("leaves platform-dependent or invalid %s unknown", (expression) =>
  expect(staticPath(parsePathExpression(expression))).toBeUndefined(),
);

const parsePathExpression = (expression: string) =>
  parseExpression(expression, {
    sourceType: "module",
    plugins: parserPluginsForPath("preload.ts"),
  });

const analyzePathConsumers = (expression: string) => {
  const property = `preload: ${expression}`;
  const genericPrefix =
    'import path, {dirname,join} from "node:path"; import url, {fileURLToPath} from "node:url"; const options = { ';
  const windowPrefix = "new BrowserWindow({ webPreferences: { ";
  const windowExpression = `${windowPrefix}${property} } })`;
  const utilityExpression = `utilityProcess.fork(${expression})`;
  return {
    property,
    genericPrefix,
    windowPrefix,
    windowExpression,
    utilityExpression,
    analysis: analyzeCommonJsStaticFixture(
      `${genericPrefix}${property} }; const { BrowserWindow, utilityProcess } = require("electron");\n${windowExpression};\n${utilityExpression};`,
    ),
  };
};

const assertPathProjection = (
  expression: string,
  path: string,
  context: JavaScriptStaticPathContext,
) => {
  const node = parsePathExpression(expression);
  // This syntax matrix supplies identity explicitly; full-source cases prove it.
  const pathIntrinsics = (
    callee: import("@babel/types").Node,
    fact?:
      | "resolve"
      | "join"
      | "file-url-to-path"
      | "source-url"
      | "source-directory",
  ) => {
    if (fact === "source-directory") {
      const name = calleeName(
        callee.type === "CallExpression" ? callee.callee : callee,
      );
      return (
        name === "__dirname" || name === "dirname" || name.endsWith(".dirname")
      );
    }
    if (fact === "source-url") return true;
    const name = calleeName(callee);
    if (fact === "file-url-to-path") return name.endsWith("fileURLToPath");
    return (
      (name === (fact ?? "resolve") ||
        name.endsWith(`.${fact ?? "resolve"}`)) &&
      !name.includes("win32")
    );
  };
  expect(staticPath(node, pathIntrinsics)).toBe(path);
  expect(staticPathResolutionContext(node, pathIntrinsics)).toBe(context);
  const { analysis, windowExpression, utilityExpression } =
    analyzePathConsumers(expression);
  expect(analysis.parse_status).toBe("complete");
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.role_paths).toEqual([
    {
      role: "preload",
      path,
      resolution_context: context,
      mechanism: "BrowserWindow:webPreferences.preload",
      module_key: null,
      location: lineRange(2, 0, windowExpression.length),
    },
  ]);
  expect(analysis.electron.browser_windows).toEqual([
    {
      options_status: "object-literal",
      web_preferences_status: "object-literal",
      web_preferences: [
        {
          name: "preload",
          value: { status: "literal", value: path, expression: null },
        },
      ],
      preload_path: path,
      preload_resolution_context: context,
      module_key: null,
      location: lineRange(2, 0, windowExpression.length),
    },
  ]);
  expect(analysis.electron.utility_processes).toEqual([
    {
      module_path: path,
      module_resolution_context: context,
      module_expression: null,
      service_name: null,
      module_key: null,
      location: lineRange(3, 0, utilityExpression.length),
    },
  ]);
};

const lineRange = (line: number, start: number, end: number) => ({
  start: { line, column: start },
  end: { line, column: end },
});
