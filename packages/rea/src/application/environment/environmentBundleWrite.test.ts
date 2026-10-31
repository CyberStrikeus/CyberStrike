import { requirePermissionDenial } from "../../../tests/fixtures/permissionDenial.js";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  environmentServeSource,
  writeEnvironmentServeFiles,
} from "../../../tests/fixtures/environmentServe.js";
import { SafeOutputTree } from "../../artifacts/SafeOutputTree.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import {
  exportEnvironmentBundle,
  readEnvironmentExportInputs,
} from "./environmentExport.js";

it("retains the admitted tarball descriptor and refuses a pathname replacement during output", async () => {
  const root = await createTestTempDirectory("rea-tarball-instance-");
  const files = await writeEnvironmentServeFiles(root);
  const inputs = await readEnvironmentExportInputs(
    files.manifestPath,
    files.capturePath,
  );
  if (!inputs.ok) throw inputs.error;
  const tarball = join(root, "package.tgz");
  const originalBytes = Buffer.from("original admitted package");
  await writeFile(tarball, originalBytes);
  const directory = join(root, "bundle");
  const original = SafeOutputTree.prototype.write;
  let replaced = false;
  const writer = vi
    .spyOn(SafeOutputTree.prototype, "write")
    .mockImplementation(async function (
      this: SafeOutputTree,
      ...args: Parameters<SafeOutputTree["write"]>
    ) {
      const result = await original.apply(this, args);
      if (!replaced) {
        replaced = true;
        await rename(tarball, join(root, "admitted.tgz"));
        await writeFile(tarball, "replacement package");
      }
      return result;
    });
  try {
    const result = await exportEnvironmentBundle({
      ...inputs.value,
      source: environmentServeSource(),
      directory,
      packageTarball: tarball,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError", path: tarball },
    });
    expect(
      Buffer.compare(
        await readFile(join(directory, "envs/grafana-example/rea-agents.tgz")),
        originalBytes,
      ),
    ).toBe(0);
  } finally {
    writer.mockRestore();
  }
});

it("keeps tarball ownership when the admitted inode grows during output", async () => {
  const root = await createTestTempDirectory("rea-tarball-growth-");
  const files = await writeEnvironmentServeFiles(root);
  const inputs = await readEnvironmentExportInputs(
    files.manifestPath,
    files.capturePath,
  );
  if (!inputs.ok) throw inputs.error;
  const tarball = join(root, "package.tgz");
  await writeFile(tarball, Buffer.alloc(2 * 1024 * 1024, 0x41));
  const directory = join(root, "bundle");
  const original = SafeOutputTree.prototype.write;
  let grown = false;
  const writer = vi
    .spyOn(SafeOutputTree.prototype, "write")
    .mockImplementation(async function (
      this: SafeOutputTree,
      ...args: Parameters<SafeOutputTree["write"]>
    ) {
      const [relative] = args;
      if (!grown && relative === "envs/grafana-example/rea-agents.tgz") {
        grown = true;
        await appendFile(tarball, Buffer.alloc(1024 * 1024, 0x42));
      }
      return original.apply(this, args);
    });
  try {
    const result = await exportEnvironmentBundle({
      ...inputs.value,
      source: environmentServeSource(),
      directory,
      packageTarball: tarball,
    });
    expect(grown).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisOutputError",
        operation: "environment-export",
        reason:
          "Extracted content exceeds the inventoried size: envs/grafana-example/rea-agents.tgz",
      },
    });
    if (result.ok)
      throw new Error("Expected the changed tarball to be refused");
    expect(result.error.cleanup).toBeUndefined();
    expect(result.error.message).not.toContain("invalidated");
  } finally {
    writer.mockRestore();
  }
});

it("uses confirmed publication after the output owner's descriptor cleanup completes", async () => {
  const root = await createTestTempDirectory("rea-bundle-published-");
  const files = await writeEnvironmentServeFiles(root);
  const inputs = await readEnvironmentExportInputs(
    files.manifestPath,
    files.capturePath,
  );
  if (!inputs.ok) throw inputs.error;
  const directory = join(root, "bundle");
  const original = SafeOutputTree.prototype.commit;
  const commit = vi
    .spyOn(SafeOutputTree.prototype, "commit")
    .mockImplementation(async function (this: SafeOutputTree, ...args) {
      await original.apply(this, args);
      throw new ArtifactReaderFailure(
        "unavailable",
        "controlled post-publication close failure",
        {
          cleanup: {
            reason: "controlled directory close failure",
            resources: [directory],
          },
        },
      );
    });
  try {
    const result = await exportEnvironmentBundle({
      ...inputs.value,
      source: environmentServeSource(),
      directory,
    });
    expect(result).toMatchObject({ ok: true, value: { status: "exported" } });
    expect(
      Buffer.compare(
        await readFile(join(directory, "envs/grafana-example/evidence.json")),
        inputs.value.evidence.bytes,
      ),
    ).toBe(0);
  } finally {
    commit.mockRestore();
  }
});

