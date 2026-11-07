import { runInNewContext } from "node:vm";

import { transformSync } from "esbuild";
import { expect, it } from "vitest";

import type { JavaScriptApplicationGraph } from "../../../src/domain/javascript/javascriptApplicationGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const typeOnlyWorkerImports = [
  'import type { Worker } from "node:worker_threads";',
  'import { type Worker } from "node:worker_threads";',
];

it.each(typeOnlyWorkerImports)(
  "preserves the ambient Worker at runtime after erasing %s",
  (prefix) => {
    const workerUrls: string[] = [];
    const { code } = transformSync(
      `${prefix}\nnew Worker(new URL("./worker.js", import.meta.url));`,
      {
        loader: "ts",
        format: "iife",
        define: {
          "import.meta.url": JSON.stringify("file:///fixture/main.ts"),
        },
      },
    );
    runInNewContext(code, {
      URL,
      Worker: class {
        constructor(url: URL) {
          workerUrls.push(url.href);
        }
      },
    });
    expect(workerUrls).toEqual(["file:///fixture/worker.js"]);
  },
);

const workerReferences = (graph: JavaScriptApplicationGraph) =>
  graph.nodes
    .filter(({ kind }) => kind === "worker")
    .flatMap((node) =>
      node.observations.map(({ properties, evidence }) => ({
        source:
          evidence.location.available &&
          evidence.location.value.kind === "source-range"
            ? evidence.location.value.source
            : null,
        declared_specifier: properties.declared_specifier,
        expression: properties.expression,
        resolved_path: properties.resolved_path,
        mapped_paths: graph.edges
          .filter(
            ({ relation, source_node_id }) =>
              relation === "maps_to" && source_node_id === node.node_id,
          )
          .map(({ properties: edge }) => edge.resolved_path),
      })),
    );

cliTest(
  "promotes Worker URLs only for known constructor bindings through the CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-identity-");
    const identityCases = [
      ...["globalThis", "window", "self"].map((namespace) => ({
        prefix: "",
        constructor: `new ${namespace}.Worker`,
        suffix: "",
        resolves: true,
      })),
      ...["worker_threads", "node:worker_threads"].flatMap((specifier) => [
        {
          prefix: `import { Worker } from "${specifier}";`,
          constructor: "new Worker",
          suffix: "",
          resolves: true,
        },
        {
          prefix: `import * as threads from "${specifier}";`,
          constructor: "new threads.Worker",
          suffix: "",
          resolves: true,
        },
      ]),
      {
        prefix: 'import { Worker as ThreadWorker } from "node:worker_threads";',
        constructor: "new ThreadWorker",
        suffix: "",
        resolves: true,
      },
      {
        prefix: 'import { Worker } from "node:worker_threads";',
        constructor: "new (Worker as typeof Worker)",
        suffix: "",
        resolves: true,
      },
      {
        prefix: 'import * as threads from "node:worker_threads";',
        constructor: "new ((threads as typeof threads).Worker!)",
        suffix: "",
        resolves: true,
      },
      {
        prefix:
          'import { Worker } from "node:worker_threads"; function start(globalThis) { globalThis.URL = Fake;',
        constructor: "new Worker",
        suffix: "}",
        resolves: true,
      },
      {
        prefix: 'globalThis.unrelated = Fake; URL.extra = "metadata";',
        constructor: "new Worker",
        suffix: "",
        resolves: true,
      },
      ...typeOnlyWorkerImports.map((prefix) => ({
        prefix,
        constructor: "new Worker",
        suffix: "",
        resolves: true,
      })),
      ...[
        ["class Worker {}", "new Worker", ""],
        ["globalThis.Worker = Fake;", "new Worker", ""],
        ["globalThis.Worker = Fake;", "new window.Worker", ""],
        ["globalThis = replacement;", "new globalThis.Worker", ""],
        ["function start(Worker) {", "new Worker", "}"],
        ['import { Worker } from "./custom.js";', "new Worker", ""],
        ["const custom = { Worker: class {} };", "new custom.Worker", ""],
        ["function start(window) {", "new window.Worker", "}"],
        ["function start(globalThis) {", "new globalThis.Worker", "}"],
        [
          'import type * as threads from "node:worker_threads";',
          "new threads.Worker",
          "",
        ],
        [
          'import threads from "node:worker_threads"; threads.Worker = Fake;',
          "new threads.Worker",
          "",
        ],
        [
          'const threads = require("node:worker_threads"); threads.Worker = Fake;',
          "new threads.Worker",
          "",
        ],
        [
          'import threads = require("node:worker_threads"); threads.Worker = Fake;',
          "new threads.Worker",
          "",
        ],
        [
          'import { Worker } from "node:worker_threads"; Worker = Fake;',
          "new Worker",
          "",
        ],
        ["", "Worker", ""],
      ].map(([prefix, constructor, suffix]) => ({
        prefix,
        constructor,
        suffix,
        resolves: false,
      })),
    ].map(({ prefix, constructor, suffix, resolves }, index) => ({
      source: `identity-${index}.ts`,
      prefix,
      expression: `${constructor}(new URL("./worker.js", import.meta.url))`,
      suffix,
      resolves,
    }));
    await writeFixtureFiles(root, {
      ...Object.fromEntries(
        identityCases.map(({ source, prefix, expression, suffix }) => [
          source,
          `${prefix}\n${expression};${suffix}`,
        ]),
      ),
      "worker.js": "self.postMessage('existing worker file');",
      "custom.js": "export class Worker {}",
      "custom-alias.mjs":
        'import { Worker as ThreadWorker } from "./custom.js"; new ThreadWorker(new URL("./worker.js", import.meta.url));',
    });
    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const references = workerReferences(result.graph);
    expect(references).toHaveLength(identityCases.length);
    expect(references.some(({ source }) => source === "custom-alias.mjs")).toBe(
      false,
    );
    for (const { source, expression, resolves } of identityCases)
      expect(references).toContainEqual({
        source,
        declared_specifier: resolves ? "./worker.js" : null,
        expression: resolves ? null : expression,
        resolved_path: resolves ? "worker.js" : null,
        mapped_paths: resolves ? ["worker.js"] : [],
      });
  },
);

