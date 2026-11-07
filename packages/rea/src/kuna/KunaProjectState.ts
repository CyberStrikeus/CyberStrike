import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  assertRegularFileActive,
  RegularFileChangedError,
  sameRegularFileState,
  type RegularFileState,
} from "../filesystem/RegularFile.js";
import type { KunaExportFiles } from "./KunaProjectExport.js";

/** Verified local states accompany digests in memory, never in the persisted manifest. */
export type KunaProjectFileStates = Readonly<
  Record<keyof KunaExportFiles, RegularFileState>
>;

export const assertKunaFileState = async (
  path: string,
  expected: RegularFileState,
  signal?: AbortSignal,
): Promise<void> => {
  assertRegularFileActive(signal);
  if (!sameRegularFileState(expected, await stat(path)))
    throw new RegularFileChangedError(path);
  assertRegularFileActive(signal);
};

export const assertKunaProjectState = async (
  directory: string,
  files: KunaExportFiles,
  states: KunaProjectFileStates,
  signal?: AbortSignal,
): Promise<void> => {
  for (const role of Object.keys(files) as (keyof KunaExportFiles)[])
    await assertKunaFileState(
      join(directory, files[role].path),
      states[role],
      signal,
    );
};
