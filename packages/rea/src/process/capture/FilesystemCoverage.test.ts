import { requirePermissionDenial } from "../../../tests/fixtures/permissionDenial.js";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  snapshotRoots,
  ProcessCaptureSnapshotFailure,
} from "./FilesystemSnapshot.js";
import { classifyFilesystemEffects } from "./ProcessFilesystemEffects.js";
import { prepareProcessCapture } from "./ProcessCaptureLifecycle.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";

it.each(["after", "before"] as const)(
  "keeps absence unknown when the %s snapshot omits an existing file",
  async (partialSide) => {
    // Enumeration order is filesystem-dependent. Choose a genuinely omitted
    // entry by comparing a complete snapshot with a capacity-limited one.
    const root = await createTestTempDirectory("rea-fs-partial-absence-");
    await writeFile(join(root, "a1.txt"), "first");
    await writeFile(join(root, "a2.txt"), "second");
    await writeFile(join(root, "z.txt"), "target");
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { files: 2 },
    });
    const complete = await snapshotRoots({
      ...scenario,
      limits: { ...scenario.limits, files: 4 },
    });
    const partial = await snapshotRoots(scenario);
    expect(complete.completeRoots).toEqual(["root_0"]);
    expect(partial.truncated).toBe(true);
    const omitted = complete.files.find(
      (file) => !partial.files.some(({ path }) => path === file.path),
    );
    if (omitted === undefined) throw new Error("Expected an omitted entry");
    const before = partialSide === "before" ? partial : complete;
    const after = partialSide === "after" ? partial : complete;
    const effect = classifyFilesystemEffects(before, after).find(
      ({ path }) => path === omitted.path,
    );
    expect(effect?.status).toBe("unknown");
    expect(effect).toMatchObject({
      ...(partialSide === "after"
        ? { before: omitted, after: null }
        : { before: null, after: omitted }),
      reason: expect.stringContaining("did not exhaust path enumeration"),
    });
  },
);

it("preserves proven deletion in an exhausted root while another root is partial", async () => {
  const root = await createTestTempDirectory("rea-fs-multiple-roots-");
  const complete = join(root, "complete");
  const partial = join(root, "partial");
  await mkdir(complete);
  await mkdir(partial);
  await writeFile(join(complete, "removed.txt"), "removed");
  await writeFile(join(partial, "first.txt"), "first");
  await writeFile(join(partial, "second.txt"), "second");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    working_directory: root,
    filesystem_observation_paths: [complete, partial],
    limits: { files: 3 },
  });
  const before = await snapshotRoots(scenario);
  await rm(join(complete, "removed.txt"));
  const after = await snapshotRoots(scenario);
  expect(before.truncated && after.truncated).toBe(true);
  expect(
    classifyFilesystemEffects(before, after).find(
      ({ path }) => path === "root_0:removed.txt",
    )?.status,
  ).toBe("deleted");
});

it("distinguishes unavailable content hashes from completed path enumeration", async () => {
  const root = await createTestTempDirectory("rea-fs-hash-coverage-");
  await writeFile(join(root, "removed.txt"), "larger than the byte budget");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    working_directory: root,
    filesystem_observation_paths: [root],
    limits: { file_bytes: 1 },
  });
  const before = await snapshotRoots(scenario);
  await rm(join(root, "removed.txt"));
  const after = await snapshotRoots(scenario);
  expect(before.truncated).toBe(true);
  expect(
    classifyFilesystemEffects(before, after).find(
      ({ path }) => path === "root_0:removed.txt",
    ),
  ).toMatchObject({ status: "deleted", before: { sha256: null }, after: null });
});

