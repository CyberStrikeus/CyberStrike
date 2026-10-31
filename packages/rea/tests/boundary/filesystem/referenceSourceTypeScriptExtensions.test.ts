import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it("imports valid CommonJS wrapper syntax without inventing a parse failure", async () => {
  const root = await createTestTempDirectory("rea-reference-commonjs-mode-");
  await Promise.all([
    writeFile(
      join(root, "main.cjs"),
      'void new.target; require("./dep.cjs"); return;\n',
    ),
    writeFile(join(root, "dep.cjs"), "module.exports = 1;\n"),
  ]);
  const imported = await importReferenceSource({
    root,
    caller: "native-commonjs-source",
    policy: { secretPatterns: [] },
  });
  if (!imported.ok) throw imported.error;
  expect(imported.value.parse_failures).toEqual([]);
  expect(imported.value.relationships).toContainEqual({
    from_path: "main.cjs",
    to: "dep.cjs",
    kind: "requires",
    resolution: "internal",
    parse_state: "parsed",
  });
});

it.each([
  ["main.ts", "dep.js", "dep.ts"],
  ["main.mts", "dep.mjs", "dep.mts"],
  ["main.cts", "dep.cjs", "dep.cts"],
  ["main.tsx", "dep.js", "dep.tsx"],
  ["main.ts", "dep.jsx", "dep.tsx"],
  ["main.ts", "dep.js", "dep.d.ts"],
  ["main.mts", "dep.mjs", "dep.d.mts"],
  ["main.cts", "dep.cjs", "dep.d.cts"],
  ["main.d.ts", "dep.js", "dep.d.ts"],
  ["main.d.mts", "dep.mjs", "dep.d.mts"],
  ["main.d.cts", "dep.cjs", "dep.d.cts"],
])(
  "resolves %s runtime-extension imports to present source %s/%s",
  async (from, specifier, target) => {
    const root = await createTestTempDirectory("rea-reference-ts-extension-");
    await Promise.all([
      writeFile(join(root, from), `export { value } from "./${specifier}";\n`),
      writeFile(
        join(root, target),
        target.includes(".d.")
          ? "export declare const value: number;\n"
          : "export const value = 1;\n",
      ),
    ]);
    const imported = await importReferenceSource({
      root,
      caller: "native-typescript-source",
      policy: { secretPatterns: [] },
    });
    if (!imported.ok) throw imported.error;
    expect(imported.value.relationships).toContainEqual({
      from_path: from,
      to: target,
      kind: "imports",
      resolution: "internal",
      parse_state: "parsed",
    });
  },
);

it.each(["main.ts", "main.js"])(
  "retains an existing declared runtime file for %s",
  async (from) => {
    const root = await createTestTempDirectory("rea-reference-ts-control-");
    await Promise.all([
      writeFile(join(root, from), 'export { value } from "./dep.js";\n'),
      writeFile(join(root, "dep.js"), "export const value = 2;\n"),
      writeFile(join(root, "dep.ts"), "export const value = 1;\n"),
    ]);
    const imported = await importReferenceSource({
      root,
      caller: "native-typescript-source",
      policy: { secretPatterns: [] },
    });
    if (!imported.ok) throw imported.error;
    expect(imported.value.relationships).toContainEqual(
      expect.objectContaining({
        from_path: from,
        to: "dep.js",
        resolution: "internal",
      }),
    );
  },
);

it("does not substitute TypeScript sources for a JavaScript runtime import", async () => {
  const root = await createTestTempDirectory("rea-reference-js-control-");
  await Promise.all([
    writeFile(join(root, "main.js"), 'export { value } from "./dep.js";\n'),
    writeFile(join(root, "dep.ts"), "export const value = 1;\n"),
  ]);
  const imported = await importReferenceSource({
    root,
    caller: "native-typescript-source",
    policy: { secretPatterns: [] },
  });
  if (!imported.ok) throw imported.error;
  expect(imported.value.relationships).toContainEqual(
    expect.objectContaining({
      from_path: "main.js",
      to: "dep.js",
      resolution: "unresolved",
    }),
  );
});
