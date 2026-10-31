import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { withArtifactResourceScope } from "../../fixtures/artifactInventory.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { readReferenceSourceVcs } from "../../../src/application/ReferenceSourceVcsAdapter.js";

const readVcs = (root: string, signal?: AbortSignal) =>
  withArtifactResourceScope(async (resources) => {
    const result = await readReferenceSourceVcs(root, resources, signal);
    if (!result.ok) throw result.error;
    return result.value;
  });

it("reads a linked worktree's own branch and detached HEAD through shared Git refs", async () => {
  const root = await createTestTempDirectory("rea-reference-worktree-");
  const repository = join(root, "repository");
  await mkdir(repository);
  const git = (...args: string[]) =>
    execFileOutput("git", args, { cwd: repository });
  await git("init", "--initial-branch=main");
  const commit = () =>
    git(
      "-c",
      "user.name=REA fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
  await commit();
  const mainHead = (await git("rev-parse", "HEAD")).stdout.trim();
  const linked = join(root, "linked");
  await git("worktree", "add", "-b", "linked", linked);
  await execFileOutput(
    "git",
    [
      "-c",
      "user.name=REA fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "linked fixture",
    ],
    { cwd: linked },
  );
  const linkedHead = (
    await execFileOutput("git", ["rev-parse", "HEAD"], { cwd: linked })
  ).stdout.trim();
  expect(linkedHead).not.toBe(mainHead);
  expect(await readVcs(repository)).toEqual({
    kind: "git",
    head: mainHead,
    dirty: null,
  });
  expect(await readVcs(linked)).toEqual({
    kind: "git",
    head: linkedHead,
    dirty: null,
  });
  await git("pack-refs", "--all", "--prune");
  expect(await readVcs(linked)).toEqual({
    kind: "git",
    head: linkedHead,
    dirty: null,
  });
  await execFileOutput("git", ["checkout", "--detach", mainHead], {
    cwd: linked,
  });
  expect(await readVcs(linked)).toEqual({
    kind: "git",
    head: mainHead,
    dirty: null,
  });
  const relativePointer = join(root, "relative");
  await mkdir(relativePointer);
  await writeFile(
    join(relativePointer, ".git"),
    "gitdir: ../repository/.git\r\n",
  );
  expect(await readVcs(relativePointer)).toEqual({
    kind: "git",
    head: mainHead,
    dirty: null,
  });
  // A non-regular loose ref must remain unknown even when packed-refs has
  // a readable value. The library's promise-API probe is not a source failure.
  await mkdir(join(repository, ".git", "refs", "heads", "main"));
  expect(await readVcs(repository)).toEqual({
    kind: "unknown",
    head: null,
    dirty: null,
  });
  const controller = new AbortController();
  controller.abort();
  expect(await readVcs(linked, controller.signal)).toEqual({
    kind: "unknown",
    head: null,
    dirty: null,
  });
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "keeps unreadable loose refs unknown instead of falling back to packed refs",
  async () => {
    const root = await createTestTempDirectory("rea-reference-loose-ref-");
    const gitdir = join(root, ".git");
    const looseRef = join(gitdir, "refs", "heads", "main");
    await mkdir(join(gitdir, "refs", "heads"), { recursive: true });
    const head = "1234567890abcdef1234567890abcdef12345678";
    await writeFile(join(gitdir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(gitdir, "packed-refs"), `${head} refs/heads/main\n`);
    await writeFile(looseRef, `${head}\n`);
    await chmod(looseRef, 0);
    try {
      expect(await readVcs(root)).toEqual({
        kind: "unknown",
        head: null,
        dirty: null,
      });
    } finally {
      await chmod(looseRef, 0o600);
    }
  },
);