it.skipIf(process.platform === "win32")(
  "retains readable entries and marks an unreadable directory subtree unknown",
  async (context) => {
    await requirePermissionDenial(context, "directory-read");
    const root = await createTestTempDirectory("rea-fs-unreadable-directory-");
    const visible = join(root, "a-visible.txt");
    const blocked = join(root, "z-blocked");
    await writeFile(visible, "visible");
    await mkdir(blocked);
    await chmod(blocked, 0);
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
    });

    try {
      const snapshot = await snapshotRoots(scenario);
      expect(snapshot.files.map(({ path }) => path)).toContain(
        "root_0:a-visible.txt",
      );
      expect(snapshot.files.map(({ path }) => path)).toContain(
        "root_0:z-blocked",
      );
      expect(snapshot.completeRoots).toEqual([]);
      expect(snapshot.coverage.enumeration_omissions).toEqual([
        {
          path: "root_0:z-blocked",
          reason: "directory_unavailable",
          system_code: "EACCES",
        },
      ]);
      expect(snapshot.truncated).toBe(true);
    } finally {
      await chmod(blocked, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "retains unreadable-file and sibling observations in a complete snapshot",
  async (context) => {
    await requirePermissionDenial(context, "file-read");
    const root = await createTestTempDirectory("rea-fs-unreadable-file-");
    const unreadable = join(root, "unreadable.txt");
    const readable = join(root, "readable.txt");
    await writeFile(unreadable, "permission denied");
    await writeFile(readable, "still observed");
    await chmod(unreadable, 0);
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
    });

    try {
      const snapshot = await snapshotRoots(scenario);
      expect(snapshot.files.map(({ path }) => path)).toEqual([
        "root_0:.",
        "root_0:readable.txt",
        "root_0:unreadable.txt",
      ]);
      expect(
        snapshot.files.find(({ path }) => path === "root_0:readable.txt")
          ?.sha256,
      ).toEqual(expect.any(String));
      expect(
        snapshot.files.find(({ path }) => path === "root_0:unreadable.txt"),
      ).toMatchObject({ type: "file", size: 17, sha256: null });
      expect(snapshot.coverage.hash_omissions).toContainEqual({
        path: "root_0:unreadable.txt",
        size_bytes: 17,
        remaining_budget_bytes:
          scenario.limits.file_bytes - Buffer.byteLength("still observed"),
        reason: "file_unavailable",
        system_code: "EACCES",
      });
      expect(snapshot.completeRoots).toEqual(["root_0"]);
    } finally {
      await chmod(unreadable, 0o600);
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([
  { name: "both", beforeOmitted: true, afterOmitted: true, contents: "after!" },
  {
    name: "before",
    beforeOmitted: true,
    afterOmitted: false,
    contents: "after!",
  },
  {
    name: "after",
    beforeOmitted: false,
    afterOmitted: true,
    contents: "after!",
  },
  {
    name: "both for an untouched file",
    beforeOmitted: true,
    afterOmitted: true,
    contents: "before",
  },
])(
  "keeps content equality unknown when $name snapshots omit its digest",
  async ({ beforeOmitted, afterOmitted, contents }) => {
    const root = await createTestTempDirectory("rea-fs-content-unknown-");
    const budgetFile = join(root, "a.txt");
    const file = join(root, "b.txt");
    await writeFile(file, "before");
    if (beforeOmitted) await writeFile(budgetFile, "budget");
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { file_bytes: 6 },
    });
    const before = await snapshotRoots(scenario);
    if (beforeOmitted && !afterOmitted) await rm(budgetFile);
    if (!beforeOmitted && afterOmitted) await writeFile(budgetFile, "budget");
    if (contents !== "before") await writeFile(file, contents);
    const after = await snapshotRoots(scenario);
    expect(await readFile(file, "utf8")).toBe(contents);
    const effect = classifyFilesystemEffects(before, after).find(
      ({ path }) => path === "root_0:b.txt",
    );
    expect(effect).toMatchObject({
      status: "unknown",
      before: {
        type: "file",
        size: 6,
        sha256: beforeOmitted ? null : expect.any(String),
      },
      after: {
        type: "file",
        size: 6,
        sha256: afterOmitted ? null : expect.any(String),
      },
      reason: expect.stringMatching(/content.*hash|hash.*content/iu),
    });
  },
);

