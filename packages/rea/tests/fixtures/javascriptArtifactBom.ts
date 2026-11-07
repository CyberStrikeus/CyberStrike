import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { parse as parseJavaScript } from "@babel/parser";
import {
  defaultTreeAdapter,
  parse as parseHtml,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { expect } from "vitest";

import type { JavaScriptSourceRange } from "../../src/domain/javascript/javascriptStaticAnalysisTypes.js";
import type { JavaScriptApplicationGraph } from "../../src/domain/javascript/javascriptApplicationGraph.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

export const bomSourceCases = [
  { path: "import.js", kind: "static-import", source: 'import "./dep.js";' },
  { path: "require.cjs", kind: "require", source: 'require("./dep.js");' },
  {
    path: "index.html",
    kind: "html",
    source: '<script src="./dep.js"></script>',
  },
] as const;

export const createBomArtifact = async (
  format: "directory" | "asar",
  files: Readonly<Record<string, string | Buffer>>,
): Promise<string> => {
  const root = await createTestTempDirectory("rea-bom-artifact-");
  const directory = join(root, "source");
  await mkdir(directory);
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      writeFile(join(directory, path), content),
    ),
  );
  if (format === "directory") return directory;
  const archive = join(root, "app.asar");
  await createPackageWithOptions(directory, archive, {});
  return archive;
};

/** The oracle parses original UTF-8 bytes with their BOM retained. */
export const expectBomSourceRange = (
  graph: JavaScriptApplicationGraph,
  fixture: (typeof bomSourceCases)[number],
  bytes: Buffer,
): void => {
  const original = bytes.toString("utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  let expectedRange: JavaScriptSourceRange;
  if (fixture.kind === "html") {
    const pending: DefaultTreeAdapterTypes.Node[] = [
      parseHtml(original, { sourceCodeLocationInfo: true }),
    ];
    let opening;
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) break;
      if (defaultTreeAdapter.isElementNode(node) && node.tagName === "script") {
        opening = node.sourceCodeLocation?.startTag;
        break;
      }
      if ("childNodes" in node) pending.push(...node.childNodes);
    }
    if (opening === undefined) throw new Error("Missing original HTML script");
    expectedRange = {
      start: { line: opening.startLine, column: opening.startCol - 1 },
      end: { line: opening.endLine, column: opening.endCol - 1 },
    };
  } else {
    const statement = parseJavaScript(original, {
      sourceType: "unambiguous",
    }).program.body[0];
    const target =
      fixture.kind === "require" && statement?.type === "ExpressionStatement"
        ? statement.expression
        : statement;
    if (target?.loc === undefined || target.loc === null)
      throw new Error("Missing original JavaScript reference");
    expectedRange = {
      start: { line: target.loc.start.line, column: target.loc.start.column },
      end: { line: target.loc.end.line, column: target.loc.end.column },
    };
  }
  const edges = graph.edges.filter(
    ({ relation, properties, evidence }) =>
      relation === (fixture.kind === "html" ? "loads" : "imports") &&
      (fixture.kind === "html"
        ? properties.script_path === "./dep.js"
        : properties.kind === fixture.kind &&
          properties.specifier === "./dep.js") &&
      evidence.location.available &&
      evidence.location.value.kind === "source-range" &&
      evidence.location.value.source === fixture.path,
  );
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({
    properties: { resolved_path: "dep.js" },
    evidence: {
      artifact: { available: true, sha256: digest },
      location: {
        available: true,
        value: { kind: "source-range", source: fixture.path, ...expectedRange },
      },
    },
  });
};
