import { join } from "node:path";

import { expect, it } from "vitest";

import { estimateJavaScriptStaticApplicationProjection } from "../../../src/domain/javascript/javascriptApplicationProjectionResources.js";
import { analyzeJavaScriptStaticSource } from "../../../src/domain/javascript/javascriptStaticAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  reconstructJavaScriptFixture,
  writeFixtureFiles,
} from "../../support/javascriptApplicationFixture.js";

const BACKSLASH = String.fromCharCode(92);

// A bundle chunk made of many small functions, each with storage and request
// findings, as minified application chunks commonly are. The key suffix lets
// a case use literals that expand when serialized as JSON.
const chunk = (functions: number, keySuffix = ""): string =>
  Array.from(
    { length: functions },
    (_, index) =>
      `export function f${String(index)}(a){` +
      `localStorage.setItem("pref.${String(index % 5)}${keySuffix}",String(a));` +
      `const d=localStorage.getItem("pref.${String(index % 5)}${keySuffix}");` +
      `return fetch("/rpc/p${String(index % 7)}",{method:"POST",body:d});}`,
  ).join("\n");

it.each([
  { name: "short path, plain literals", directory: "", keySuffix: "" },
  {
    // Quotes, backslashes and a control character escape in JSON; the
    // non-ASCII text takes several UTF-8 bytes; the nested path repeats in
    // every projected record.
    name: "nested path, escaped and multibyte literals",
    directory: "nested-directory/".repeat(8),
    keySuffix: `.${BACKSLASH}"q${BACKSLASH}"${BACKSLASH}${BACKSLASH}${BACKSLASH}t.é中😀`,
  },
])(
  "charges a bounded multiple of the application relationships it admits: $name",
  async ({ directory, keySuffix }) => {
    const text = chunk(400, keySuffix);
    const sourcePath = `${directory}chunk.js`;
    const root = await createTestTempDirectory("rea-projection-estimate-");
    await writeFixtureFiles(root, { [`assets/${sourcePath}`]: text });
    const result = await reconstructJavaScriptFixture(join(root, "assets"));
    const facts = analyzeJavaScriptStaticSource(text);
    const checkpointBytes = Buffer.byteLength(JSON.stringify(facts));
    const estimate = estimateJavaScriptStaticApplicationProjection(
      facts,
      checkpointBytes,
      sourcePath,
    );
    const serialized = Buffer.byteLength(JSON.stringify(result.graph));

    expect(facts.storage.length).toBeGreaterThanOrEqual(800);
    // Parsed JSON retains a few times its bytes. A charge far above that makes
    // the shared parent budget refuse later sources that would fit.
    expect(estimate).toBeGreaterThanOrEqual(3 * serialized);
    expect(estimate).toBeLessThanOrEqual(8 * serialized);
  },
);