it("preserves observed content and metadata changes without treating missing hashes as equality", async () => {
  const root = await createTestTempDirectory("rea-fs-observed-changes-");
  for (const name of ["changed", "stable", "unhashed", "retyped"])
    await writeFile(join(root, name), "before");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    working_directory: root,
    filesystem_observation_paths: [root],
  });
  const before = await snapshotRoots(scenario);
  await writeFile(join(root, "changed"), "after!");
  await writeFile(join(root, "unhashed"), "different size");
  await rm(join(root, "retyped"));
  await mkdir(join(root, "retyped"));
  const after = await snapshotRoots(scenario);
  const effects = classifyFilesystemEffects(before, after);
  expect(effects.find(({ path }) => path === "root_0:changed")?.status).toBe(
    "modified",
  );
  expect(effects.find(({ path }) => path === "root_0:stable")?.status).toBe(
    "unchanged",
  );
  expect(effects.find(({ path }) => path === "root_0:retyped")?.status).toBe(
    "modified",
  );
  const noHashes = processScenarioSchema.parse({
    ...scenario,
    limits: { file_bytes: 1 },
  });
  const unhashedBefore = await snapshotRoots(noHashes);
  await writeFile(join(root, "unhashed"), "size changed again");
  const unhashedAfter = await snapshotRoots(noHashes);
  expect(
    classifyFilesystemEffects(unhashedBefore, unhashedAfter).find(
      ({ path }) => path === "root_0:unhashed",
    ),
  ).toMatchObject({
    status: "modified",
    before: { sha256: null },
    after: { sha256: null },
  });
});

it.skipIf(process.platform === "win32")(
  "preserves an observed permission change when file digests are omitted",
  async () => {
    const root = await createTestTempDirectory("rea-fs-mode-change-");
    const file = join(root, "file");
    await writeFile(file, "before", { mode: 0o600 });
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [file],
      limits: { file_bytes: 1 },
    });
    const before = await snapshotRoots(scenario);
    await chmod(file, 0o644);
    const after = await snapshotRoots(scenario);
    expect(classifyFilesystemEffects(before, after)).toMatchObject([
      { status: "modified", before: { sha256: null }, after: { sha256: null } },
    ]);
  },
);

it.skipIf(process.platform === "win32")(
  "compares directories and symlink targets without requiring file content hashes",
  async () => {
    const root = await createTestTempDirectory("rea-fs-nonfile-effects-");
    await mkdir(join(root, "empty"));
    await writeFile(join(root, "a.txt"), "before");
    await writeFile(join(root, "b.txt"), "unused");
    await symlink("a.txt", join(root, "stable-link"));
    await symlink("a.txt", join(root, "moved-link"));
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { file_bytes: 1 },
    });
    const before = await snapshotRoots(scenario);
    await writeFile(join(root, "a.txt"), "after!");
    await rm(join(root, "moved-link"));
    await symlink("b.txt", join(root, "moved-link"));
    const after = await snapshotRoots(scenario);
    const effects = classifyFilesystemEffects(before, after);
    for (const name of ["empty", "stable-link"])
      expect(
        effects.find(({ path }) => path === `root_0:${name}`)?.status,
      ).toBe("unchanged");
    expect(
      effects.find(({ path }) => path === "root_0:moved-link")?.status,
    ).toBe("modified");
  },
);

