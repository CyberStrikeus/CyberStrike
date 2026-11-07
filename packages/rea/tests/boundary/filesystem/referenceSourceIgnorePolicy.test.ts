import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

const importTree = async (root: string) => {
  const result = await importReferenceSource({
    root,
    caller: "ignore-policy-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  return result.value;
};

it("retains caller negations across project scopes while secrets remain excluded", async () => {
  const root = await createTestTempDirectory("rea-reference-caller-policy-");
  await mkdir(join(root, "nested"));
  await writeFile(join(root, ".gitignore"), "*.log\n");
  await writeFile(join(root, "nested", ".gitignore"), "*.log\n");
  for (const path of ["keep.log", "nested/keep.log", "secret.log", "drop.log"])
    await writeFile(join(root, path), "caller-selected bytes\n");
  const result = await importReferenceSource({
    root,
    caller: "caller-policy-test",
    policy: { secretPatterns: ["secret.log"] },
    excludePaths: ["!keep.log", "!secret.log"],
  });
  if (!result.ok) throw result.error;
  for (const path of ["keep.log", "nested/keep.log"])
    expect(result.value.entries).toContainEqual(
      expect.objectContaining({ path, kind: "file", content_state: "hashed" }),
    );
  expect(result.value.exclusions).toContainEqual({
    path: "secret.log",
    entry_kind: "file",
    reason: "configured-secret",
    pattern: "secret.log",
  });
  expect(result.value.exclusions).toContainEqual({
    path: "drop.log",
    entry_kind: "file",
    reason: "default-ignored",
    pattern: "*.log",
  });
});

it("keeps unreadable scoped policy fatal after opening a readable directory", async () => {
  const root = await createTestTempDirectory(
    "rea-reference-scoped-policy-refusal-",
  );
  const child = join(root, "child");
  await mkdir(join(child, ".gitignore"), { recursive: true });
  await writeFile(join(child, "unexamined.ts"), "export const value = 1;\n");
  const result = await importReferenceSource({
    root,
    caller: "scoped-policy-refusal-test",
    policy: { secretPatterns: [] },
  });
  if (result.ok) throw new Error("Invalid scoped policy was ignored");
  expect(result.error.code).toBe("io");
  expect(result.error.message).toContain(join(child, ".gitignore"));
  expect(result.error.partial?.entries).not.toContainEqual(
    expect.objectContaining({ path: "child/unexamined.ts" }),
  );
});

it("scopes nested ignore rules and negations like Git while preserving mandatory exclusions", async () => {
  const root = await createTestTempDirectory("rea-reference-scoped-policy-");
  await execFileOutput("git", ["init", "--initial-branch=main", root]);
  await execFileOutput("git", [
    "-C",
    root,
    "config",
    "core.ignorecase",
    "false",
  ]);
  await mkdir(join(root, "packages", "widget", "blocked"), { recursive: true });
  await mkdir(join(root, "packages", "widget", "node_modules"));
  await mkdir(join(root, "sibling"));
  await writeFile(join(root, ".gitignore"), "*.tmp\nblocked/\n");
  await writeFile(
    join(root, "packages", "widget", ".gitignore"),
    "/local.js\n!keep.tmp\n!node_modules/\n",
  );
  await writeFile(
    join(root, "packages", "widget", "blocked", ".gitignore"),
    "!inside.js\n",
  );
  const excluded = [
    "drop.tmp",
    "packages/widget/local.js",
    "packages/widget/blocked/inside.js",
  ];
  const included = [
    "packages/widget/keep.tmp",
    "packages/widget/main.js",
    "sibling/local.js",
  ];
  for (const path of [
    ...excluded,
    ...included,
    "packages/widget/node_modules/dependency.js",
  ])
    await writeFile(join(root, path), "export const value = 1;\n");
  const oracle = await execFileOutput("git", [
    "-C",
    root,
    "check-ignore",
    "--no-index",
    ...excluded,
    ...included,
  ]);
  expect(oracle.stdout.trim().split(/\r?\n/u)).toEqual(excluded);
  const graph = await importTree(root);
  const files = graph.entries
    .filter(({ kind }) => kind === "file")
    .map(({ path }) => path);
  for (const path of included) expect(files).toContain(path);
  for (const path of [
    ...excluded,
    "packages/widget/node_modules/dependency.js",
  ])
    expect(files).not.toContain(path);
  expect(graph.exclusions).toContainEqual({
    path: "packages/widget/local.js",
    entry_kind: "file",
    reason: "project-ignored",
    pattern: "/local.js",
  });
  expect(graph.exclusions).toContainEqual({
    path: "packages/widget/node_modules",
    entry_kind: "directory",
    reason: "default-ignored",
    pattern: "node_modules/",
  });
  expect(
    await readFile(join(root, "packages", "widget", "keep.tmp"), "utf8"),
  ).toBe("export const value = 1;\n");
});

it.each([false, true])(
  "honors local core.ignorecase=%s against Git's check-ignore oracle",
  async (ignoreCase) => {
    const root = await createTestTempDirectory("rea-reference-ignore-case-");
    await execFileOutput("git", ["init", "--initial-branch=main", root]);
    await execFileOutput("git", [
      "-C",
      root,
      "config",
      "core.ignorecase",
      String(ignoreCase),
    ]);
    await writeFile(join(root, ".gitignore"), "*.TMP\n");
    await writeFile(join(root, "upper.TMP"), "upper\n");
    await writeFile(join(root, "lower.tmp"), "lower\n");
    const oracle = await execFileOutput("git", [
      "-C",
      root,
      "check-ignore",
      "--no-index",
      "upper.TMP",
      "lower.tmp",
    ]);
    const expected = oracle.stdout.trim().split(/\r?\n/u);
    const graph = await importTree(root);
    expect(
      graph.exclusions
        .filter(({ reason }) => reason === "project-ignored")
        .map(({ path }) => path),
    ).toEqual([...expected].sort());
    expect(graph.entries.some(({ path }) => path === "lower.tmp")).toBe(
      !ignoreCase,
    );
  },
);

it.skipIf(process.platform === "win32")(
  "binds Git pointer/configuration reads to physical symlink-parent selection",
  async () => {
    const root = await createTestTempDirectory("rea-reference-git-parent-");
    const source = join(root, "source");
    const physical = join(root, "physical");
    await mkdir(source);
    await mkdir(join(physical, "child"), { recursive: true });
    await mkdir(join(physical, "metadata"));
    await mkdir(join(source, "metadata"));
    await symlink(join(physical, "child"), join(source, "alias"));
    const intendedHead = "1".repeat(40);
    for (const [directory, head, ignoreCase] of [
      [join(physical, "metadata"), intendedHead, false],
      [join(source, "metadata"), "2".repeat(40), true],
    ] as const) {
      await writeFile(join(directory, "HEAD"), `${head}\n`);
      await writeFile(
        join(directory, "config"),
        `[core]\nignorecase = ${String(ignoreCase)}\n`,
      );
    }
    await writeFile(join(source, ".git"), "gitdir: alias/../metadata\n");
    await writeFile(join(source, ".gitignore"), "*.TMP\n");
    await writeFile(join(source, "lower.tmp"), "selected policy\n");
    const graph = await importTree(source);
    expect(graph.entries.some(({ path }) => path === "lower.tmp")).toBe(true);
    expect(graph.vcs).toMatchObject({ kind: "git", head: intendedHead });
  },
);

it("keeps a present but unresolved Git common-directory pointer from selecting private decoy configuration", async () => {
  const root = await createTestTempDirectory("rea-reference-common-missing-");
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "HEAD"), `${"1".repeat(40)}\n`);
  await writeFile(join(root, ".git", "config"), "[core]\nignorecase = true\n");
  await writeFile(join(root, ".git", "commondir"), "../missing-common\n");
  const result = await importReferenceSource({
    root,
    caller: "ignore-policy-test",
    policy: { secretPatterns: [] },
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "io", message: expect.stringContaining("missing-common") },
  });
});
