import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { parseReferenceSourceEntries } from "./ReferenceSourceImportEntries.js";
import { historicalSourceLanguages } from "../domain/referenceSourceGraph.js";
import type { ReferenceSourceRead } from "../reference/ReferenceSourceReaderTypes.js";

it("projects an unsupported non-regular entry as unknown kind instead of file", () => {
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: [
      {
        status: "failed",
        kind: "other",
        path: "src/pipe",
        code: "unsupported",
        message: "Entry is not a regular file",
        size: 0,
      },
    ],
    bytesRead: 0,
    limitations: [],
  };
  const parsed = parseReferenceSourceEntries(read, []);
  expect(parsed.entries).toContainEqual({
    path: "src/pipe",
    kind: "unknown",
    classifications: ["unknown"],
    limitations: [
      "Entry is not a regular file Exclude this entry or replace it with a regular file.",
    ],
  });
  expect(parsed.entries.some((entry) => entry.kind === "file")).toBe(false);
});

it("keeps a failed regular file as file kind", () => {
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: [
      {
        status: "failed",
        kind: "file",
        path: "src/broken.ts",
        code: "io",
        message: "Entry could not be read",
      },
    ],
    bytesRead: 0,
    limitations: [],
  };
  const parsed = parseReferenceSourceEntries(read, []);
  expect(parsed.entries).toContainEqual({
    path: "src/broken.ts",
    kind: "file",
    sha256: null,
    size: null,
    language: null,
    classifications: ["source"],
    content_state: "unreadable",
    limitations: [
      "Entry could not be read This file could not be read. Check its permissions, then try again.",
    ],
  });
});

it("keeps source entries when a module has an empty specifier", () => {
  const files = [
    ["main.mjs", 'import "";\n'],
    ["other.txt", "retained\n"],
  ] as const;
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: files.map(([path, content]) => ({
      status: "read",
      kind: "file",
      path,
      bytes: Buffer.from(content),
      size: Buffer.byteLength(content),
    })),
    bytesRead: files.reduce(
      (sum, [, content]) => sum + Buffer.byteLength(content),
      0,
    ),
    limitations: [],
  };

  const parsed = parseReferenceSourceEntries(read, []);

  expect(parsed.entries.map(({ path }) => path)).toEqual([
    "main.mjs",
    "other.txt",
  ]);
  expect(parsed.relationships).toEqual([]);
  expect(parsed.limitations).toEqual([
    "Empty module specifier in main.mjs was not recorded as a relationship.",
  ]);
});

it("retains Kotlin source identity and language across the inventory projection", () => {
  const files = [
    [
      "MainActivity.kt",
      "import android.app.Activity\nclass MainActivity : Activity()\n",
      ["source"],
      "Kotlin",
    ],
    ["task.kts", 'println("hello")\n', ["source"], "Kotlin"],
    [
      "build.gradle.kts",
      'plugins { kotlin("jvm") version "2.3.0" }\n',
      ["manifest", "source"],
      "Kotlin",
    ],
    ["MainActivity.kt.backup", "backup\n", ["unknown"], null],
    ["Legacy.java", "class Legacy {}\n", ["source"], "Java"],
  ] as const;
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: files.map(([path, content]) => ({
      status: "read",
      kind: "file",
      path,
      bytes: Buffer.from(content),
      size: Buffer.byteLength(content),
    })),
    bytesRead: files.reduce(
      (sum, [, content]) => sum + Buffer.byteLength(content),
      0,
    ),
    limitations: [],
  };
  const parsed = parseReferenceSourceEntries(read, []);
  for (const [path, content, classifications, language] of files)
    expect(parsed.entries).toContainEqual({
      path,
      kind: "file",
      language,
      classifications,
      size: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
      content_state: "hashed",
      limitations: [],
    });
  expect(historicalSourceLanguages(parsed.entries)).toEqual(["Java", "Kotlin"]);
  expect(parsed.parseFailures).toEqual([]);
  expect(parsed.relationships).toEqual([]);
});