it.skipIf(process.platform === "win32")(
  "keeps the observed symlink target when dot segments resolve to the same path",
  async () => {
    const root = await createTestTempDirectory("rea-fs-symlink-spelling-");
    await mkdir(join(root, "aaa"));
    await writeFile(join(root, "target"), "content");
    // Equal length, so only the target spelling distinguishes the links;
    // "bbb" does not exist, so the replacement link is broken.
    await symlink("aaa/../target", join(root, "link"));
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { file_bytes: 1 },
    });
    const before = await snapshotRoots(scenario);
    await rm(join(root, "link"));
    await symlink("bbb/../target", join(root, "link"));
    const after = await snapshotRoots(scenario);

    const link = (snapshot: typeof before) =>
      snapshot.files.find(({ path }) => path === "root_0:link");
    expect(link(before)?.symlink_target).toBe("aaa/../target");
    expect(link(after)?.symlink_target).toBe("bbb/../target");
    expect(
      classifyFilesystemEffects(before, after).find(
        ({ path }) => path === "root_0:link",
      )?.status,
    ).toBe("modified");
  },
);

it("preserves creation when the selected root was observed missing before capture", async () => {
  const root = await createTestTempDirectory("rea-fs-missing-root-");
  const file = join(root, "created.txt");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    working_directory: root,
    filesystem_observation_paths: [file],
  });
  const before = await snapshotRoots(scenario);
  await writeFile(file, "created");
  const after = await snapshotRoots(scenario);
  expect(before.files).toEqual([]);
  expect(before.truncated).toBe(false);
  expect(classifyFilesystemEffects(before, after)).toMatchObject([
    {
      path: "root_0:.",
      status: "created",
      before: null,
      after: { type: "file" },
    },
  ]);
});

it.skipIf(process.platform === "win32")(
  "rejects only selected roots that cannot be admitted before launch",
  async (context) => {
    await requirePermissionDenial(context, "directory-search");
    const root = await createTestTempDirectory("rea-fs-root-admission-");
    await writeFile(join(root, "file"), "regular file");
    await mkdir(join(root, "denied"));
    await chmod(join(root, "denied"), 0);
    const scenarioFor = (path: string) =>
      processScenarioSchema.parse({
        executable: process.execPath,
        working_directory: root,
        filesystem_observation_paths: [path],
      });
    try {
      await expect(
        snapshotRoots(scenarioFor(join(root, "file", "child"))),
      ).rejects.toMatchObject({ message: expect.stringContaining("ENOTDIR") });
      const deniedFailure = await snapshotRoots(
        scenarioFor(join(root, "denied", "child")),
      ).catch((cause: unknown) => cause);
      if (!(deniedFailure instanceof ProcessCaptureSnapshotFailure))
        throw deniedFailure;
      expect(
        projectAnalysisError(deniedFailure.failureForCaller()),
      ).toMatchObject({
        code: "access_denied",
        details: { path: join(root, "denied", "child"), system_code: "EACCES" },
      });
      // The same lookups after admission are absence and an omission.
      const admission = await snapshotRoots(scenarioFor(join(root, "missing")));
      expect(admission.completeRoots).toEqual(["root_0"]);
      const obstructed = await snapshotRoots(
        scenarioFor(join(root, "file", "child")),
        undefined,
        admission,
      );
      expect(obstructed).toMatchObject({
        files: [],
        completeRoots: ["root_0"],
        truncated: false,
      });
      const denied = await snapshotRoots(
        scenarioFor(join(root, "denied", "child")),
        undefined,
        admission,
      );
      expect(denied).toMatchObject({
        files: [],
        completeRoots: [],
        truncated: true,
        coverage: {
          enumeration_truncated: true,
          enumeration_reasons: ["entry_unavailable"],
          enumeration_omissions: [
            {
              path: "root_0:.",
              reason: "entry_unavailable",
              system_code: "EACCES",
            },
          ],
        },
      });
    } finally {
      await chmod(join(root, "denied"), 0o700);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "records an unsearchable directory's children as omitted rather than failing",
  async (context) => {
    await requirePermissionDenial(context, "directory-search");
    const root = await createTestTempDirectory("rea-fs-unsearchable-");
    const listed = join(root, "listed");
    await mkdir(listed);
    await writeFile(join(listed, "child.txt"), "child");
    // Read without search permission: names enumerate, lookups are denied.
    await chmod(listed, 0o444);
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
    });
    try {
      const snapshot = await snapshotRoots(scenario);
      expect(snapshot.files.map(({ path }) => path)).toEqual([
        "root_0:.",
        "root_0:listed",
      ]);
      expect(snapshot.completeRoots).toEqual([]);
      expect(snapshot.coverage.enumeration_omissions).toEqual([
        {
          path: "root_0:listed/child.txt",
          reason: "entry_unavailable",
          system_code: "EACCES",
        },
      ]);
    } finally {
      await chmod(listed, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps an admitted root behind a symlink loop unobserved",
  async () => {
    const root = await createTestTempDirectory("rea-fs-root-loop-");
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [join(root, "loop", "child")],
    });
    const before = await snapshotRoots(scenario);
    await symlink("loop", join(root, "loop"));
    const after = await snapshotRoots(scenario, undefined, before);
    expect(after.completeRoots).toEqual([]);
    expect(after.coverage.enumeration_omissions).toEqual([
      { path: "root_0:.", reason: "entry_unavailable", system_code: "ELOOP" },
    ]);
  },
);

it.skipIf(process.platform === "win32")(
  "owns symlink subtree uncertainty independently of complete metadata enumeration",
  async () => {
    const root = await createTestTempDirectory("rea-symlink-subtree-");
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    await symlink(target, link);
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      filesystem_observation_paths: [link],
    });
    const before = await snapshotRoots(scenario);
    await writeFile(join(target, "created.txt"), "unobserved change");
    const after = await snapshotRoots(scenario);
    expect(before.files).toEqual(after.files);
    expect(after.coverage.enumeration_truncated).toBe(true);
    expect(after.coverage.enumeration_omissions).toEqual([
      { path: "root_0:.", reason: "symlink_not_followed", system_code: null },
    ]);
    expect(after.completeRoots).toEqual([]);
    expect(after.coverage.unobserved_subtrees).toEqual([
      { path: "root_0:.", reason: "symlink_not_followed" },
    ]);
    const followed = await snapshotRoots({
      ...scenario,
      filesystem_observation_paths: [target],
    });
    expect(followed.coverage.unobserved_subtrees).toEqual([]);
    expect(
      followed.files.some(({ path }) => path === "root_0:created.txt"),
    ).toBe(true);
  },
);