cliTest(
  "resolves module-relative Worker URL constructors through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-module-url-");
    const cases = [
      {
        source: "nested/relative.mjs",
        expression: 'new Worker(new URL("./worker.js", import.meta.url));',
        specifier: "./worker.js",
        resolved: "nested/worker.js",
      },
      ...[
        'import.meta.unrelated = "metadata";',
        'globalThis["import.meta"] = { url: "file:///other/entry.mjs" };',
        'const meta = import.meta; meta.unrelated = "metadata";',
        'const ambient = globalThis; ambient.unrelated = "metadata";',
        'const copy = { ...import.meta }; Object.defineProperty(copy, "url", { value: "file:///other/entry.mjs" });',
        "const copy = { ...globalThis }; copy.URL = replacement;",
        "function update(globalThis) { const ambient = globalThis; ambient.URL = replacement; } update({});",
        "const define = Object.defineProperty.bind(Object);",
        'Object.defineProperty(...[import.meta, "unrelated", { value: "metadata" }]);',
        'let meta = import.meta; meta = {}; let base = import.meta.url; base = "file:///other/entry.mjs";',
      ].map((mutation, index) => ({
        source: `nested/unrelated-meta-${index}.mjs`,
        expression: `import { Worker } from "node:worker_threads"; ${mutation} new Worker(new URL("./worker.js", import.meta.url));`,
        specifier: "./worker.js",
        resolved: "nested/worker.js",
      })),
      {
        source: "nested/parent.mjs",
        expression:
          'new Worker(new URL("../parent-worker.js", import.meta.url));',
        specifier: "../parent-worker.js",
        resolved: "parent-worker.js",
      },
      {
        source: "nested/dot-segments.mjs",
        expression:
          'new Worker(new URL("./child/.././worker.js", import.meta.url));',
        specifier: "./child/.././worker.js",
        resolved: "nested/worker.js",
      },
      {
        source: "nested/template.mjs",
        expression:
          "new Worker(new URL(`./template-worker.js`, import.meta.url));",
        specifier: "./template-worker.js",
        resolved: "nested/template-worker.js",
      },
      ...[
        'new URL("./worker.js", import.meta.url) as URL',
        '<URL>new URL("./worker.js", import.meta.url)',
        'new URL("./worker.js", import.meta.url)!',
        'new URL("./worker.js", import.meta.url) satisfies URL',
        '((new URL("./worker.js", import.meta.url) as URL)!) satisfies URL',
        'new (URL as typeof URL)("./worker.js", import.meta.url)',
        'new URL("./worker.js" as string, import.meta.url as string)',
        'new URL("./worker.js", (import.meta as ImportMeta).url)',
        'new globalThis.URL("./worker.js", import.meta.url)',
        'new window.URL("./worker.js", import.meta.url)',
        'new self.URL("./worker.js", import.meta.url)',
        'new global.URL("./worker.js", import.meta.url)',
        'new ((globalThis as typeof globalThis)["URL"]!)("./worker.js", import.meta.url)',
      ].map((urlExpression, index) => ({
        source: `nested/typed-${index}.ts`,
        expression: `new Worker(${urlExpression});`,
        specifier: "./worker.js",
        resolved: "nested/worker.js",
      })),
      {
        source: "nested/space.mjs",
        expression:
          'new Worker(new URL("./space%20worker.js?worker=1#entry", import.meta.url));',
        specifier: "./space%20worker.js?worker=1#entry",
        resolved: "nested/space worker.js",
      },
      {
        source: "nested/percent.mjs",
        expression:
          'new Worker(new URL("./percent%2520worker.js", import.meta.url));',
        specifier: "./percent%2520worker.js",
        resolved: "nested/percent%20worker.js",
      },
      {
        source: "nested/literal-percent.mjs",
        expression:
          'new Worker(new URL("./percent%25worker.js", import.meta.url));',
        specifier: "./percent%25worker.js",
        resolved: "nested/percent%worker.js",
      },
      ...["?value=", "#value="].map((suffix, index) => {
        const specifier = `./worker.js${suffix}%2F%2E%5C%00%FF%GG%2%\\\0`;
        return {
          source: `nested/suffix-${index}.mjs`,
          expression: `new Worker(new URL(${JSON.stringify(specifier)}, import.meta.url));`,
          specifier,
          resolved: "nested/worker.js",
        };
      }),
      {
        source: "bundled/entry.mjs",
        expression:
          'self.webpackChunkdemo.push([[1], {1: function(module, exports, require) { new Worker(new URL("./worker.js", import.meta.url)); }, "./worker.js": function(module) { module.exports = 42; }}]);',
        specifier: "./worker.js",
        resolved: "bundled/worker.js",
      },
    ];
    await writeFixtureFiles(root, {
      ...Object.fromEntries(
        cases.flatMap(({ source, expression, resolved }) => [
          [source, expression],
          [resolved, `self.postMessage(${JSON.stringify(resolved)});`],
        ]),
      ),
      "nested/percent worker.js": "self.postMessage('double-decoding decoy');",
    });

    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    expect(workerReferences(result.graph)).toEqual(
      expect.arrayContaining(
        cases.map(({ source, specifier, resolved }) => ({
          source,
          declared_specifier: specifier,
          expression: null,
          resolved_path: resolved,
          mapped_paths: [resolved],
        })),
      ),
    );
    expect(workerReferences(result.graph)).toHaveLength(cases.length);
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "javascript-module",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({ module_key: "./worker.js" }),
          }),
        ]),
      }),
    );
  },
);

