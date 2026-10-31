import { constants } from "node:fs";
import { chmod, copyFile, symlink } from "node:fs/promises";

/** A controlled Node child announces readiness and expires even if its PID is never received. */
export const retainedRuntimeNodeCode = (displayName?: string): string =>
  `${displayName === undefined ? "" : `process.title = ${JSON.stringify(displayName)}; `}setTimeout(() => process.exit(0), 30_000); process.send('ready');`;

/** Give the fixture a distinct executable identity without relying on host multicall utilities. */
export const prepareRenamedNodeLauncher = async (
  launcher: string,
  alternate: string,
): Promise<void> => {
  await copyFile(process.execPath, launcher, constants.COPYFILE_FICLONE);
  await chmod(launcher, 0o700);
  await symlink(launcher, alternate);
};
