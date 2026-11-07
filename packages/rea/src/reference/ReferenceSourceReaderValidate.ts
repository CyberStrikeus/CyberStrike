import type { BigIntStats } from "node:fs";
import { constants } from "node:fs";
import { lstat, realpath } from "node:fs/promises";

import { err, ok } from "../domain/result.js";
import {
  cancelled,
  failure,
  filesystemFailureDetail,
  rootFilesystemFailure,
} from "./ReferenceSourceReaderErrors.js";
import { isPathWithinRoot } from "../domain/localPath.js";
import type {
  ReferenceSourceFailureCode,
  ReferenceSourceResult,
} from "./ReferenceSourceReaderTypes.js";

export const bigLstat = (path: string): Promise<BigIntStats> =>
  lstat(path, { bigint: true });

export const sameFile = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

export const isAborted = (signal?: AbortSignal): boolean =>
  signal?.aborted === true;

export const noFollowOpenSupported = (): boolean =>
  Number.isSafeInteger(constants.O_NOFOLLOW) && constants.O_NOFOLLOW !== 0;

export const validateDirectory = async (
  root: string,
  rootIdentity: BigIntStats,
  path: string,
  signal?: AbortSignal,
): Promise<
  | { readonly ok: true; readonly stats: BigIntStats }
  | {
      readonly ok: false;
      readonly code: ReferenceSourceFailureCode;
      readonly message: string;
      readonly localDiagnostic?: string;
    }
> => {
  try {
    const rootNow = await bigLstat(root);
    if (!sameFile(rootIdentity, rootNow))
      return { ok: false, code: "changed", message: "Reference root changed" };
    const stats = await bigLstat(path);
    if (stats.isSymbolicLink())
      return {
        ok: false,
        code: "symlink",
        message: "Symbolic links are not followed",
      };
    if (!stats.isDirectory())
      return {
        ok: false,
        code: "changed",
        message: "Directory identity changed",
      };
    const canonical = await realpath(path);
    if (canonical !== path || !isPathWithinRoot(root, canonical))
      return {
        ok: false,
        code: "changed",
        message: "Directory escaped the reference root",
      };
    return { ok: true, stats };
  } catch (cause: unknown) {
    if (isAborted(signal))
      return {
        ok: false,
        code: "cancelled",
        message: "Reference source traversal cancelled",
      };
    const detail = filesystemFailureDetail(
      cause,
      "Directory identity could not be verified",
    );
    if (detail === undefined) throw cause;
    return {
      ok: false,
      code: "io",
      ...detail,
    };
  }
};

export const prepareRoot = async (
  root: string,
  signal?: AbortSignal,
): Promise<
  ReferenceSourceResult<{
    readonly canonicalRoot: string;
    readonly rootIdentity: BigIntStats;
  }>
> => {
  if (isAborted(signal)) return err(cancelled());
  try {
    const metadata = await bigLstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return err(
        failure(
          "invalid-root",
          `Reference source root is not a directory: ${root}`,
        ),
      );
    const canonicalRoot = await realpath(root);
    if (isAborted(signal)) return err(cancelled());
    const canonicalMetadata = await bigLstat(canonicalRoot);
    if (!sameFile(metadata, canonicalMetadata))
      return err(
        failure(
          "invalid-root",
          `Reference source root changed during resolution: ${root}`,
        ),
      );
    return ok({ canonicalRoot, rootIdentity: canonicalMetadata });
  } catch (cause: unknown) {
    if (isAborted(signal)) return err(cancelled());
    const rootFailure = rootFilesystemFailure(
      cause,
      "Reference source root could not be resolved",
    );
    if (rootFailure === undefined) throw cause;
    return err({
      ...failure(rootFailure.code, `${rootFailure.message}: ${root}`),
      ...(rootFailure.remediationAction === undefined
        ? {}
        : { remediationAction: rootFailure.remediationAction }),
      cause,
    });
  }
};