cliTest(
  "keeps unsupported Worker URL expressions and missing exact files unresolved through the CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-url-unknown-");
    const malformedPercentPaths = [
      ["./worker%.js", "worker%.js"],
      ["./worker%2.js", "worker%2.js"],
      ["./worker%GG.js", "worker%GG.js"],
      ["./space%20worker%GG.js", "space worker%GG.js"],
    ];
    const expressions = {
      "dynamic-path.mjs": "new Worker(new URL(path, import.meta.url));",
      "absolute.mjs":
        'import { Worker } from "node:worker_threads"; new Worker(new URL("/worker.js", import.meta.url));',
      "typed-apply-meta.ts":
        'import { Worker } from "node:worker_threads"; Object.defineProperty.apply(Object, ([import.meta, "url", { value: "file:///other.mjs" }] as const)); new Worker(new URL("./worker.js", import.meta.url));',
      "overwritten-qualified-url.mjs":
        'globalThis.URL = replacement; new Worker(new globalThis.URL("./worker.js", import.meta.url));',
      "shadowed-qualified-url.mjs":
        'function start(window) { new Worker(new window.URL("./worker.js", import.meta.url)); }',
      ...Object.fromEntries(
        ["globalThis.URL", "URL", 'globalThis["URL"]'].map((target, index) => [
          `overwritten-url-${index}.mjs`,
          `import { Worker } from "node:worker_threads"; const RealURL = URL; ${target} = class { constructor() { return new RealURL("./other.js", import.meta.url); } }; new Worker(new URL("./worker.js", import.meta.url));`,
        ]),
      ),
      ...Object.fromEntries(
        [
          "delete globalThis.URL;",
          "({ URL: globalThis.URL } = replacements);",
          "globalThis[key] = replacement;",
          'Object.defineProperty(globalThis, "URL", { value: replacement });',
          'Reflect.set(globalThis, "URL", replacement);',
          "globalThis.globalThis.URL = replacement;",
          "globalThis.global.URL = replacement;",
          "const ambient = globalThis; ambient.URL = replacement;",
          "const { globalThis: ambient } = globalThis; ambient.URL = replacement;",
        ].map((mutation, index) => [
          `mutated-url-${index}.mjs`,
          `import { Worker } from "node:worker_threads"; ${mutation} new Worker(new URL("./worker.js", import.meta.url));`,
        ]),
      ),
      ...Object.fromEntries(
        [
          'import.meta.url = "file:///other/entry.mjs";',
          "delete import.meta.url;",
          'Object.defineProperty(import.meta, "url", { value: "file:///other/entry.mjs" });',
          "import.meta[key] = replacement;",
          'const meta = import.meta; const alias = meta; alias.url = "file:///other/entry.mjs";',
          'let meta = import.meta; meta.url = "file:///other/entry.mjs"; meta = {};',
          'const define = Object.defineProperty; define(import.meta, "url", { value: "file:///other/entry.mjs" });',
          'const set = Reflect.set.bind(Reflect); set(import.meta, "url", "file:///other/entry.mjs");',
          'Object.defineProperty.bind(Object, import.meta, "url")({ value: "file:///other/entry.mjs" });',
          'Object.assign(...[import.meta, { url: "file:///other/entry.mjs" }]);',
          'Object.defineProperty(...[import.meta, "url", { value: "file:///other/entry.mjs" }]);',
        ].map((mutation, index) => [
          `mutated-import-meta-${index}.mjs`,
          `import { Worker } from "node:worker_threads"; ${mutation} new Worker(new URL("./worker.js", import.meta.url));`,
        ]),
      ),
      ...Object.fromEntries(
        malformedPercentPaths.map(([specifier], index) => [
          `malformed-percent-${index}.mjs`,
          `import { Worker } from "node:worker_threads"; new Worker(new URL(${JSON.stringify(specifier)}, import.meta.url));`,
        ]),
      ),
      "dynamic-base.mjs": 'new Worker(new URL("./worker.js", base));',
      "empty-worker-url.mjs": 'new Worker("");',
      "query-only-worker-url.mjs": 'new Worker("?cache=1");',
      "fragment-only-worker-url.mjs": 'new Worker("#worker");',
      "shadowed.mjs":
        'function start(URL) { return new Worker(new URL("./worker.js", import.meta.url)); }',
      "typed-shadowed.ts":
        'function start(URL: typeof globalThis.URL) { return new Worker((new (URL as typeof globalThis.URL)("./worker.js", import.meta.url) as URL)!); }',
      "typed-dynamic-path.ts":
        "new Worker((new URL(path as string, import.meta.url) as URL)!);",
      "typed-dynamic-base.ts":
        'new Worker((new URL("./worker.js", base as string) as URL)!);',
      "call.mjs": 'new Worker(URL("./worker.js", import.meta.url));',
      "custom.mjs":
        'new Worker(new custom.URL("./worker.js", import.meta.url));',
      "extension.mjs":
        'new Worker(new URL("./extensionless", import.meta.url));',
      "directory.mjs": 'new Worker(new URL("./directory", import.meta.url));',
      "directory-dot.mjs":
        'new Worker(new URL("./worker.js/.", import.meta.url));',
      "directory-parent.mjs":
        'new Worker(new URL("./worker.js/child/..", import.meta.url));',
      "empty-segment.mjs":
        'new Worker(new URL("./child//../worker.js", import.meta.url));',
      "package.mjs":
        'new Worker(new URL("./package-worker", import.meta.url));',
      "external.mjs":
        'new Worker(new URL("https://example.test/worker.js", import.meta.url));',
      "empty.mjs": 'new Worker(new URL("", import.meta.url));',
      "query.mjs": 'new Worker(new URL("?worker=1", import.meta.url));',
      "whitespace.mjs":
        'new Worker(new URL(" ./worker.js ", import.meta.url));',
      "control.mjs": 'new Worker(new URL("./worker\\t.js", import.meta.url));',
      "leading-control.mjs":
        'new Worker(new URL("\\u0001./worker.js", import.meta.url));',
    };
    const knownSpecifiers: Readonly<Record<string, string>> = {
      "extension.mjs": "./extensionless",
      "directory.mjs": "./directory",
      "directory-dot.mjs": "./worker.js/.",
      "directory-parent.mjs": "./worker.js/child/..",
      "empty-segment.mjs": "./child//../worker.js",
      "package.mjs": "./package-worker",
      "external.mjs": "https://example.test/worker.js",
    };
    await writeFixtureFiles(root, {
      ...expressions,
      ...Object.fromEntries(
        malformedPercentPaths.map(([, decoy]) => [
          decoy,
          "self.postMessage('malformed percent pathname decoy');",
        ]),
      ),
      "worker.js": "self.postMessage('existing decoy');",
      "other.js": "self.postMessage('custom URL result decoy');",
      "extensionless.js": "self.postMessage('extension decoy');",
      "directory/index.js": "self.postMessage('index decoy');",
      "package-worker/package.json": JSON.stringify({ main: "selected.js" }),
      "package-worker/selected.js": "self.postMessage('package main decoy');",
    });

    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const references = workerReferences(result.graph);
    expect(references).toHaveLength(Object.keys(expressions).length);
    for (const [source, expression] of Object.entries(expressions)) {
      const specifier = knownSpecifiers[source] ?? null;
      expect(references).toContainEqual(
        expect.objectContaining({
          source,
          declared_specifier: specifier,
          expression:
            specifier === null
              ? expression.slice(
                  expression.indexOf("new Worker("),
                  expression.lastIndexOf(";"),
                )
              : null,
          resolved_path: null,
          mapped_paths: [],
        }),
      );
    }
  },
);

