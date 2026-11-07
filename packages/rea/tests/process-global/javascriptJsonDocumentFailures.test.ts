import { expect, it, onTestFinished, vi } from "vitest";

import { createJavaScriptArtifactReader } from "../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { analyzeArtifactFiles } from "../fixtures/javascriptArtifactAnalysis.js";
import { immutableArtifactGraph } from "../fixtures/javascriptArtifactGraph.js";
import type {
  JavaScriptArtifactFile,
  JavaScriptArtifactFileSet,
} from "../../src/domain/javascript/javascriptArtifactFiles.js";
import { scanCanonicalArtifactInventory } from "../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../support/javascriptApplicationFixture.js";
import { readJavaScriptArtifactFiles } from "../support/javascriptApplicationScope.js";

const packageJsonText = '{"name":"fault-package"}';
const jsonText = '{"kind":"fault-json"}';

const artifactFile = (
  path: string,
  kind: "package-json" | "json",
  text: string,
): JavaScriptArtifactFile => ({
  path,
  container_sha256: "container-digest",
  sha256: `digest-${path}`,
  bytes: Buffer.byteLength(text),
  inventory_artifact_id: `artifact-${path}`,
  kind,
  unpacked: false,
  text: { included: true, value: text },
});

const fileSet = (): JavaScriptArtifactFileSet => ({
  files: [
    artifactFile("package.json", "package-json", packageJsonText),
    artifactFile("settings.json", "json", jsonText),
  ],
  unavailable_relevant_files: [],
  containers: [],
  text_bytes_read:
    Buffer.byteLength(packageJsonText) + Buffer.byteLength(jsonText),
  invalid_utf8_files: 0,
});

it.each([
  {
    document: "package.json",
    text: packageJsonText,
    create: () => new TypeError("parser fault"),
  },
  {
    document: "package.json",
    text: packageJsonText,
    create: () => new Error("parser fault"),
  },
  {
    document: "ordinary JSON",
    text: jsonText,
    create: () => new TypeError("parser fault"),
  },
  {
    document: "ordinary JSON",
    text: jsonText,
    create: () => new Error("parser fault"),
  },
])(
  "propagates unexpected JSON.parse faults from $document",
  async ({ text, create }) => {
    const files = fileSet();
    const originalParse = JSON.parse;
    const thrown = create();
    vi.spyOn(JSON, "parse").mockImplementation((input) => {
      if (input === text) throw thrown;
      return originalParse(input);
    });
    onTestFinished(() => {
      vi.restoreAllMocks();
    });

    let caught: unknown;
    try {
      await analyzeArtifactFiles(files);
    } catch (cause: unknown) {
      caught = cause;
    }
    expect(caught).toBe(thrown);
  },
);

it("keeps malformed JSON as an invalid observation", async () => {
  const malformedPackage = artifactFile("package.json", "package-json", "{");
  const malformedJson = artifactFile("settings.json", "json", "{");
  const { analysis } = await analyzeArtifactFiles({
    ...fileSet(),
    files: [malformedPackage, malformedJson],
  });

  expect(analysis.packages).toMatchObject([{ status: "invalid" }]);
  expect(analysis.json_modules).toMatchObject([{ status: "invalid" }]);
});

it("reuses parsed package and JSON facts while building the public graph", async () => {
  const root = await createTestTempDirectory("rea-json-document-graph-");
  await writeFixtureFiles(root, {
    "main.cjs": 'require("./dep"); require("./config.json");',
    "dep/package.json": '{"main":"index.cjs"}',
    "dep/index.cjs": "module.exports = 1;",
    "config.json": '{"enabled":true}',
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const depPackageText = '{"main":"index.cjs"}';
    const configText = '{"enabled":true}';
    const originalParse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((text) => {
      if (text === depPackageText || text === configText)
        throw new TypeError("unexpected JSON reparse");
      return originalParse(text);
    });

    const graph = await immutableArtifactGraph(snapshot, files, analysis);
    expect(
      graph.edges.find(
        ({ relation, properties }) =>
          relation === "imports" && properties.specifier === "./dep",
      )?.properties,
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "dep/index.cjs",
    });
    expect(
      graph.edges.find(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.specifier === "./config.json" &&
          Object.hasOwn(properties, "target_json_status"),
      )?.properties,
    ).toMatchObject({
      target_file_kind: "json",
      target_json_status: "included",
    });
  } finally {
    vi.restoreAllMocks();
    await reader.close();
  }
});
