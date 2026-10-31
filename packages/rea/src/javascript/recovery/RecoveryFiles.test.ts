import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import {
  AnalysisAccessDeniedError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactFileCleanupFailure } from "../../artifacts/ArtifactFileOperation.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import {
  openRegularFile,
  RegularFileAdmissionFailure,
} from "../../filesystem/RegularFile.js";
import { readWithoutFifoWriter } from "../../../tests/fixtures/fifoInput.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { readRecoveryFile, snapshotRecoveryInputs } from "./RecoveryFiles.js";

vi.mock("../../filesystem/RegularFile.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../filesystem/RegularFile.js")>();
  return { ...actual, openRegularFile: vi.fn(actual.openRegularFile) };
});

// Fault injection for the snapshot write; other calls use the real filesystem.
const snapshotFault = vi.hoisted(() => ({
  mkdir: undefined as Error | undefined,
  writeFile: undefined as Error | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (snapshotFault.mkdir !== undefined) throw snapshotFault.mkdir;
      return actual.mkdir(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (snapshotFault.writeFile !== undefined) throw snapshotFault.writeFile;
      return actual.writeFile(...args);
    },
  };
});

const filesystemError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: injected snapshot failure`), { code });

const snapshotWithFault = async (
  fault: Partial<typeof snapshotFault>,
): Promise<unknown> => {
  const root = await createTestTempDirectory("rea-recovery-fault-");
  const selected = join(root, "bundle.js");
  await writeFile(selected, "module.exports = 1;\n");
  const snapshots = join(root, "snapshots");
  await mkdir(snapshots);
  Object.assign(snapshotFault, fault);
  try {
    return await snapshotRecoveryInputs([selected], snapshots).catch(
      (cause: unknown) => cause,
    );
  } finally {
    snapshotFault.mkdir = undefined;
    snapshotFault.writeFile = undefined;
  }
};

it.skipIf(process.platform === "win32")(
  "rejects a named pipe without waiting for a writer",
  async () => {
    const root = await createTestTempDirectory("rea-recovery-fifo-");
    const regular = join(root, "regular.js");
    await writeFile(regular, "module.exports = 1;\n");
    await expect(readRecoveryFile(regular, 1024)).resolves.toHaveLength(20);

    const fifoPath = join(root, "sample.js");
    await promisify(execFile)("mkfifo", [fifoPath]);
    const outcome = await readWithoutFifoWriter(fifoPath, () =>
      readRecoveryFile(fifoPath, 1024).catch((cause: unknown) => cause),
    );
    if (outcome.state !== "completed")
      throw new Error("Recovery input read waited for a FIFO writer");
    expect(outcome.result).toBeInstanceOf(AnalysisOutputError);
  },
);

it("keeps a failed admission close owned when cancellation is also requested", async () => {
  const owner = new OwnedFileHandle({ fd: -1 } as never);
  const failure = new RegularFileAdmissionFailure(
    "/selected.js",
    new Error("cancelled during admission"),
    new Error("close failed"),
    owner,
  );
  const controller = new AbortController();
  vi.mocked(openRegularFile).mockImplementationOnce(async () => {
    controller.abort();
    throw failure;
  });
  const observed = await readRecoveryFile(
    "/selected.js",
    1024,
    controller.signal,
  ).catch((cause: unknown) => cause);
  expect(observed).toBeInstanceOf(ArtifactFileCleanupFailure);
  if (!(observed instanceof ArtifactFileCleanupFailure)) return;
  expect(observed.fileCleanupFailure.owner).toBe(owner);
  expect(observed.fileCleanupFailure.outcome).toEqual({
    kind: "failed",
    cause: failure.cause,
  });
  expect(observed.fileCleanupFailure.cleanupCause).toBe(failure.cleanupCause);
});

it.each(["EACCES", "EPERM"] as const)(
  "preserves %s while acquiring a selected recovery input",
  async (code) => {
    const root = await createTestTempDirectory("rea-recovery-access-");
    const selected = join(root, "selected.js");
    const snapshots = join(root, "snapshots");
    await mkdir(snapshots);
    const denied = filesystemError(code);
    vi.mocked(openRegularFile).mockRejectedValueOnce(denied);
    const failure = await snapshotRecoveryInputs([selected], snapshots).catch(
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(AnalysisAccessDeniedError);
    expect(failure).toMatchObject({
      operation: "recover_javascript_sources",
      path: selected,
      systemCode: code,
      cause: denied,
    });
  },
);

it("reports one file selected under two letter cases as an input error", async (context) => {
  const root = await createTestTempDirectory("rea-recovery-case-");
  const lower = join(root, "bundle.js");
  const upper = join(root, "BUNDLE.js");
  await writeFile(lower, "module.exports = 1;\n");
  // Only a case-insensitive filesystem, such as the default Windows and macOS
  // ones, resolves both spellings to the selected file.
  if (
    !(await stat(upper).then(
      () => true,
      () => false,
    ))
  )
    context.skip();
  const snapshots = join(root, "snapshots");
  await mkdir(snapshots);

  const failure = await snapshotRecoveryInputs([lower, upper], snapshots).catch(
    (cause: unknown) => cause,
  );

  expect(failure).toBeInstanceOf(AnalysisInputError);
  expect((failure as AnalysisInputError).issues).toEqual([
    expect.objectContaining({
      path: ["additional_paths"],
      message: expect.stringContaining(upper),
    }),
  ]);
});

it("reports one file selected twice as an input error", async () => {
  const root = await createTestTempDirectory("rea-recovery-twice-");
  const selected = join(root, "bundle.js");
  await writeFile(selected, "module.exports = 1;\n");
  const snapshots = join(root, "snapshots");
  await mkdir(snapshots);

  const failure = await snapshotRecoveryInputs(
    [selected, selected],
    snapshots,
  ).catch((cause: unknown) => cause);

  expect(failure).toBeInstanceOf(AnalysisInputError);
  expect((failure as AnalysisInputError).issues).toEqual([
    expect.objectContaining({
      path: ["additional_paths"],
      message: expect.stringContaining("collides with another selected input"),
    }),
  ]);
  // The filesystem's own report stays attached for diagnosis.
  expect((failure as AnalysisInputError).cause).toMatchObject({
    code: "EEXIST",
  });
});

it.skipIf(process.platform === "win32")(
  "keeps distinct filesystem selections whose lexical paths collapse together",
  async () => {
    const root = await realpath(
      await createTestTempDirectory("rea-recovery-selected-layout-"),
    );
    await mkdir(join(root, "target/child"), { recursive: true });
    await symlink("target/child", join(root, "link"));
    const selected = `${root}/link/../input.js`;
    const sibling = join(root, "input.js");
    await writeFile(selected, "export const selected = 1;\n");
    await writeFile(sibling, "export const sibling = 2;\n");
    const snapshots = await snapshotRecoveryInputs(
      [selected, sibling],
      join(root, "snapshots"),
    );
    expect(
      snapshots.map(({ path, relative_path }) => ({ path, relative_path })),
    ).toEqual([
      { path: selected, relative_path: "target/input.js" },
      { path: sibling, relative_path: "input.js" },
    ]);
    expect(await readFile(snapshots[0].snapshot_path, "utf8")).toBe(
      "export const selected = 1;\n",
    );
    expect(await readFile(snapshots[1]!.snapshot_path, "utf8")).toBe(
      "export const sibling = 2;\n",
    );
    await writeFile(selected, "export const selected = 3;\n");
    const refreshed = await snapshotRecoveryInputs(
      [selected, sibling],
      join(root, "refreshed"),
    );
    expect(refreshed[0].sha256).not.toBe(snapshots[0].sha256);
    expect(refreshed[1]!.sha256).toBe(snapshots[1]!.sha256);
    expect(await readFile(snapshots[0].snapshot_path, "utf8")).toBe(
      "export const selected = 1;\n",
    );
  },
);

it.skipIf(process.platform === "win32")(
  "refuses a regular-file/.. traversal before deriving the snapshot layout",
  async () => {
    const root = await createTestTempDirectory("rea-recovery-invalid-parent-");
    await writeFile(join(root, "file"), "not a directory");
    await writeFile(join(root, "input.js"), "export const sibling = 1;\n");
    const snapshots = join(root, "snapshots");
    await expect(
      snapshotRecoveryInputs([`${root}/file/../input.js`], snapshots),
    ).rejects.toMatchObject({ _tag: "AnalysisInputError" });
    await expect(stat(snapshots)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("reports a file and directory name clash as an input error", async () => {
  const clash = filesystemError("ENOTDIR");

  const failure = await snapshotWithFault({ mkdir: clash });

  expect(failure).toBeInstanceOf(AnalysisInputError);
  expect((failure as AnalysisInputError).issues).toEqual([
    expect.objectContaining({ path: ["additional_paths"] }),
  ]);
  expect((failure as AnalysisInputError).cause).toBe(clash);
});

it("keeps an unrelated snapshot write failure unchanged", async () => {
  const fullDisk = filesystemError("ENOSPC");

  await expect(snapshotWithFault({ writeFile: fullDisk })).resolves.toBe(
    fullDisk,
  );
});
