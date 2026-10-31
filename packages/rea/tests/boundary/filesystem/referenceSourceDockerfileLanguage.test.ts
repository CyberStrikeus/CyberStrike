import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it("imports Dockerfile-prefixed TypeScript with ordinary source evidence and uncertainty", async () => {
  const root = await createTestTempDirectory("rea-dockerfile-language-");
  const source = [
    'import "./dep.js";',
    'import "./missing.js";',
    'const target: string = "./dep.js";',
    "void import(target);",
  ].join("\n");
  const sourcePaths = ["DockerfileGuide.ts", "ordinary.ts"];
  const dockerfilePaths = ["Dockerfile", "dockerfile.dev.ts"];
  await Promise.all([
    ...[...sourcePaths, ...dockerfilePaths].map((path) =>
      writeFile(join(root, path), source),
    ),
    writeFile(join(root, "dep.js"), "export {};\n"),
  ]);

  const result = await importReferenceSource({
    root,
    caller: "dockerfile-language-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  const graph = result.value;
  expect(graph.parse_failures).toEqual([]);
  expect(graph.relationships).toHaveLength(sourcePaths.length * 3);
  for (const path of sourcePaths) {
    expect(
      graph.relationships.filter(({ from_path }) => from_path === path),
    ).toEqual([
      {
        from_path: path,
        to: "<dynamic-import>",
        kind: "imports",
        resolution: "unknown",
        parse_state: "partial",
      },
      {
        from_path: path,
        to: "dep.js",
        kind: "imports",
        resolution: "internal",
        parse_state: "parsed",
      },
      {
        from_path: path,
        to: "missing.js",
        kind: "imports",
        resolution: "unresolved",
        parse_state: "parsed",
      },
    ]);
  }
  for (const path of [...sourcePaths, ...dockerfilePaths]) {
    expect(graph.entries).toContainEqual({
      path,
      kind: "file",
      sha256: createHash("sha256").update(source).digest("hex"),
      size: Buffer.byteLength(source),
      language: sourcePaths.includes(path) ? "TypeScript" : "Dockerfile",
      classifications: path === "Dockerfile" ? ["manifest"] : ["source"],
      content_state: "hashed",
      limitations: [],
    });
  }
  expect(graph.languages).toEqual(["Dockerfile", "JavaScript", "TypeScript"]);
  expect(graph.manifests).toEqual(["Dockerfile"]);
  expect(graph.inventory_state).toBe("partial");
});

it("retains parser failures and hashes for malformed Dockerfile-prefixed TypeScript", async () => {
  const root = await createTestTempDirectory("rea-dockerfile-parse-failure-");
  const paths = ["DockerfileGuide.ts", "ordinary.ts"];
  const source = 'import "./dep.js";\nconst = ;\n';
  await Promise.all(paths.map((path) => writeFile(join(root, path), source)));
  const result = await importReferenceSource({
    root,
    caller: "dockerfile-language-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(result.value.relationships).toEqual([]);
  expect(result.value.parse_failures).toEqual(
    paths.map((path) => ({
      path,
      parser: "babel",
      reason: expect.stringContaining("Unexpected token"),
    })),
  );
  expect(
    new Set(result.value.parse_failures.map(({ reason }) => reason)).size,
  ).toBe(1);
  for (const path of paths) {
    expect(result.value.entries).toContainEqual({
      path,
      kind: "file",
      sha256: createHash("sha256").update(source).digest("hex"),
      size: Buffer.byteLength(source),
      language: "TypeScript",
      classifications: ["source"],
      content_state: "hashed",
      limitations: [],
    });
  }
  expect(result.value.inventory_state).toBe("partial");
});