it("allocates the observer directory before baseline and excludes it before entry accounting", async () => {
  const root = await createTestTempDirectory("rea-observer-filesystem-");
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    filesystem_observation_paths: [root],
    limits: { files: 1 },
  });
  const prepared = await prepareProcessCapture(
    scenario,
    undefined,
    snapshotRoots,
    {
      createTemporaryRoot: () => mkdtemp(join(root, "rea-process-")),
      cleanup: (path) => rm(path, { recursive: true, force: true }),
    },
  );
  try {
    const after = await snapshotRoots(scenario, undefined, prepared.before, {
      observerPaths: [prepared.temporaryRoot],
    });
    expect(after.files).toEqual(prepared.before.files);
    expect(after.files).toHaveLength(1);
    expect(after.truncated).toBe(false);
    expect(after.coverage.enumeration_reasons).toEqual([]);
    expect(after.coverage.unobserved_subtrees).toMatchObject([
      { reason: "observer_owned" },
    ]);
    expect(
      classifyFilesystemEffects(prepared.before, after).map(
        ({ status }) => status,
      ),
    ).toEqual(["unchanged"]);
  } finally {
    await rm(prepared.temporaryRoot, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "excludes the exact observer path through parent aliases while retaining same-name target directories",
  async () => {
    const fixture = await createTestTempDirectory("rea-observer-alias-");
    const physicalParent = join(fixture, "physical");
    const root = join(physicalParent, "root");
    const alias = join(fixture, "alias");
    const owner = join(root, "observer-run");
    await mkdir(owner, { recursive: true });
    await mkdir(join(root, "other", "observer-run"), { recursive: true });
    await writeFile(
      join(root, "other", "observer-run", "target.txt"),
      "target",
    );
    await symlink(physicalParent, alias);
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      filesystem_observation_paths: [join(alias, "root")],
    });
    const snapshot = await snapshotRoots(scenario, undefined, undefined, {
      observerPaths: [owner],
    });
    expect(snapshot.coverage.unobserved_subtrees).toEqual([
      { path: "root_0:observer-run", reason: "observer_owned" },
    ]);
    expect(snapshot.files.map(({ path }) => path)).toEqual([
      "root_0:.",
      "root_0:other",
      "root_0:other/observer-run",
      "root_0:other/observer-run/target.txt",
    ]);
    expect(snapshot.coverage.enumeration_truncated).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "preserves non-UTF-8 symlink target bytes through snapshot effects and schema parsing",
  async () => {
    const { processFilesystemSnapshotSchema } =
      await import("../../domain/process/processCapture.js");
    const root = await createTestTempDirectory("rea-fs-symlink-bytes-");
    const path = join(root, "link");
    const first = Buffer.from([0x61, 0xff]);
    const second = Buffer.from([0x61, 0xfe]);
    await symlink(first, path);
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      filesystem_observation_paths: [root],
    });
    const before = processFilesystemSnapshotSchema.parse(
      await snapshotRoots(scenario),
    );
    await rm(path);
    await symlink(second, path);
    const after = processFilesystemSnapshotSchema.parse(
      await snapshotRoots(scenario),
    );
    const link = before.files.find((file) => file.type === "symlink");
    expect(link).toMatchObject({
      symlink_target: null,
      symlink_target_hex: "61ff",
    });
    expect(
      classifyFilesystemEffects(before, after).find(
        ({ path }) => path === "root_0:link",
      )?.status,
    ).toBe("modified");
    expect(
      classifyFilesystemEffects(before, before).find(
        ({ path }) => path === "root_0:link",
      )?.status,
    ).toBe("unchanged");
    expect(
      processFilesystemSnapshotSchema.safeParse({
        ...before,
        files: [{ ...link, symlink_target: "a�" }],
      }).success,
    ).toBe(false);
    expect(
      processFilesystemSnapshotSchema.safeParse({
        ...before,
        files: [{ ...link, symlink_target_hex: "f" }],
      }).success,
    ).toBe(false);
    expect(
      processFilesystemSnapshotSchema.safeParse({
        ...before,
        files: [{ ...link, symlink_target_hex: undefined }],
      }).success,
    ).toBe(false);
    const legacy = processFilesystemSnapshotSchema.parse({
      ...before,
      files: [{ ...link, symlink_target: "a�", symlink_target_hex: undefined }],
    });
    expect(classifyFilesystemEffects(legacy, legacy)[0]?.status).toBe(
      "unknown",
    );
    const differentLegacy = processFilesystemSnapshotSchema.parse({
      ...legacy,
      files: legacy.files.map((file) => ({ ...file, symlink_target: "b�" })),
    });
    expect(classifyFilesystemEffects(legacy, differentLegacy)[0]?.status).toBe(
      "modified",
    );
    const valid = processFilesystemSnapshotSchema.parse({
      ...before,
      files: [
        {
          ...link,
          symlink_target: "a�",
          symlink_target_hex: Buffer.from("a�").toString("hex"),
        },
      ],
    });
    expect(classifyFilesystemEffects(valid, valid)[0]?.status).toBe(
      "unchanged",
    );
    const oldValid = processFilesystemSnapshotSchema.parse({
      ...before,
      files: [
        { ...link, symlink_target: "target", symlink_target_hex: undefined },
      ],
    });
    const newValid = processFilesystemSnapshotSchema.parse({
      ...before,
      files: [
        {
          ...link,
          symlink_target: "target",
          symlink_target_hex: Buffer.from("target").toString("hex"),
        },
      ],
    });
    expect(classifyFilesystemEffects(oldValid, newValid)[0]?.status).toBe(
      "unchanged",
    );
  },
);
