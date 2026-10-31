import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it("imports test-suffixed filenames with unchanged paths, hashes, and languages", async () => {
  const root = await createTestTempDirectory("rea-reference-test-filenames-");
  const files = [
    ["main_test.go", "package main\n", ["source", "test"], "Go"],
    ["test_helper.py", "assert True\n", ["source", "test"], "Python"],
    ["parser_spec.rs", "fn checks() {}\n", ["source", "test"], "Rust"],
    ["Widget_SPEC.TS", "export {};\n", ["source", "test"], "TypeScript"],
    ["main_test", "test fixture\n", ["test"], null],
    ["main.test.js", "export {};\n", ["source", "test"], "JavaScript"],
    ["main_test_helper.py", "value = 1\n", ["source"], "Python"],
    ["main_test.py.bak", "backup\n", ["unknown"], null],
  ] as const;
  await Promise.all(
    files.map(([path, content]) => writeFile(join(root, path), content)),
  );

  const result = await importReferenceSource({
    root,
    caller: "reference-test-filenames-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(result.value.entries).toHaveLength(files.length);
  for (const [path, content, classifications, language] of files) {
    expect(result.value.entries).toContainEqual({
      path,
      kind: "file",
      sha256: createHash("sha256").update(content).digest("hex"),
      size: Buffer.byteLength(content),
      language,
      classifications,
      content_state: "hashed",
      limitations: [],
    });
  }
  expect(result.value.parse_failures).toEqual([]);
  expect(result.value.relationships).toEqual([]);
  expect(result.value.exclusions).toEqual([]);
  expect(result.value.languages).toEqual([
    "Go",
    "JavaScript",
    "Python",
    "Rust",
    "TypeScript",
  ]);
});

it("keeps parser failures and unknown dependencies visible for test filenames", async () => {
  const root = await createTestTempDirectory("rea-reference-test-parsing-");
  await Promise.all([
    writeFile(
      join(root, "loader_test.js"),
      'throw new Error("must not execute"); import(moduleName);\n',
    ),
    writeFile(join(root, "broken_spec.ts"), "const = ;\n"),
  ]);

  const result = await importReferenceSource({
    root,
    caller: "reference-test-parsing-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(result.value.inventory_state).toBe("partial");
  expect(result.value.relationships).toEqual([
    {
      from_path: "loader_test.js",
      to: "<dynamic-import>",
      kind: "imports",
      resolution: "unknown",
      parse_state: "partial",
    },
  ]);
  expect(result.value.parse_failures).toEqual([
    {
      path: "broken_spec.ts",
      parser: "babel",
      reason: expect.any(String),
    },
  ]);
  expect(
    result.value.entries.map(({ path, classifications }) => ({
      path,
      classifications,
    })),
  ).toEqual([
    { path: "broken_spec.ts", classifications: ["source", "test"] },
    { path: "loader_test.js", classifications: ["source", "test"] },
  ]);
});
