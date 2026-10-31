import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

it("classifies overloaded open calls from lexical receiver facts", async () => {
  const inputPath = await createTestTempDirectory(
    "rea-js-open-classification-",
  );
  await writeFile(
    join(inputPath, "app.js"),
    `
      const popup = window;
      popup.open(url, "/preview");
      {
        const indexedDB = { open() {} };
        indexedDB.open("PROPFIND", "/dav");
        indexedDB.open(databaseName, "2");
      }
      const xhr = new XMLHttpRequest();
      xhr.open(method, "/api");
      parent.open("GET", "/parent-target");
      self.open("POST", "/self-target");
      document.open("GET", "/document-target");
      {
        const parent = new XMLHttpRequest();
        parent.open(method, "/shadowed-parent");
      }
      indexedDB.open("records", "2");
    `,
  );
  const result = await analyzeJavaScriptApplication({
    input_path: inputPath,
    format: "directory",
  });
  if (!result.ok)
    throw new Error(`Expected analysis success: ${result.error.message}`);
  const { graph } = javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  );
  const endpoints = graph.nodes
    .filter(({ kind }) => kind === "endpoint")
    .flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.value),
    )
    .sort();
  const storage = graph.nodes
    .filter(({ kind }) => kind === "storage")
    .flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.storage_kind),
    );
  expect(endpoints).toEqual(["/api", "/dav", "/shadowed-parent"]);
  expect(storage).toEqual(["indexed-db"]);
});