cliTest(
  "keeps string Worker paths unresolved because the document base is unknown",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-document-base-");
    // A browser resolves these strings against the document base URL, not the
    // calling script; Node resolves them against the working directory.
    const expressions = {
      "scripts/main.js": 'new Worker("./worker.js")',
      "scripts/service.js": 'navigator.serviceWorker.register("./sw.js")',
    };
    await writeFixtureFiles(root, {
      "index.html": '<script src="./scripts/main.js"></script>',
      ...Object.fromEntries(
        Object.entries(expressions).map(([path, code]) => [path, `${code};`]),
      ),
      "worker.js": "self.postMessage('document-relative worker');",
      "scripts/worker.js": "self.postMessage('script-relative decoy');",
      "scripts/sw.js": "self.postMessage('script-relative decoy');",
    });

    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    for (const [source, expression] of Object.entries(expressions)) {
      const node = result.graph.nodes.find(
        ({ kind, observations }) =>
          (kind === "worker" || kind === "service-worker") &&
          observations.some(
            ({ evidence }) =>
              evidence.location.available &&
              evidence.location.value.kind === "source-range" &&
              evidence.location.value.source === source,
          ),
      );
      expect(node?.observations).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            declared_specifier: null,
            expression,
            resolved_path: null,
          }),
        }),
      );
      expect(
        result.graph.edges.some(
          ({ relation, source_node_id }) =>
            relation === "maps_to" && source_node_id === node?.node_id,
        ),
      ).toBe(false);
    }
  },
);

