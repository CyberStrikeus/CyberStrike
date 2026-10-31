import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createPackageWithOptions } from "@electron/asar";
import { parse } from "@babel/parser";
import { expect } from "vitest";

import type { JavaScriptApplicationGraph } from "../../src/domain/javascript/javascriptApplicationGraph.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

export const typeScriptDialectCases = [
  {
    path: "assertion.ts",
    kind: "static-import",
    source: 'const value = <number>1;\nimport "./dep.js";',
  },
  {
    path: "wrapped.ts",
    kind: "require",
    source: 'const value = <unknown>require("./dep.js");',
  },
  {
    path: "as.ts",
    kind: "static-import",
    source: 'const value = 1 as number;\nimport "./dep.js";',
  },
  {
    path: "wrapped-as.ts",
    kind: "require",
    source: 'const value = require("./dep.js") as unknown;',
  },
  {
    path: "generic.ts",
    kind: "static-import",
    source: 'const identity = <T>(value: T): T => value;\nimport "./dep.js";',
  },
  {
    path: "component.tsx",
    kind: "static-import",
    source: 'const element = <section />;\nimport "./dep.js";',
  },
  {
    path: "component.d.tsx",
    kind: "static-import",
    source: 'const element = <section />;\nimport "./dep.js";',
  },
  {
    path: "component.jsx",
    kind: "static-import",
    source: 'const element = <section />;\nimport "./dep.js";',
  },
] as const;

const execute = promisify(execFile);

/** Establish syntax and emitted bytes with the actual locked native compiler. */
export const expectValidTypeScriptInput = async (
  path: string,
  source: string,
): Promise<void> => {
  const directory = await createTestTempDirectory("rea-typescript-producer-");
  const compiler = resolve("node_modules/typescript/bin/tsc");
  const input = join(directory, path);
  await Promise.all([
    writeFile(input, source),
    writeFile(join(directory, "dep.js"), "export const dependency = true;"),
  ]);
  const output = join(directory, "emitted");
  // --noCheck isolates syntax/emit from ambient React/Node/module type facts.
  // This supplemental oracle does not claim complete TypeScript type validity.
  await execute(process.execPath, [
    compiler,
    "--ignoreConfig",
    "--noCheck",
    "--allowJs",
    "--target",
    "es2022",
    "--module",
    "esnext",
    "--jsx",
    "preserve",
    "--outDir",
    output,
    input,
  ]);
  const suffix = path.endsWith(".mts")
    ? ".mjs"
    : path.endsWith(".cts")
      ? ".cjs"
      : path.endsWith(".tsx") || path.endsWith(".jsx")
        ? ".jsx"
        : ".js";
  const emitted = await readFile(
    join(output, path.replace(/\.(?:mts|cts|tsx|jsx|ts)$/u, suffix)),
    "utf8",
  );
  expect(
    parse(emitted, { sourceType: "unambiguous", plugins: ["jsx"] }).errors,
  ).toEqual([]);
};

/** Build actual directory or ASAR input without evaluating any source. */
export const createTypeScriptDialectArtifact = async (
  format: "directory" | "asar",
  cases: readonly (typeof typeScriptDialectCases)[number][],
): Promise<string> => {
  const root = await createTestTempDirectory("rea-typescript-dialect-");
  const directory = join(root, "source");
  await mkdir(directory);
  await Promise.all([
    writeFile(join(directory, "dep.js"), "export const dependency = true;"),
    ...cases.map(({ path, source }) =>
      writeFile(join(directory, path), source),
    ),
  ]);
  if (format === "directory") return directory;
  const archive = join(root, "app.asar");
  await createPackageWithOptions(directory, archive, {});
  return archive;
};

/** Compare digest-bound graph evidence with the producer's actual reference. */
export const expectTypeScriptDialectReference = (
  graph: JavaScriptApplicationGraph,
  fixture: (typeof typeScriptDialectCases)[number],
): void => {
  const parsed = parse(fixture.source, {
    sourceType: "unambiguous",
    plugins: fixture.path.endsWith(".ts")
      ? ["typescript"]
      : ["typescript", "jsx"],
  });
  const statement = parsed.program.body[0];
  const initializer =
    statement?.type === "VariableDeclaration"
      ? statement.declarations[0]?.init
      : undefined;
  const target =
    fixture.kind === "require"
      ? initializer?.type === "TSTypeAssertion" ||
        initializer?.type === "TSAsExpression"
        ? initializer.expression
        : undefined
      : parsed.program.body.find(({ type }) => type === "ImportDeclaration");
  if (target?.loc === undefined || target.loc === null)
    throw new Error("Missing producer reference location");
  const edges = graph.edges.filter(
    ({ relation, properties, evidence }) =>
      relation === "imports" &&
      properties.kind === fixture.kind &&
      properties.specifier === "./dep.js" &&
      evidence.location.available &&
      evidence.location.value.kind === "source-range" &&
      evidence.location.value.source === fixture.path,
  );
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({
    properties: { resolved_path: "dep.js" },
    evidence: {
      artifact: {
        available: true,
        sha256: createHash("sha256").update(fixture.source).digest("hex"),
      },
      location: {
        available: true,
        value: {
          kind: "source-range",
          source: fixture.path,
          start: {
            line: target.loc.start.line,
            column: target.loc.start.column,
          },
          end: { line: target.loc.end.line, column: target.loc.end.column },
        },
      },
    },
  });
};
