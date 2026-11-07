import { describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import rule from "../../scripts/lint/rules/no-fixture-root-cleanup.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const filename = fileURLToPath(
  new URL("../boundary/ruleControl.test.ts", import.meta.url),
);
const imports = `
import { createTestTempDirectory as temp } from "../fixtures/temporaryDirectory.js";
import { afterEach as cleanup, afterAll, onTestFinished } from "vitest";
import { rm as remove } from "node:fs/promises";
`;
const fixtureSource = new URL(
  "../fixtures/temporaryDirectory.js",
  import.meta.url,
);
const localCleanupImports = `import {afterEach} from "vitest"; import {rm} from "node:fs/promises";`;
tester.run("no-fixture-root-cleanup", rule, {
  valid: [
    `import {createTestTempDirectory as temp} from ${JSON.stringify(fixtureSource.href)}; ${localCleanupImports} function work(temp: Function) { const root = temp(); afterEach(() => rm(root)); }`,
    `import {createTestTempDirectory as temp} from "https://example.test/tests/fixtures/temporaryDirectory.js"; ${localCleanupImports} const root = await temp("owned-"); afterEach(() => rm(root));`,
    `import {createTestTempDirectory as temp} from ${JSON.stringify(`${fixtureSource.href}?other`)}; ${localCleanupImports} const root = await temp("owned-"); afterEach(() => rm(root));`,
    `${imports} const root = await temp("owned-"); await remove(root, { recursive: true });`,
    `${imports} const root = await temp("owned-"); cleanup(() => remove(join(root, "child"), {recursive: true}));`,
    `${imports} const root = await otherOwner(); cleanup(() => remove(root, { recursive: true }));`,
    `${imports} const root = await temp("owned-"); cleanup(async () => { const root = await otherOwner(); await remove(root, {recursive: true}); });`,
    `${imports} function work(temp: Function) { const root = temp(); cleanup(() => remove(root)); }`,
    `${imports} const root = await temp("owned-"); function unrelated(cleanup: Function) { cleanup(() => remove(root)); }`,
    `${imports} const root = await temp("owned-"); cleanup(() => { function remove(root: string) {} remove(root); });`,
    `${imports} const roots = []; const root = await temp("owned-"); roots.push(root); roots.push(await createIdaTarget()); cleanup(async () => { for (const owned of roots) await remove(owned); });`,
    `${imports} let root = await temp("owned-"); root = await otherOwner(); cleanup(() => remove(root));`,
    `${imports} const root = await temp("owned-"); cleanup(() => connection.close());`,
    `${imports} import * as fs from "node:fs/promises"; const root = await temp("owned-"); cleanup((fs: {rm: Function}) => fs.rm(root));`,
    `${imports} const root = await temp("owned-"); { const remove = otherOwner; cleanup(() => remove(root)); }`,
    'import { createTestTempDirectory as temp } from "./unrelated.js"; import { afterEach } from "vitest"; import { rm } from "node:fs/promises"; const root = await temp(); afterEach(() => rm(root));',
    `${imports} const root = await temp("owned-"); function callback(root: string) { return remove(root); } cleanup(callback);`,
  ].map((code) => ({ code, filename })),
  invalid: [
    `import {createTestTempDirectory as temp} from ${JSON.stringify(fixtureSource.href)}; ${localCleanupImports} const root = await temp("owned-"); afterEach(() => rm(root));`,
    `import {createTestTempDirectory as temp} from ${JSON.stringify(fileURLToPath(fixtureSource))}; ${localCleanupImports} const root = await temp("owned-"); afterEach(() => rm(root));`,
    `${imports} const root = await temp("owned-"); cleanup(() => remove(root, {recursive: true}));`,
    `${imports} const root = await temp("owned-"); afterAll(async () => { await remove(root, {recursive: true}); });`,
    `${imports} const root = await temp("owned-"); onTestFinished(() => remove(root, {recursive: true}));`,
    `${imports} const root = await temp("owned-"); const alias = root; cleanup(() => remove(alias));`,
    `${imports} const root = await temp("owned-"); async function release() { await remove(root); } cleanup(release);`,
    `${imports} const root = await temp("owned-"); const release = () => remove(root); cleanup(release);`,
    `${imports} import { rmSync } from "node:fs"; const root = await temp("owned-"); cleanup(() => rmSync(root, {recursive: true}));`,
    `${imports} import { removeTestWorkspace as release } from "../support/workspace/workspaceFixture.js"; const root = await temp("owned-"); cleanup(() => release(root));`,
    `${imports} const root = await temp("owned-"); cleanup(async () => { await connection.close(); await remove(root, {recursive: true}); });`,
    'import * as fixture from "../fixtures/temporaryDirectory.ts"; import * as vitest from "vitest"; import * as fs from "node:fs/promises"; const root = await fixture.createTestTempDirectory("owned-"); vitest.afterEach(() => fs.rm(root, {recursive: true}));',
  ].map((code) => ({ code, filename, errors: [{ messageId: "duplicate" }] })),
});