cliTest(
  "bounds repeated ambient alias branches through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-alias-branches-");
    const aliases = [
      "const alias0 = globalThis;",
      ...Array.from(
        { length: 40 },
        (_, index) =>
          `const alias${index + 1} = flag${index} ? alias${index} : alias${index};`,
      ),
      "alias40.URL = replacement;",
    ].join("\n");
    const splitAliases = [
      "const alias0 = globalThis;",
      ...Array.from(
        { length: 40 },
        (_, index) =>
          `const left${index} = alias${index}; const right${index} = alias${index}; const alias${index + 1} = flag${index} ? left${index} : right${index};`,
      ),
      "alias40.URL = replacement;",
    ].join("\n");
    const memberAliases = [
      "const alias0 = globalThis;",
      ...Array.from(
        { length: 40 },
        (_, index) =>
          `const alias${index + 1} = flag${index} ? alias${index}.globalThis : alias${index}.window;`,
      ),
      "alias40.URL = replacement;",
    ].join("\n");
    const expression = 'new Worker(new URL("./worker.js", import.meta.url))';
    await writeFixtureFiles(root, {
      "entry.mjs": `import { Worker } from "node:worker_threads";\n${aliases}\n${expression};`,
      "split.mjs": `import { Worker } from "node:worker_threads";\n${splitAliases}\n${expression};`,
      "member.mjs": `import { Worker } from "node:worker_threads";\n${memberAliases}\n${expression};`,
      "worker.js": "self.postMessage('existing alias-mutation decoy');",
    });

    const result = await analyzeJavaScriptDirectory(
      "CLI",
      { run: (invocation) => cli.run({ ...invocation, timeoutMs: 20_000 }) },
      root,
    );
    expect(result.statistics.parse_failures).toBe(0);
    const references = workerReferences(result.graph);
    expect(references).toHaveLength(3);
    expect(references).toEqual(
      expect.arrayContaining(
        ["entry.mjs", "split.mjs", "member.mjs"].map((source) => ({
          source,
          declared_specifier: null,
          expression,
          resolved_path: null,
          mapped_paths: [],
        })),
      ),
    );
  },
);