it.skipIf(process.platform === "win32")(
  "returns a tagged permission refusal for an existing read-only empty directory",
  async (context) => {
    await requirePermissionDenial(context, "directory-write");
    const root = await createTestTempDirectory("rea-bundle-readonly-");
    const files = await writeEnvironmentServeFiles(root);
    const inputs = await readEnvironmentExportInputs(
      files.manifestPath,
      files.capturePath,
    );
    if (!inputs.ok) throw inputs.error;
    const directory = join(root, "bundle");
    await mkdir(directory, { mode: 0o500 });
    try {
      const result = await exportEnvironmentBundle({
        ...inputs.value,
        source: environmentServeSource(),
        directory,
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          operation: "environment-export",
          diagnostics: {
            output_directory: directory,
            path: join(directory, "README.md"),
            system_code: "EACCES",
            boundary: "filesystem-write",
          },
        },
      });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await chmod(directory, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "names the nested path when write permission is lost after earlier files",
  async (context) => {
    await requirePermissionDenial(context, "directory-write");
    const root = await createTestTempDirectory("rea-bundle-later-denied-");
    const files = await writeEnvironmentServeFiles(root);
    const inputs = await readEnvironmentExportInputs(
      files.manifestPath,
      files.capturePath,
    );
    if (!inputs.ok) throw inputs.error;
    const directory = join(root, "bundle");
    const original = SafeOutputTree.prototype.write;
    let writes = 0;
    // The real host refuses the second file once the directory is read-only.
    const writer = vi
      .spyOn(SafeOutputTree.prototype, "write")
      .mockImplementation(async function (this: SafeOutputTree, ...args) {
        writes += 1;
        if (writes === 2) await chmod(directory, 0o500);
        return original.apply(this, args);
      });
    try {
      const result = await exportEnvironmentBundle({
        ...inputs.value,
        source: environmentServeSource(),
        directory,
      });
      if (result.ok) throw new Error("expected a permission refusal");
      expect(result.error).toMatchObject({
        _tag: "AnalysisOutputError",
        diagnostics: { output_directory: directory },
      });
      if (!(result.error instanceof AnalysisOutputError)) throw result.error;
      expect(result.error.diagnostics).toMatchObject({
        path: expect.stringContaining(`${directory}/`),
        system_code: "EACCES",
        boundary: "filesystem-write",
      });
      expect(await readdir(directory)).not.toEqual([]);
    } finally {
      writer.mockRestore();
      await chmod(directory, 0o700);
    }
  },
);

it.each([
  {
    failure: "pathless descriptor failure",
    // A disk-full `FileHandle.write()` reports a code and syscall, no path.
    error: () =>
      Object.assign(new Error("ENOSPC: no space left on device, write"), {
        code: "ENOSPC",
        syscall: "write",
      }),
  },
  {
    failure: "integrity refusal",
    error: () =>
      new ArtifactReaderFailure(
        "integrity",
        "Extracted content disagrees with inventory",
      ),
  },
] as const)(
  "reports a later $failure with its own recovery",
  async ({ failure, error }) => {
    const root = await createTestTempDirectory("rea-bundle-later-failure-");
    const files = await writeEnvironmentServeFiles(root);
    const inputs = await readEnvironmentExportInputs(
      files.manifestPath,
      files.capturePath,
    );
    if (!inputs.ok) throw inputs.error;
    const directory = join(root, "bundle");
    const original = SafeOutputTree.prototype.write;
    const targets: string[] = [];
    const writer = vi
      .spyOn(SafeOutputTree.prototype, "write")
      .mockImplementation(async function (this: SafeOutputTree, ...args) {
        targets.push(args[0]);
        if (targets.length === 2) throw error();
        return original.apply(this, args);
      });
    try {
      const result = await exportEnvironmentBundle({
        ...inputs.value,
        source: environmentServeSource(),
        directory,
      });
      if (result.ok || !(result.error instanceof AnalysisOutputError))
        throw new Error("expected an output failure");
      expect(result.error.diagnostics).toEqual({
        output_directory: directory,
      });
      if (failure === "pathless descriptor failure") {
        expect(result.error.reason).toContain(
          join(directory, targets[1] ?? ""),
        );
        expect(result.error.remediationAction).toContain("free disk space");
      } else expect(result.error.remediationAction).toBeUndefined();
      expect(await readdir(directory)).not.toEqual([]);
    } finally {
      writer.mockRestore();
    }
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["replace-root", "foreign-entry", "symlink-parent"] as const)(
  "refuses publication after an actual output transition: %s",
  async (transition) => {
    const root = await createTestTempDirectory("rea-bundle-output-transition-");
    const files = await writeEnvironmentServeFiles(root);
    const inputs = await readEnvironmentExportInputs(
      files.manifestPath,
      files.capturePath,
    );
    if (!inputs.ok) throw inputs.error;
    const directory = join(root, "bundle");
    const foreign = join(root, "foreign");
    await mkdir(foreign);
    const original = SafeOutputTree.prototype.write;
    let changed = false;
    const writer = vi
      .spyOn(SafeOutputTree.prototype, "write")
      .mockImplementation(async function (
        this: SafeOutputTree,
        ...args: Parameters<SafeOutputTree["write"]>
      ) {
        const result = await original.apply(this, args);
        if (!changed) {
          changed = true;
          if (transition === "replace-root") {
            await rename(directory, join(root, "moved"));
            await mkdir(directory);
            await writeFile(join(directory, "foreign.txt"), "keep");
          } else if (transition === "foreign-entry") {
            await writeFile(join(directory, "foreign.txt"), "keep");
          } else {
            await symlink(foreign, join(directory, "envs"), "dir");
          }
        }
        return result;
      });
    try {
      const result = await exportEnvironmentBundle({
        ...inputs.value,
        source: environmentServeSource(),
        directory,
      });
      expect(changed).toBe(true);
      expect(result).toMatchObject({
        ok: false,
        error: { operation: "environment-export" },
      });
      expect(await readdir(foreign)).toEqual([]);
      if (transition !== "symlink-parent")
        expect(await readFile(join(directory, "foreign.txt"), "utf8")).toBe(
          "keep",
        );
    } finally {
      writer.mockRestore();
    }
  },
);
