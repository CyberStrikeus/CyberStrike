import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, it } from "vitest";

import {
  AnalysisAccessDeniedError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  resolveExecutable,
  resolveProcessScenarioRuntimePaths,
} from "./ProcessScenarioRuntimeValidation.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "resolves a literal backslash in a POSIX executable basename through PATH",
  async () => {
    const root = await createTestTempDirectory("rea-process-posix-basename-");
    const bin = join(root, "bin");
    await mkdir(bin);
    const command = "selected\\node";
    const selected = join(bin, command);
    await symlink(process.execPath, selected);
    await expect(resolveExecutable(command, root, bin)).resolves.toBe(selected);
    const resolved = await resolveProcessScenarioRuntimePaths(
      processScenarioSchema.parse({
        executable: command,
        working_directory: root,
        environment: { PATH: bin },
      }),
    );
    expect(resolved.executable).toBe(selected);
  },
);

it.skipIf(process.platform === "win32")(
  "preserves the caller-selected executable symlink for process invocation",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-process-executable-alias-"));
    try {
      const alias = join(root, "chosen-node");
      await symlink(process.execPath, alias);

      await expect(resolveExecutable(alias, root, "")).resolves.toBe(alias);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("resolves a Windows executable through the canonical PATH spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-process-path-"));
  try {
    const selected = join(root, "selected");
    const ambient = join(root, "ambient");
    await mkdir(selected);
    await mkdir(ambient);
    await writeFile(join(selected, "tool.exe"), "");
    await chmod(join(selected, "tool.exe"), 0o644);
    const scenario = processScenarioSchema.parse({
      executable: "tool.exe",
      working_directory: root,
      environment: { Path: selected },
    });
    const candidate = join(selected, "tool.exe");
    try {
      const resolved = await resolveProcessScenarioRuntimePaths(
        scenario,
        { PATH: ambient },
        "win32",
      );
      expect(resolved.executable).toBe(candidate);
    } catch (cause: unknown) {
      const message =
        cause instanceof AnalysisInputError
          ? (cause.issues[0]?.message ?? cause.message)
          : cause instanceof Error
            ? cause.message
            : String(cause);
      expect(message).toContain(candidate);
      expect(message).not.toContain(ambient);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reports a working-directory file as invalid input", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-process-invalid-cwd-"));
  const selectedFile = join(root, "selected-file");
  await writeFile(selectedFile, "not a directory");
  try {
    const failure = await runtimePathFailure({
      executable: process.execPath,
      working_directory: selectedFile,
    });
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_process_scenario",
        issues: [
          {
            path: ["working_directory"],
            reason: "invalid_value",
            message: `working directory is not a directory: ${selectedFile}`,
          },
        ],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "preserves the caller-selected working-directory symlink when pointing to a regular file",
  async () => {
    const root = await createTestTempDirectory("rea-process-cwd-symlink-");
    const targetFile = join(root, "target-file");
    const aliasFile = join(root, "alias-file");
    await writeFile(targetFile, "not a directory");
    await symlink(targetFile, aliasFile);
    const failure = await runtimePathFailure({
      executable: process.execPath,
      working_directory: aliasFile,
    });
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_process_scenario",
        issues: [
          {
            path: ["working_directory"],
            reason: "invalid_value",
            message: `working directory is not a directory: ${aliasFile}`,
          },
        ],
      },
    });
  },
);

it("reports an executable directory as invalid input", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "rea-process-executable-directory-"),
  );
  const directory = join(root, "tool-directory");
  try {
    await mkdir(directory);
    const directoryFailure = await runtimePathFailure({
      executable: directory,
      working_directory: root,
    });
    expect(projectAnalysisError(directoryFailure)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["executable"],
            message: `executable could not be resolved: ${directory}; checked ${directory} (not a regular file)`,
          },
        ],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "reports a non-executable regular file as invalid input",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-process-non-executable-"));
    const selected = join(root, "not-executable");
    try {
      await writeFile(selected, "not executable");
      await chmod(selected, 0o644);
      const failure = await runtimePathFailure({
        executable: selected,
        working_directory: root,
      });
      expect(projectAnalysisError(failure)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["executable"],
              message: `executable could not be resolved: ${selected}; checked ${selected} (EACCES)`,
            },
          ],
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

const SKIP_PERMISSIONS =
  process.platform === "win32" || process.getuid?.() === 0;

/** Remove search permission from `directory` for the duration of `run`. */
const withoutSearchPermission = async <T>(
  directory: string,
  run: () => Promise<T>,
): Promise<T> => {
  await chmod(directory, 0o000);
  try {
    return await run();
  } finally {
    await chmod(directory, 0o700);
  }
};

const deniedFixture = async () => {
  const root = await createTestTempDirectory("rea-process-denied-");
  const denied = join(root, "denied");
  await mkdir(join(denied, "cwd"), { recursive: true });
  const tool = join(denied, "tool");
  await writeFile(tool, "#!/bin/sh\n", { mode: 0o755 });
  return { root, denied, tool };
};

const runtimePathOutcome = async (scenario: unknown): Promise<unknown> => {
  try {
    return await resolveProcessScenarioRuntimePaths(
      processScenarioSchema.parse(scenario),
    );
  } catch (cause: unknown) {
    return cause;
  }
};

