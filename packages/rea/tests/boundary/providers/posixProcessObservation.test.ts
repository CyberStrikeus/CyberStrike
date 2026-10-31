import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { observePosixProcess } from "../../support/process/observePosixProcess.js";

it.skipIf(process.platform === "win32")(
  "distinguishes absent, zombie, running, and unknown ps observations",
  async () => {
    const directory = await createTestTempDirectory("rea-posix-process-state-");
    const checker = join(directory, "ps");
    const previousPath = process.env.PATH;
    const setChecker = async (body: string): Promise<void> => {
      await writeFile(checker, `#!/bin/sh\n${body}\n`);
      await chmod(checker, 0o700);
      process.env.PATH = directory;
    };

    try {
      await setChecker("printf 'S\\n'");
      await expect(observePosixProcess(123)).resolves.toEqual({
        kind: "running",
        state: "S",
      });

      await setChecker("printf 'Z+\\n'");
      await expect(observePosixProcess(123)).resolves.toEqual({
        kind: "zombie",
        state: "Z+",
      });

      await setChecker(":");
      await expect(observePosixProcess(123)).resolves.toEqual({
        kind: "absent",
      });

      await setChecker("exit 1");
      await expect(observePosixProcess(123)).resolves.toEqual({
        kind: "absent",
      });

      await setChecker("printf 'checker failed\\n' >&2");
      await expect(observePosixProcess(123)).rejects.toThrow(
        "Process observation emitted diagnostics",
      );

      await setChecker("printf '  \\n' >&2; exit 1");
      await expect(observePosixProcess(123)).rejects.toMatchObject({
        code: 1,
      });

      await setChecker("printf 'permission denied\\n' >&2; exit 1");
      await expect(observePosixProcess(123)).rejects.toMatchObject({
        code: 1,
      });

      await setChecker("printf 'S\\n'; exit 1");
      await expect(observePosixProcess(123)).rejects.toMatchObject({
        code: 1,
      });

      await setChecker("printf 'checker failed\\n' >&2; exit 2");
      await expect(observePosixProcess(123)).rejects.toMatchObject({
        code: 2,
      });

      process.env.PATH = directory;
      await rm(checker);
      await expect(observePosixProcess(123)).rejects.toMatchObject({
        code: "ENOENT",
      });

      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await expect(observePosixProcess(process.pid)).resolves.toMatchObject({
        kind: "running",
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  },
);
