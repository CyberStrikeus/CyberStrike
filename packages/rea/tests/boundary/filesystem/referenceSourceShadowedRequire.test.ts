import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it("resolves require calls by lexical binding and source mode", async () => {
  const root = await createTestTempDirectory("rea-reference-require-scope-");
  const sources: Record<string, string> = {
    "global-wrapper.cjs":
      "globalThis; console.log(require.resolve('./loaded.cjs'));",
    "parameter.cjs": [
      "function load(require) { return require('./throwing.cjs'); }",
      "console.log(load(() => 'local'));",
    ].join("\n"),
    "destructured.cjs": [
      "function load({ require }) { return require('./throwing.cjs'); }",
      "console.log(load({ require: () => 'local' }));",
    ].join("\n"),
    "hoisted.cjs": [
      "function load() {",
      "  console.log(require('./throwing.cjs'));",
      "  function require() { return 'local'; }",
      "}",
      "load();",
    ].join("\n"),
    "catch.cjs": [
      "try { throw () => 'local'; }",
      "catch (require) { console.log(require('./throwing.cjs')); }",
    ].join("\n"),
    "nested.cjs": [
      "console.log(require('./loaded.cjs'));",
      "function load(require) { return require('./throwing.cjs'); }",
      "console.log(load(() => 'local'));",
    ].join("\n"),
    "dynamic-with.cjs": [
      "with ({ require: () => 'local' }) {",
      "  console.log(require('./throwing.cjs'));",
      "}",
    ].join("\n"),
    "top-level-var.cjs": [
      "var require;",
      "console.log(require('./loaded.cjs'));",
    ].join("\n"),
    "initialized-var.cjs": [
      "var require = () => 'local';",
      "console.log(require('./throwing.cjs'));",
    ].join("\n"),
    "assigned-var.cjs": [
      "require = () => 'local';",
      "console.log(require('./throwing.cjs'));",
    ].join("\n"),
    "unbound-esm.mjs": [
      "try { require('./throwing.cjs'); }",
      "catch (error) {",
      "  if (!(error instanceof ReferenceError)) throw error;",
      "  console.log('no-global-require');",
      "}",
    ].join("\n"),
    "shadowed-esm.mjs": [
      "const require = () => 'local';",
      "console.log(require('./throwing.cjs'));",
    ].join("\n"),
    "create-require-esm.mjs": [
      "import { createRequire as makeRequire } from 'node:module';",
      "const require = makeRequire(import.meta.url);",
      "console.log(require('./loaded.cjs'));",
    ].join("\n"),
    "loaded.cjs": "console.log('loaded');\nmodule.exports = 'real';\n",
    "throwing.cjs": "throw new Error('A shadowed require must not load me');\n",
  };

  await Promise.all(
    Object.entries(sources).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );

  const runNode = promisify(execFile);
  for (const [path, stdout] of [
    ["parameter.cjs", "local\n"],
    ["destructured.cjs", "local\n"],
    ["hoisted.cjs", "local\n"],
    ["catch.cjs", "local\n"],
    ["nested.cjs", "loaded\nreal\nlocal\n"],
    ["dynamic-with.cjs", "local\n"],
    ["top-level-var.cjs", "loaded\nreal\n"],
    ["initialized-var.cjs", "local\n"],
    ["assigned-var.cjs", "local\n"],
    ["unbound-esm.mjs", "no-global-require\n"],
    ["shadowed-esm.mjs", "local\n"],
    ["create-require-esm.mjs", "loaded\nreal\n"],
  ] as const) {
    const executed = await runNode(process.execPath, [join(root, path)], {
      cwd: root,
      timeout: 5_000,
    });
    expect(executed.stdout).toBe(stdout);
    expect(executed.stderr).toBe("");
  }

  const result = await importReferenceSource({
    root,
    caller: "reference-shadowed-require-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;

  expect(
    result.value.relationships
      .filter(({ kind }) => kind === "requires")
      .map(({ from_path, to }) => [from_path, to])
      .sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")),
  ).toEqual([
    ["create-require-esm.mjs", "loaded.cjs"],
    ["global-wrapper.cjs", "loaded.cjs"],
    ["nested.cjs", "loaded.cjs"],
    ["top-level-var.cjs", "loaded.cjs"],
  ]);
});

const dynamicLoaderSources: Record<string, string> = {
  "active-with.cjs": [
    "with ({ require: null }) { require = () => 'local'; }",
    "console.log(require('./loaded.cjs'));",
  ].join("\n"),
  "block-local-with.cjs": [
    "function patch() {",
    "  { let require = () => 'before'; with ({}) { require = () => 'local'; } }",
    "}",
    "patch();",
    "console.log(require('./loaded.cjs'));",
  ].join("\n"),
  "for-in-empty-primitive.cjs": [
    "for (var require in { __proto__: 0 }) {}",
    "console.log(require('./loaded.cjs'));",
  ].join("\n"),
  "for-in-nonempty.cjs": [
    "for (var require in { local: true }) {}",
    "try { require('./throwing.cjs'); }",
    "catch (error) {",
    "  if (!(error instanceof TypeError)) throw error;",
    "  console.log('replaced');",
    "}",
  ].join("\n"),
  "for-of-empty.cjs": [
    "for (var require of []) {}",
    "console.log(require('./loaded.cjs'));",
  ].join("\n"),
  "for-of-nonempty.cjs": [
    "for (var require of [() => 'local']) {}",
    "console.log(require('./throwing.cjs'));",
  ].join("\n"),
  "function-parameter-with.cjs": [
    "function patch(require) { with ({}) { require = () => 'local'; } }",
    "patch(() => 'before');",
    "console.log(require('./loaded.cjs'));",
  ].join("\n"),
  "inactive-with-expression.cjs": [
    "with ({ require: (() => {",
    "  with ({}) { require = () => 'local'; }",
    "  return null;",
    "})() }) {}",
    "console.log(require('./throwing.cjs'));",
  ].join("\n"),
  "ordered-write.cjs": [
    "require('./ordered-before.cjs');",
    "with ({}) { require = () => 'local'; }",
    "console.log(require('./ordered-after.cjs'));",
  ].join("\n"),
  "primitive-unscopables.cjs": [
    "with ({ require: null, [Symbol.unscopables]: null }) {",
    "  require = () => 'local';",
    "}",
    "console.log(require('./loaded.cjs'));",
  ].join("\n"),
  "object-unscopables.cjs": [
    "with ({ require: null, [Symbol.unscopables]: { require: true } }) {",
    "  require = () => 'local';",
    "}",
    "console.log(require('./throwing.cjs'));",
  ].join("\n"),
  "with-write.cjs": [
    "with ({}) { require = () => 'local'; }",
    "console.log(require('./throwing.cjs'));",
  ].join("\n"),
  "assignment-rhs.cjs":
    "var require; require = require('./loaded.cjs'); console.log(require);",
  "for-of-sparse.cjs":
    "for (var require of [,]) {} try { require('./throwing.cjs'); } catch (error) { if (!(error instanceof TypeError)) throw error; console.log('replaced'); }",
  "for-in-inherited.cjs":
    "for (var require in { __proto__: { item: true } }) {} try { require('./throwing.cjs'); } catch (error) { if (!(error instanceof TypeError)) throw error; console.log('replaced'); }",
  "prototype-read-only.cjs":
    "Object.setPrototypeOf({}, Object.prototype); for (var require in { __proto__: 0 }) {} console.log(require('./loaded.cjs'));",
  "prototype-alias.cjs":
    "const prototype = Object.prototype; prototype.item = true; for (var require in {}) {} try { require('./throwing.cjs'); } catch (error) { if (!(error instanceof TypeError)) throw error; console.log('replaced'); }",
  "array-iterator.cjs":
    "Array.prototype[Symbol.iterator] = function* () { yield () => 'local'; }; for (var require of []) {} console.log(require('./throwing.cjs'));",
  "string-unscopables.cjs":
    "with ({ require: null, ['@@unscopables']: { require: true } }) { require = () => 'local'; } console.log(require('./loaded.cjs'));",
  "inherited-unscopables.cjs":
    "with ({ require: null, [Symbol.unscopables]: { __proto__: { require: true } } }) { require = () => 'local'; } console.log(require('./throwing.cjs'));",
  "prototype-unscopables.cjs":
    "Object.prototype[Symbol.unscopables] = { require: true }; with ({ require: null }) { require = () => 'local'; } console.log(require('./throwing.cjs'));",
  "loaded.cjs": "console.log('loaded');\nmodule.exports = 'real';\n",
  "throwing.cjs": "throw new Error('A shadowed require must not load me');\n",
  "ordered-before.cjs": "console.log('before-loaded');\n",
  "ordered-after.cjs":
    "throw new Error('The replaced loader must not load me');\n",
};

it("keeps require edges according to the loader at each source site", async () => {
  const root = await createTestTempDirectory("rea-reference-require-dynamic-");

  await Promise.all(
    Object.entries(dynamicLoaderSources).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );

  const runNode = promisify(execFile);
  for (const [path, stdout] of [
    ["assignment-rhs.cjs", "loaded\nreal\n"],
    ["for-of-sparse.cjs", "replaced\n"],
    ["for-in-inherited.cjs", "replaced\n"],
    ["prototype-read-only.cjs", "loaded\nreal\n"],
    ["prototype-alias.cjs", "replaced\n"],
    ["array-iterator.cjs", "local\n"],
    ["string-unscopables.cjs", "loaded\nreal\n"],
    ["inherited-unscopables.cjs", "local\n"],
    ["prototype-unscopables.cjs", "local\n"],
    ["active-with.cjs", "loaded\nreal\n"],
    ["block-local-with.cjs", "loaded\nreal\n"],
    ["for-in-empty-primitive.cjs", "loaded\nreal\n"],
    ["for-in-nonempty.cjs", "replaced\n"],
    ["for-of-empty.cjs", "loaded\nreal\n"],
    ["for-of-nonempty.cjs", "local\n"],
    ["function-parameter-with.cjs", "loaded\nreal\n"],
    ["inactive-with-expression.cjs", "local\n"],
    ["ordered-write.cjs", "before-loaded\nlocal\n"],
    ["primitive-unscopables.cjs", "loaded\nreal\n"],
    ["object-unscopables.cjs", "local\n"],
    ["with-write.cjs", "local\n"],
  ] as const) {
    const executed = await runNode(process.execPath, [join(root, path)], {
      cwd: root,
      timeout: 5_000,
    });
    expect(executed.stdout).toBe(stdout);
    expect(executed.stderr).toBe("");
  }

  const result = await importReferenceSource({
    root,
    caller: "reference-require-dynamic-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(
    result.value.relationships
      .filter(({ kind }) => kind === "requires")
      .map(({ from_path, to }) => [from_path, to])
      .sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")),
  ).toEqual([
    ["active-with.cjs", "loaded.cjs"],
    ["assignment-rhs.cjs", "loaded.cjs"],
    ["block-local-with.cjs", "loaded.cjs"],
    ["for-in-empty-primitive.cjs", "loaded.cjs"],
    ["for-of-empty.cjs", "loaded.cjs"],
    ["function-parameter-with.cjs", "loaded.cjs"],
    ["ordered-write.cjs", "ordered-before.cjs"],
    ["primitive-unscopables.cjs", "loaded.cjs"],
    ["prototype-read-only.cjs", "loaded.cjs"],
    ["string-unscopables.cjs", "loaded.cjs"],
  ]);
});

it("does not attribute overwritten require members to Node's resolver", async () => {
  const root = await createTestTempDirectory("rea-reference-require-member-");
  const sources: Record<string, string> = {
    "assigned.cjs":
      "require.resolve = () => 'custom';\nconsole.log(require.resolve('./loaded.cjs'));",
    "defined.cjs":
      "Object.defineProperty(require, 'resolve', { value: () => 'custom' });\nconsole.log(require.resolve('./loaded.cjs'));",
    "computed.cjs":
      "const key = 'resolve';\nrequire[key] = () => 'custom';\nconsole.log(require.resolve('./loaded.cjs'));",
    "control.cjs": "console.log(typeof require.resolve('./loaded.cjs'));",
    // A member overwrite does not change bare loader calls.
    "bare-after-overwrite.cjs":
      "require.resolve = () => 'custom';\nconsole.log(require('./loaded.cjs'));",
    // A local loader's member write does not touch Node's loader.
    "local-loader.cjs":
      "function patch(require) { require.resolve = () => 'custom'; }\npatch({});\nconsole.log(typeof require.resolve('./loaded.cjs'));",
    // Optional calls and inert wrappers do not let the loader escape.
    "optional-call.cjs":
      "require?.('./loaded.cjs');\nconsole.log(typeof (require).resolve('./loaded.cjs'));",
    "loaded.cjs": "module.exports = 'real';\n",
  };
  await Promise.all(
    Object.entries(sources).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );
  const runNode = promisify(execFile);
  for (const [path, stdout] of [
    ["assigned.cjs", "custom\n"],
    ["defined.cjs", "custom\n"],
    ["computed.cjs", "custom\n"],
    ["control.cjs", "string\n"],
    ["bare-after-overwrite.cjs", "real\n"],
    ["local-loader.cjs", "string\n"],
    ["optional-call.cjs", "string\n"],
  ] as const)
    expect(
      (
        await runNode(process.execPath, [join(root, path)], {
          cwd: root,
          timeout: 5_000,
        })
      ).stdout,
    ).toBe(stdout);

  const result = await importReferenceSource({
    root,
    caller: "reference-require-member-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(
    result.value.relationships
      .filter(
        ({ kind, resolution }) =>
          kind === "requires" && resolution === "internal",
      )
      .map(({ from_path, to }) => [from_path, to])
      .sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")),
  ).toEqual([
    ["bare-after-overwrite.cjs", "loaded.cjs"],
    ["control.cjs", "loaded.cjs"],
    ["local-loader.cjs", "loaded.cjs"],
    ["optional-call.cjs", "loaded.cjs"],
  ]);
  expect(
    result.value.relationships.filter(
      ({ kind, resolution }) => kind === "requires" && resolution === "unknown",
    ),
  ).toEqual(
    ["assigned.cjs", "computed.cjs", "defined.cjs"].map((from_path) => ({
      from_path,
      to: "./loaded.cjs",
      kind: "requires",
      resolution: "unknown",
      parse_state: "partial",
    })),
  );
});
