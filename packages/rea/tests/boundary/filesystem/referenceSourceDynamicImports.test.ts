import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it("resolves dynamic source imports while retaining computed targets as unknown", async () => {
  const root = await createTestTempDirectory("rea-reference-dynamic-import-");
  await Promise.all([
    writeFile(
      join(root, "main.ts"),
      [
        'import "./static";',
        'require("./common");',
        'const lazy = import("./lazy");',
        "const templated = import(`./template-lazy.mjs`);",
        'const wrapped = import("./wrapped-lazy.mjs" as const);',
        'async function load() { return await import("./data.json", { with: { type: "json" } }); }',
        'const name = "./not-guessed.js"; import(name);',
        "import(`./${name}.js`);",
        'import("node:fs");',
      ].join("\n"),
    ),
    ...["static.ts", "common.js", "lazy.ts"].map((path) =>
      writeFile(join(root, path), "export {};\n"),
    ),
    ...["template-lazy.mjs", "wrapped-lazy.mjs"].map((path) =>
      writeFile(join(root, path), "export {};\n"),
    ),
    writeFile(join(root, "data.json"), '{"value":1}\n'),
  ]);

  const result = await importReferenceSource({
    root,
    caller: "reference-dynamic-import-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(result.value.parse_failures).toEqual([]);
  expect(result.value.relationships).toHaveLength(7);
  for (const [to, kind] of [
    ["static.ts", "imports"],
    ["lazy.ts", "imports"],
    ["template-lazy.mjs", "imports"],
    ["wrapped-lazy.mjs", "imports"],
    ["data.json", "imports"],
  ])
    expect(result.value.relationships).toContainEqual({
      from_path: "main.ts",
      to,
      kind,
      resolution: "internal",
      parse_state: "parsed",
    });
  expect(result.value.relationships).toContainEqual({
    from_path: "main.ts",
    to: "<dynamic-import>",
    kind: "imports",
    resolution: "unknown",
    parse_state: "partial",
  });
  expect(result.value.relationships).toContainEqual({
    from_path: "main.ts",
    to: "node:fs",
    kind: "imports",
    resolution: "external",
    parse_state: "parsed",
  });
});

it("loads an extensionless JSON target only through CommonJS require", async () => {
  const root = await createTestTempDirectory("rea-reference-json-require-");
  await Promise.all([
    writeFile(join(root, "main.cjs"), 'require("./data");\n'),
    writeFile(join(root, "main.mjs"), 'import "./data";\n'),
    writeFile(join(root, "data.json"), '{"value":1}\n'),
  ]);

  const result = await importReferenceSource({
    root,
    caller: "reference-json-require-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  // ESM, unlike the CommonJS loader, requires the explicit `.json` extension.
  expect(result.value.relationships).toEqual([
    {
      from_path: "main.cjs",
      to: "data.json",
      kind: "requires",
      resolution: "internal",
      parse_state: "parsed",
    },
    {
      from_path: "main.mjs",
      to: "data",
      kind: "imports",
      resolution: "unresolved",
      parse_state: "parsed",
    },
  ]);
  expect(
    result.value.entries.map((entry) => [
      entry.path,
      "content_state" in entry ? entry.content_state : null,
    ]),
  ).toEqual([
    ["data.json", "hashed"],
    ["main.cjs", "hashed"],
    ["main.mjs", "hashed"],
  ]);
});