it("resolves declared package mains and index fallback from source-owned fields", () => {
  const files = [
    [
      "main.cjs",
      'require("./pkg");\nrequire("./dep");\nrequire("./fallback");\n',
    ],
    [
      "main.cts",
      'import dep = require("./typed");\n' +
        'require("./typed");\n' +
        'import data = require("./json-package");\n' +
        'require("./emitted.js");\n',
    ],
    ["pkg/package.json", '{"main":"actual.js"}\n'],
    ["pkg/actual.js", 'module.exports = "package main";\n'],
    ["fallback/package.json", "{}\n"],
    ["fallback/index.js", 'module.exports = "index";\n'],
    ["fallback/phantom.js", 'module.exports = "host decoy";\n'],
    ["dep.js", 'module.exports = "file";\n'],
    ["dep/index.ts", 'export const value = "index";\n'],
    ["typed.js", 'module.exports = "runtime file";\n'],
    ["typed/index.ts", 'export const value = "source index";\n'],
    ["json-package/package.json", '{"main":"data"}\n'],
    ["json-package/data.json", '{"value":"package main"}\n'],
    ["json-package/index.js", 'module.exports = "fallback index";\n'],
    ["emitted.ts", 'export const value = "source counterpart";\n'],
  ] as const;
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: files.map(([path, content]) => ({
      status: "read",
      kind: "file",
      path,
      bytes: Buffer.from(content),
      size: Buffer.byteLength(content),
    })),
    bytesRead: files.reduce(
      (sum, [, content]) => sum + Buffer.byteLength(content),
      0,
    ),
    limitations: [],
  };

  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "main");
  let parsed: ReturnType<typeof parseReferenceSourceEntries>;
  try {
    Object.defineProperty(Object.prototype, "main", {
      configurable: true,
      writable: true,
      value: "phantom.js",
    });
    parsed = parseReferenceSourceEntries(read, []);
  } finally {
    if (previous === undefined)
      Reflect.deleteProperty(Object.prototype, "main");
    else Object.defineProperty(Object.prototype, "main", previous);
  }

  expect(parsed.relationships).toContainEqual({
    from_path: "main.cjs",
    to: "fallback/index.js",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
  expect(parsed.relationships).toContainEqual({
    from_path: "main.cjs",
    to: "pkg/actual.js",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
  expect(parsed.relationships).toContainEqual({
    from_path: "main.cjs",
    to: "dep.js",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
  expect(parsed.relationships).toContainEqual({
    from_path: "main.cts",
    to: "typed/index.ts",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
  expect(parsed.relationships).toContainEqual({
    from_path: "main.cts",
    to: "typed.js",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
  expect(parsed.relationships).toContainEqual({
    from_path: "main.cts",
    to: "json-package/data.json",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
  expect(parsed.relationships).toContainEqual({
    from_path: "main.cts",
    to: "emitted.ts",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
});

it("matches package manifests by exact or unique canonical directory identity", () => {
  const composed = "caf\u00e9";
  const decomposed = "cafe\u0301";
  const composedTwin = "r\u00e9sum\u00e9";
  const decomposedTwin = "re\u0301sume\u0301";
  const files = [
    [
      "main.cjs",
      [composed, composedTwin, decomposedTwin]
        .map((name) => `require(${JSON.stringify(`./${name}`)});`)
        .join("\n"),
    ],
    [`${decomposed}/package.json`, '{"main":"unique.js"}\n'],
    [`${decomposed}/unique.js`, 'module.exports = "unique";\n'],
    [`${composed}/unique.js`, 'module.exports = "unrelated exact spelling";\n'],
    [`${composedTwin}/package.json`, '{"main":"exact-composed.js"}\n'],
    [`${composedTwin}/exact-composed.js`, 'module.exports = "composed";\n'],
    [`${decomposedTwin}/package.json`, '{"main":"exact-decomposed.js"}\n'],
    [
      `${decomposedTwin}/exact-decomposed.js`,
      'module.exports = "decomposed";\n',
    ],
  ] as const;
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: files.map(([path, content]) => ({
      status: "read",
      kind: "file",
      path,
      bytes: Buffer.from(content),
      size: Buffer.byteLength(content),
    })),
    bytesRead: files.reduce(
      (sum, [, content]) => sum + Buffer.byteLength(content),
      0,
    ),
    limitations: [],
  };

  const parsed = parseReferenceSourceEntries(read, []);

  expect(parsed.relationships.map(({ to }) => to)).toEqual([
    `${decomposed}/unique.js`,
    `${composedTwin}/exact-composed.js`,
    `${decomposedTwin}/exact-decomposed.js`,
  ]);
});

it("resolves extensionless imports and requires to .mts and .cts files and directory indexes", () => {
  const files = [
    [
      "src/index.ts",
      'import "./esm";\nimport "./pkg-esm";\nimport cjs = require("./cjs");\nimport pkgCjs = require("./pkg-cjs");\n',
    ],
    ["src/esm.mts", "export const esm = 1;\n"],
    ["src/pkg-esm/index.mts", "export const pkgEsm = 2;\n"],
    ["src/cjs.cts", "module.exports = { cjs: 3 };\n"],
    ["src/pkg-cjs/index.cts", "module.exports = { pkgCjs: 4 };\n"],
  ] as const;
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    entries: files.map(([path, content]) => ({
      status: "read",
      kind: "file",
      path,
      bytes: Buffer.from(content),
      size: Buffer.byteLength(content),
    })),
    bytesRead: files.reduce(
      (sum, [, content]) => sum + Buffer.byteLength(content),
      0,
    ),
    limitations: [],
  };
  const parsed = parseReferenceSourceEntries(read, []);
  expect(parsed.relationships).toEqual(
    expect.arrayContaining([
      {
        from_path: "src/index.ts",
        to: "src/esm.mts",
        kind: "imports",
        resolution: "internal",
        parse_state: "parsed",
      },
      {
        from_path: "src/index.ts",
        to: "src/pkg-esm/index.mts",
        kind: "imports",
        resolution: "internal",
        parse_state: "parsed",
      },
      {
        from_path: "src/index.ts",
        to: "src/cjs.cts",
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      },
      {
        from_path: "src/index.ts",
        to: "src/pkg-cjs/index.cts",
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      },
    ]),
  );
});

it("does not infer missing candidates or manifests from partial directory enumeration", () => {
  const file = (
    path: string,
    content: string,
  ): ReferenceSourceRead["entries"][number] => ({
    status: "read",
    kind: "file",
    path,
    bytes: Buffer.from(content),
    size: Buffer.byteLength(content),
  });
  const read: ReferenceSourceRead = {
    root: "/selected/source",
    bytesRead: 0,
    limitations: [],
    entries: [
      file("package.json", '{"type":"commonjs"}'),
      file(
        "main.cjs",
        'require("./pkg"); require("./other"); require("./exact.js");',
      ),
      file("pkg/index.js", "module.exports = 1;"),
      file("other/index.js", "module.exports = 1;"),
      file("exact.js", "module.exports = 1;"),
      file("pkg/source.js", 'require("../exact.js");'),
      {
        status: "failed",
        kind: "directory",
        path: "pkg",
        code: "io",
        message: "Partial enumeration",
      },
      { status: "read", kind: "directory", path: "other" },
    ],
  };
  const parsed = parseReferenceSourceEntries(read, []);
  expect(
    parsed.relationships.filter(({ from_path }) => from_path === "main.cjs"),
  ).toEqual([
    expect.objectContaining({ to: "pkg", resolution: "unresolved" }),
    expect.objectContaining({ to: "other/index.js", resolution: "internal" }),
    expect.objectContaining({ to: "exact.js", resolution: "internal" }),
  ]);
  expect(
    parsed.relationships.filter(
      ({ from_path }) => from_path === "pkg/source.js",
    ),
  ).not.toContainEqual(expect.objectContaining({ resolution: "internal" }));
  const partialRoot = parseReferenceSourceEntries(
    { ...read, rootFailure: { code: "io", message: "Partial root" } },
    [],
  );
  expect(
    partialRoot.relationships.find(
      ({ from_path, to }) =>
        from_path === "main.cjs" && to === "other/index.js",
    ),
  ).toBeUndefined();
  expect(partialRoot.relationships).toContainEqual(
    expect.objectContaining({
      from_path: "main.cjs",
      to: "exact.js",
      resolution: "internal",
    }),
  );
});

it.each(["failed", "excluded"] as const)(
  "keeps higher priority %s candidates unknown",
  (state) => {
    const files = [
      ["main.cjs", 'require("./pkg"); require("./pkg/index.js");'],
      ["pkg/index.js", "module.exports = 1;"],
    ] as const;
    const read: ReferenceSourceRead = {
      root: "/selected/source",
      bytesRead: 0,
      limitations: [],
      entries: [
        ...files.map(([path, content]) => ({
          status: "read" as const,
          kind: "file" as const,
          path,
          bytes: Buffer.from(content),
          size: Buffer.byteLength(content),
        })),
        ...(state === "failed"
          ? [
              {
                status: "failed" as const,
                kind: "file" as const,
                path: "pkg.js",
                code: "io" as const,
                message: "Unreadable",
              },
            ]
          : []),
      ],
    };
    const parsed = parseReferenceSourceEntries(
      read,
      state === "excluded"
        ? [
            {
              path: "pkg.js",
              entry_kind: "file",
              reason: "caller-excluded",
              pattern: "pkg.js",
            },
          ]
        : [],
    );
    expect(parsed.relationships).toEqual([
      expect.objectContaining({ to: "pkg", resolution: "unresolved" }),
      expect.objectContaining({ to: "pkg/index.js", resolution: "internal" }),
    ]);
  },
);

it("retains observed manifests and closer completed scopes inside a partial inventory", () => {
  const files = [
    ["main.cjs", 'require("./pkg");'],
    ["pkg/package.json", '{"main":"entry.js","type":"commonjs"}'],
    ["pkg/entry.js", 'require("./known.js");'],
    ["pkg/known.js", "module.exports = 1;"],
    ["complete/source.js", 'require("./known.js");'],
    ["complete/known.js", "module.exports = 1;"],
    ["complete/package.json", '{"type":"commonjs"}'],
  ] as const;
  const parsed = parseReferenceSourceEntries(
    {
      root: "/selected/source",
      bytesRead: 0,
      limitations: [],
      entries: [
        ...files.map(([path, content]) => ({
          status: "read" as const,
          kind: "file" as const,
          path,
          bytes: Buffer.from(content),
          size: Buffer.byteLength(content),
        })),
        {
          status: "failed",
          kind: "directory",
          path: "pkg",
          code: "io",
          message: "Partial enumeration",
        },
        { status: "read", kind: "directory", path: "complete" },
      ],
    },
    [],
  );
  expect(parsed.relationships).toEqual([
    expect.objectContaining({
      from_path: "main.cjs",
      to: "pkg/entry.js",
      resolution: "internal",
    }),
    expect.objectContaining({
      from_path: "pkg/entry.js",
      to: "pkg/known.js",
      resolution: "internal",
    }),
    expect.objectContaining({
      from_path: "complete/source.js",
      to: "complete/known.js",
      resolution: "internal",
    }),
  ]);
});

it("keeps ambiguous directory coverage unknown while honoring exact directory identity", () => {
  const first = "a\u0301\u0323";
  const second = "a\u0323\u0301";
  const ambiguous = "\u1ea1\u0301";
  const files = [
    ["main.cjs", `require("./${ambiguous}/dep"); require("./${second}/dep");`],
    [`${ambiguous}/dep.js`, "module.exports = 1;"],
    [`${second}/dep.js`, "module.exports = 2;"],
  ] as const;
  const parsed = parseReferenceSourceEntries(
    {
      root: "/selected/source",
      bytesRead: 0,
      limitations: [],
      entries: [
        ...files.map(([path, content]) => ({
          status: "read" as const,
          kind: "file" as const,
          path,
          bytes: Buffer.from(content),
          size: Buffer.byteLength(content),
        })),
        {
          status: "failed",
          kind: "directory",
          path: first,
          code: "io",
          message: "Partial enumeration",
        },
        { status: "read", kind: "directory", path: second },
      ],
    },
    [],
  );
  expect(parsed.relationships).toEqual([
    expect.objectContaining({
      to: `${ambiguous}/dep`,
      resolution: "unresolved",
    }),
    expect.objectContaining({ to: `${second}/dep.js`, resolution: "internal" }),
  ]);
});

it("does not skip an ambiguous higher priority file for an observed extension fallback", () => {
  const first = "a\u0301\u0323";
  const second = "a\u0323\u0301";
  const ambiguous = "\u1ea1\u0301";
  const files = [
    ["main.cjs", `require("./${ambiguous}"); require("./${first}");`],
    [first, "module.exports = 1;"],
    [second, "module.exports = 2;"],
    [`${ambiguous}.js`, "module.exports = 3;"],
  ] as const;
  const parsed = parseReferenceSourceEntries(
    {
      root: "/selected/source",
      bytesRead: 0,
      limitations: [],
      entries: files.map(([path, content]) => ({
        status: "read" as const,
        kind: "file" as const,
        path,
        bytes: Buffer.from(content),
        size: Buffer.byteLength(content),
      })),
    },
    [],
  );
  expect(parsed.relationships).toEqual([
    expect.objectContaining({ to: ambiguous, resolution: "unresolved" }),
    expect.objectContaining({ to: first, resolution: "internal" }),
  ]);
});

it("prefers a later exact filename over an earlier unique canonical candidate", () => {
  const composed = "caf\u00e9";
  const decomposed = "cafe\u0301";
  const files = [
    ["main.cjs", `require("./${composed}");`],
    [decomposed, "module.exports = 1;"],
    [`${composed}.js`, "module.exports = 2;"],
  ] as const;
  const parsed = parseReferenceSourceEntries(
    {
      root: "/selected/source",
      bytesRead: 0,
      limitations: [],
      entries: files.map(([path, content]) => ({
        status: "read" as const,
        kind: "file" as const,
        path,
        bytes: Buffer.from(content),
        size: Buffer.byteLength(content),
      })),
    },
    [],
  );
  expect(parsed.relationships).toEqual([
    expect.objectContaining({ to: `${composed}.js`, resolution: "internal" }),
  ]);
});