it.skipIf(SKIP_PERMISSIONS)(
  "reports a search-denied working directory as host access denial",
  async () => {
    const { denied } = await deniedFixture();
    const selected = join(denied, "cwd");
    const failure = await withoutSearchPermission(denied, () =>
      runtimePathOutcome({
        executable: process.execPath,
        working_directory: selected,
      }),
    );
    expect(failure).toBeInstanceOf(AnalysisAccessDeniedError);
    if (!(failure instanceof AnalysisAccessDeniedError)) return;
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "access_denied",
      details: {
        operation: "capture_process_scenario",
        path: selected,
        system_code: "EACCES",
        boundary: "filesystem-read",
      },
    });
  },
);

it.skipIf(SKIP_PERMISSIONS)(
  "reports a search-denied explicit executable as host access denial",
  async () => {
    const { root, denied, tool } = await deniedFixture();
    const failure = await withoutSearchPermission(denied, () =>
      runtimePathOutcome({
        executable: "denied/tool",
        working_directory: root,
      }),
    );
    expect(failure).toBeInstanceOf(AnalysisAccessDeniedError);
    if (!(failure instanceof AnalysisAccessDeniedError)) return;
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "access_denied",
      details: { path: tool, system_code: "EACCES" },
    });
  },
);

it.skipIf(SKIP_PERMISSIONS)(
  "continues a PATH search past a search-denied directory",
  async () => {
    const { root, denied } = await deniedFixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    const tool = join(bin, "tool");
    await writeFile(tool, "#!/bin/sh\n", { mode: 0o755 });
    await withoutSearchPermission(denied, async () => {
      await expect(
        resolveExecutable("tool", root, [denied, bin].join(delimiter)),
      ).resolves.toBe(tool);
      const failure = await runtimePathOutcome({
        executable: "tool",
        working_directory: root,
        environment: { PATH: denied },
      });
      expect(failure).toBeInstanceOf(AnalysisInputError);
      if (!(failure instanceof AnalysisInputError)) return;
      expect(projectAnalysisError(failure)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["executable"],
              message: `executable could not be resolved: tool; checked ${join(denied, "tool")} (EACCES)`,
            },
          ],
        },
      });
    });
  },
);

const runtimePathFailure = async (
  scenario: unknown,
): Promise<AnalysisInputError> => {
  let failure: unknown;
  try {
    await resolveProcessScenarioRuntimePaths(
      processScenarioSchema.parse(scenario),
    );
  } catch (cause: unknown) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(AnalysisInputError);
  if (!(failure instanceof AnalysisInputError))
    throw new Error("Selected runtime path should be invalid input");
  return failure;
};

it.skipIf(process.platform === "win32").each(["absolute", "relative", "PATH"])(
  "preserves native symlink/.. traversal for a %s executable",
  async (selection) => {
    const root = await createTestTempDirectory("rea-process-native-path-");
    const intended = join(root, "intended");
    await mkdir(join(intended, "nested"), { recursive: true });
    await symlink(join(intended, "nested"), join(root, "alias"));
    for (const [directory, text] of [
      [root, "decoy"],
      [intended, "intended"],
    ] as const)
      await writeFile(
        join(directory, "probe"),
        `#!/bin/sh\nprintf '${text}'\n`,
        { mode: 0o755 },
      );
    const command =
      selection === "absolute"
        ? `${root}/alias/../probe`
        : selection === "relative"
          ? "alias/../probe"
          : "probe";
    const executable = await resolveExecutable(command, root, "alias/..");
    expect(await realpath(executable)).toBe(join(intended, "probe"));
    expect(execFileSync(executable, { encoding: "utf8", timeout: 2000 })).toBe(
      "intended",
    );
  },
);

it.skipIf(process.platform === "win32")(
  "distinguishes an unset PATH from empty and relative PATH selections",
  async () => {
    const root = await createTestTempDirectory("rea-process-absent-path-");
    const localShell = join(root, "sh");
    await writeFile(localShell, "#!/bin/sh\nprintf local-shell\n", {
      mode: 0o755,
    });
    const scenario = processScenarioSchema.parse({
      executable: "sh",
      working_directory: root,
    });
    const unset = await resolveProcessScenarioRuntimePaths(scenario, {});
    expect(unset.executable).not.toBe(localShell);
    expect(
      execFileSync(unset.executable, ["-c", "printf system-shell"], {
        env: {},
        encoding: "utf8",
        timeout: 2000,
      }),
    ).toBe("system-shell");
    for (const environment of [{ PATH: "" }, { PATH: "." }]) {
      const selected = await resolveProcessScenarioRuntimePaths(
        { ...scenario, environment },
        { PATH: "/usr/bin:/bin" },
      );
      expect(selected.executable).toBe(localShell);
    }
    const inheritedEmpty = await resolveProcessScenarioRuntimePaths(scenario, {
      PATH: "",
    });
    expect(inheritedEmpty.executable).toBe(localShell);
    await rm(localShell);
    await expect(
      resolveProcessScenarioRuntimePaths(
        { ...scenario, environment: { PATH: "" } },
        {},
      ),
    ).rejects.toBeInstanceOf(AnalysisInputError);
  },
);
