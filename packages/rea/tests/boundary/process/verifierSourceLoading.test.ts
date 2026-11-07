import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, onTestFinished } from "vitest";
import { z } from "zod";

import { processTest } from "../../support/process/processFixture.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const scriptUrl = (path: string) =>
  JSON.stringify(pathToFileURL(resolve("scripts/lib", path)).href);

for (const missing of ["registerHooks", "stripTypeScriptTypes"]) {
  processTest(
    `explains the development runtime requirement when ${missing} is unavailable`,
    async ({ processes }) => {
      const source = `
import module from "node:module";
module[${JSON.stringify(missing)}] = undefined;
module.syncBuiltinESMExports();
const { importVerifierSource } = await import(${scriptUrl("verifier-source-loader.mjs")});
await importVerifierSource(new URL("./src/domain/skillManifest.ts", import.meta.url));
`;
      const result = await processes.run(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { timeoutMs: 20_000 },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Node.js version pinned in .nvmrc");
      expect(result.stderr).toContain("source build and verifier scripts");
    },
  );
}

// Windows' root lineage observer explicitly reports unavailable; its command
// owners and source loading are covered by the native Windows boundary lane.
processTest.skipIf(process.platform === "win32")(
  "shares cold verifier commands and closes their compiler-free source graph",
  async ({ processes }) => {
    const source = `
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifierRun, completeVerifierRun } from ${scriptUrl("verifier-run.mjs")};
import { createVerifierCommands } from ${scriptUrl("verify-commands.mjs")};
import { createPackageVerifierCommands } from ${scriptUrl("verify-package-commands.mjs")};
import { withVerifierCleanup } from ${scriptUrl("verifier-cleanup.mjs")};
const run = createVerifierRun();
const root = await mkdtemp(join(tmpdir(), "rea-verifier-source-"));
let generic;
let packaged;
let outputs;
let failures;
await withVerifierCleanup(async () => {
  generic = await createVerifierCommands();
  packaged = await createPackageVerifierCommands({ workspace: {
    path: root, close: () => rm(root, { recursive: true, force: true }),
  } });
  const owners = [["generic", generic], ["packaged", packaged]];
  outputs = await Promise.all(owners.map(([name, commands]) =>
    commands.exec(process.execPath, ["-e", "process.stdout.write(" + JSON.stringify(name) + ")"]),
  ));
  failures = await Promise.all(owners.map(([, commands]) =>
    commands.exec(process.execPath, ["-e", "process.exitCode = 2"]).catch((cause) => cause),
  ));
}, [
  () => generic?.close(),
  () => packaged === undefined ? rm(root, { recursive: true, force: true }) : packaged.close(),
]);
let removed = false;
try { await access(root); }
catch (cause) { if (cause.code !== "ENOENT") throw cause; removed = true; }
const observation = await completeVerifierRun(run);
console.log(JSON.stringify({
  outputs: outputs.map(({ stdout }) => stdout), removed,
  sameFailureClass: failures[0].constructor === failures[1].constructor,
  exitCodes: failures.map(({ code }) => code),
  process_lineage: observation.process_lineage,
}));
`;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", source],
      { env: { ...process.env, TSX_DISABLE_CACHE: "1" }, timeoutMs: 20_000 },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const observation = z
      .object({
        outputs: z.array(z.string()),
        removed: z.boolean(),
        sameFailureClass: z.boolean(),
        exitCodes: z.array(z.number()),
        process_lineage: z.object({
          status: z.string(),
          descendants: z.array(z.unknown()).optional(),
        }),
      })
      .parse(JSON.parse(result.stdout));
    expect(observation).toMatchObject({
      outputs: ["generic", "packaged"],
      removed: true,
      sameFailureClass: true,
      exitCodes: [2, 2],
      process_lineage: { status: "verified", descendants: [] },
    });
  },
);

processTest(
  "preserves a caller-owned compiler context while loading verifier source",
  async ({ processes }) => {
    const source = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackageVerifierCommands } from ${scriptUrl("verify-package-commands.mjs")};
import { withVerifierCleanup } from ${scriptUrl("verifier-cleanup.mjs")};
const compiler = createRequire(import.meta.resolve("tsx/package.json"))("esbuild");
let context;
let root;
let commands;
await withVerifierCleanup(async () => {
  context = await compiler.context({
    stdin: { contents: "module.exports = 7;" },
    format: "cjs", write: false, logLevel: "silent",
  });
  await context.rebuild();
  root = await mkdtemp(join(tmpdir(), "rea-verifier-compiler-owner-"));
  commands = await createPackageVerifierCommands({ workspace: {
    path: root, close: () => rm(root, { recursive: true, force: true }),
  } });
  await commands.close();
  const result = await context.rebuild();
  assert.equal(result.outputFiles.length, 1);
  const module = { exports: undefined };
  new Function("module", result.outputFiles[0].text)(module);
  assert.equal(module.exports, 7);
  console.log(JSON.stringify({ retainedContext: true, value: module.exports }));
}, [
  () => commands?.close() ?? (root === undefined ? undefined : rm(root, { recursive: true, force: true })),
  async () => { try { await context?.dispose(); } finally { compiler.stop(); } },
]);
`;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", source],
      { timeoutMs: 20_000, env: { ...process.env, TSX_DISABLE_CACHE: "1" } },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      retainedContext: true,
      value: 7,
    });
  },
);

processTest(
  "loads one scoped TypeScript graph and preserves native module failures",
  async ({ processes }) => {
    const workspace = await createTestWorkspace("rea-verifier-source-loader-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    await workspace.mkdir("scripts/lib");
    await copyFile(
      resolve("scripts/lib/verifier-source-loader.mjs"),
      workspace.path("scripts/lib/verifier-source-loader.mjs"),
    );
    await Promise.all([
      workspace.write("package.json", '{"type":"module"}'),
      workspace.write(
        "src/value.ts",
        "export enum Kind { Ready = 7 } export class Box { constructor(readonly value: number) {} }",
      ),
      workspace.write("src/peer.mts", "export const peer: number = 9;"),
      workspace.write("src/preferred.mjs", 'export const preferred = "js";'),
      workspace.write("src/attributes.ts", "export const value: number = 1;"),
      workspace.write("src/common/package.json", '{"type":"commonjs"}'),
      workspace.write(
        "src/common/value.ts",
        "class Box { constructor(readonly value: number) {} } module.exports = new Box(12);",
      ),
      workspace.write(
        "src/preferred.mts",
        'throw new Error("Existing JavaScript must win");',
      ),
      workspace.write(
        "src/selected space.mts",
        "export const selected: string = import.meta.url;",
      ),
      workspace.write("src/broken.mjs", "export const broken = ;"),
      workspace.write(
        "src/broken.mts",
        "globalThis.fallbackUsed = true; export const broken = 1;",
      ),
      workspace.write("outside/entry.mjs", 'import "./typed.js";'),
      workspace.write("outside/typed.ts", "export const outside: number = 1;"),
      workspace.write(
        "scripts/lib/owner.mts",
        [
          'import { Kind, Box } from "../../src/value.js";',
          'import { peer } from "../../src/peer.mjs";',
          'import { preferred } from "../../src/preferred.mjs";',
          'import { selected } from "../../src/selected%20space.mjs?caller=one%20two#origin";',
          "export const facts = { value: new Box(Kind.Ready).value, peer, preferred, selected };",
        ].join("\n"),
      ),
      workspace.write(
        "probe.mjs",
        `
import { importVerifierSource } from "./scripts/lib/verifier-source-loader.mjs";
const url = new URL("./scripts/lib/owner.mts", import.meta.url);
const first = await importVerifierSource(url);
const second = await importVerifierSource(url);
const foreign = await import("./outside/entry.mjs").then(() => "accepted", (cause) => cause.code);
const broken = await importVerifierSource(new URL("./src/broken.mjs", import.meta.url)).then(() => "accepted", (cause) => cause.name);
const attributes = await import("./src/attributes.ts", { with: { type: "json" } }).then(() => "accepted", (cause) => cause.code);
const common = await importVerifierSource(new URL("./src/common/value.ts", import.meta.url));
const selected = new URL(first.facts.selected);
console.log(JSON.stringify({
  ...first.facts, selected: { query: selected.search, fragment: selected.hash },
  sameModule: first === second, foreign, broken, attributes, common: common.default.value,
  fallbackUsed: globalThis.fallbackUsed === true,
}));
`,
      ),
    ]);
    const result = await processes.run(
      process.execPath,
      [workspace.path("probe.mjs")],
      { cwd: workspace.root, timeoutMs: 20_000 },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      value: 7,
      peer: 9,
      preferred: "js",
      selected: { query: "?caller=one%20two", fragment: "#origin" },
      sameModule: true,
      foreign: "ERR_MODULE_NOT_FOUND",
      broken: "SyntaxError",
      attributes: "ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE",
      common: 12,
      fallbackUsed: false,
    });
  },
);