cliTest(
  "keeps Node Worker filesystem strings unresolved through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-node-worker-filesystem-");
    const cases = [
      {
        prefix: 'import { Worker } from "node:worker_threads";',
        expression: 'new Worker("./worker.js")',
      },
      {
        prefix: 'import { Worker as ThreadWorker } from "worker_threads";',
        expression: 'new ThreadWorker("/worker.js")',
      },
      {
        prefix: 'import * as threads from "node:worker_threads";',
        expression: 'new threads.Worker("./worker.js")',
      },
      {
        prefix: 'import { Worker } from "node:worker_threads";',
        expression: 'new (Worker as typeof Worker)("/worker.js")',
      },
      {
        prefix: 'import * as threads from "node:worker_threads";',
        expression: 'new ((threads as typeof threads).Worker!)("./worker.js")',
      },
    ].map((fixture, index) => ({
      ...fixture,
      source: `nested/node-literal-${index}.ts`,
    }));
    await writeFixtureFiles(root, {
      ...Object.fromEntries(
        cases.map(({ prefix, expression, source }) => [
          source,
          `${prefix}\n${expression};`,
        ]),
      ),
      "worker.js": "self.postMessage('filesystem-root decoy');",
      "nested/worker.js": "self.postMessage('source-sibling decoy');",
    });

    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const references = workerReferences(result.graph);
    expect(references).toHaveLength(cases.length);
    for (const { source, expression } of cases)
      expect(references).toContainEqual({
        source,
        declared_specifier: null,
        expression,
        resolved_path: null,
        mapped_paths: [],
      });
  },
);

// Windows cannot materialize the pipe-named directory needed for this decoy.
cliTest.skipIf(process.platform === "win32")(
  "keeps file-URL drive letters distinct from encoded POSIX paths through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-url-drive-");
    await writeFixtureFiles(root, {
      "dist/drive.mjs": 'new Worker(new URL("c|/worker.js", import.meta.url));',
      "dist/encoded.mjs":
        'new Worker(new URL("c%7C/worker.js", import.meta.url));',
      "dist/c|/worker.js": "self.postMessage('existing relative-path decoy');",
    });

    const result = await analyzeJavaScriptDirectory("CLI", cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const references = workerReferences(result.graph);
    expect(references).toHaveLength(2);
    expect(references).toEqual(
      expect.arrayContaining([
        {
          source: "dist/drive.mjs",
          declared_specifier: "c|/worker.js",
          expression: null,
          resolved_path: null,
          mapped_paths: [],
        },
        {
          source: "dist/encoded.mjs",
          declared_specifier: "c%7C/worker.js",
          expression: null,
          resolved_path: "dist/c|/worker.js",
          mapped_paths: ["dist/c|/worker.js"],
        },
      ]),
    );
  },
);
