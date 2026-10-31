import { chmodSync, lstatSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import {
  preserveCurrentRecoveryBackup,
  type RecoveryBackupPreservationFailure,
} from "../application/SetupRecoveryBackup.js";
import { err, ok, type Result } from "../domain/result.js";

const errorDetail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isMissing = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ENOENT";

const restrictExistingBackup = (
  backupPath: string,
): Result<void, RecoveryBackupPreservationFailure> => {
  let existing: ReturnType<typeof lstatSync>;
  try {
    existing = lstatSync(backupPath);
  } catch (cause: unknown) {
    if (isMissing(cause)) return ok(undefined);
    return err({
      kind: "unreadable",
      path: backupPath,
      detail: `The existing Amp settings backup could not be checked: ${errorDetail(cause)}`,
    });
  }
  if (!existing.isFile())
    return err({
      kind: "occupied",
      path: backupPath,
      detail: "The existing Amp settings backup is not a regular file.",
    });
  try {
    chmodSync(backupPath, 0o600);
  } catch (cause: unknown) {
    return err({
      kind: "unreadable",
      path: backupPath,
      detail: `The existing Amp settings backup permissions could not be secured: ${errorDetail(cause)}`,
    });
  }
  return ok(undefined);
};

const copyPrivateBackup = async (
  sourcePath: string,
  backupPath: string,
): Promise<void> => {
  await writeFile(backupPath, await readFile(sourcePath), {
    flag: "wx",
    mode: 0o600,
  });
};

export const writeAmpRegistrationBackup = async (
  settingsPath: string,
  settingsText: string,
): Promise<Result<string, RecoveryBackupPreservationFailure>> => {
  const firstBackupPath = `${settingsPath}.rea.backup`;
  const firstRestricted = restrictExistingBackup(firstBackupPath);
  if (!firstRestricted.ok) return firstRestricted;
  const preserved = await preserveCurrentRecoveryBackup(
    firstBackupPath,
    settingsPath,
    settingsText,
    { copy: copyPrivateBackup },
  );
  if (!preserved.ok) return preserved;
  const selectedRestricted = restrictExistingBackup(preserved.value);
  if (!selectedRestricted.ok) return selectedRestricted;
  return ok(preserved.value);
};
