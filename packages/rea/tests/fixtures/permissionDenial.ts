import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "vitest";

import { createTestTempDirectory } from "./temporaryDirectory.js";

type PermissionOperation =
  | "file-read"
  | "directory-read"
  | "directory-write"
  | "directory-search";

/** Probe actual DAC enforcement; UID alone does not account for Linux capabilities. */
export const requirePermissionDenial = async (
  context: Pick<TestContext, "skip">,
  operation: PermissionOperation,
): Promise<void> => {
  if (process.platform === "win32")
    context.skip("POSIX mode denial is unavailable on Windows");
  const root = await createTestTempDirectory("rea-permission-probe-");
  const directory = join(root, "directory");
  const file = join(directory, "file");
  await mkdir(directory);
  await writeFile(file, "probe");
  let denied = false;
  try {
    if (operation === "file-read") {
      await chmod(file, 0);
      await readFile(file);
    } else if (operation === "directory-read") {
      await chmod(directory, 0o333);
      await readdir(directory);
    } else if (operation === "directory-write") {
      await chmod(directory, 0o500);
      await writeFile(join(directory, "created"), "probe");
    } else {
      await chmod(directory, 0o444);
      await stat(file);
    }
  } catch (cause) {
    if (
      !(cause instanceof Error) ||
      !("code" in cause) ||
      cause.code !== "EACCES"
    )
      throw cause;
    denied = true;
  } finally {
    await chmod(directory, 0o700);
    await chmod(file, 0o600);
  }
  if (!denied)
    context.skip(
      `Host bypasses POSIX ${operation} denial; real permission coverage is unverified`,
    );
};
