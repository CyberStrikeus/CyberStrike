import fs from "node:fs";
import { join } from "node:path";
import { locateReferenceSourceGitDirectory } from "./ReferenceSourceGitDirectory.js";
import { err, ok, type Result } from "../domain/result.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { readRegularFile, retryRegularFileCleanup } from "./RegularFileRead.js";
import { referenceSourceResourceFailure } from "../reference/ReferenceSourceReaderErrors.js";
import type { ReferenceSourceReaderError } from "../reference/ReferenceSourceReaderTypes.js";

export type ReferenceSourceVcsInfo =
  | {
      readonly kind: "git";
      readonly head: string;
      readonly dirty: boolean | null;
    }
  | { readonly kind: "none"; readonly head: null; readonly dirty: null }
  | { readonly kind: "unknown"; readonly head: null; readonly dirty: null };

/**
 * Read Git metadata for a directory using isomorphic-git.
 *
 * No git subprocess or network is used; only the local `.git` object store is read.
 */
export const readReferenceSourceVcs = async (
  root: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<ReferenceSourceVcsInfo, ReferenceSourceReaderError>> => {
  try {
    return await resources.run(async () => {
      try {
        return ok(await resolveSourceVcs(root, resources, signal));
      } catch (cause: unknown) {
        if (cause instanceof ArtifactReaderFailure) throw cause;
        return ok(unknownVcs());
      }
    });
  } catch (cause: unknown) {
    if (!(cause instanceof ArtifactReaderFailure)) throw cause;
    return err(referenceSourceResourceFailure(cause));
  }
};

const unknownVcs = (): ReferenceSourceVcsInfo => ({
  kind: "unknown",
  head: null,
  dirty: null,
});

const resolveSourceVcs = async (
  root: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<ReferenceSourceVcsInfo> => {
  // isomorphic-git is loaded on first use so CLI and MCP startup skip it.
  const { resolveRef } = await import("isomorphic-git");
  let failedRead: { readonly cause: unknown } | undefined;
  const cleanupFailures: ArtifactReaderFailure[] = [];
  const readMetadataBytes = async (path: string): Promise<Buffer> => {
    try {
      return await readRegularFile(path, { signal });
    } catch (cause: unknown) {
      if (signal?.aborted === true && cause === signal.reason) throw cause;
      if (!(cause instanceof RegularFileCleanupFailure)) throw cause;
      const retry = await retryRegularFileCleanup(cause, resources, signal);
      if (
        retry.outcome.kind === "failed" &&
        errorCode(retry.outcome.cause) !== "ENOENT"
      )
        failedRead ??= { cause: retry.outcome.cause };
      if (
        retry.cleanup === undefined &&
        retry.outcome.kind === "failed" &&
        !isAborted(signal)
      )
        throw retry.outcome.cause;
      const primary =
        retry.outcome.kind === "failed"
          ? retry.outcome.cause
          : cause.cleanupCause;
      throw new ArtifactReaderFailure(
        isAborted(signal) ? "cancelled" : "io",
        `Git metadata could not be read safely: ${errorMessage(primary)}`,
        {
          cause: primary,
          ...(retry.cleanup === undefined ? {} : { cleanup: retry.cleanup }),
        },
      );
    }
  };
  const readMetadataText = async (path: string): Promise<string> =>
    (await readMetadataBytes(path)).toString("utf8");
  const throwCleanupFailures = (primary: unknown): never => {
    const observations = cleanupFailures.flatMap((failure) =>
      failure.cleanup === undefined ? [] : [failure.cleanup],
    );
    throw new ArtifactReaderFailure(
      isAborted(signal) ? "cancelled" : "io",
      `Git metadata could not be read safely: ${errorMessage(primary)}`,
      {
        cause: new AggregateError(
          [primary, ...cleanupFailures],
          "Git metadata reads and cleanup failed",
          { cause: primary },
        ),
        ...(observations.length === 0
          ? {}
          : {
              cleanup: {
                reason: observations.map(({ reason }) => reason).join("; "),
                resources: [
                  ...new Set(
                    observations.flatMap(({ resources }) => resources),
                  ),
                ],
              },
            }),
      },
    );
  };
  const referenceFs = {
    ...fs,
    promises: {
      ...fs.promises,
      // Let isomorphic-git continue from a failed loose ref to packed-refs,
      // then report the original read failure after resolution. This preserves
      // both observations when packed metadata also fails cleanup.
      readFile: async (
        path: string | undefined,
        options:
          | BufferEncoding
          | { readonly encoding?: BufferEncoding | null }
          | null = null,
      ) => {
        // The library probes readFile() without a path to detect promise APIs.
        // Reject that invocation without attributing it to a source read.
        if (path === undefined)
          throw new TypeError("Git metadata path is required");
        try {
          const bytes = await readMetadataBytes(path);
          const encoding =
            typeof options === "string"
              ? options
              : typeof options === "object" &&
                  options !== null &&
                  "encoding" in options
                ? options.encoding
                : undefined;
          if (encoding === undefined || encoding === null) return bytes;
          if (typeof encoding !== "string" || !Buffer.isEncoding(encoding))
            throw new TypeError("Unsupported Git metadata text encoding");
          return bytes.toString(encoding);
        } catch (cause: unknown) {
          if (cause instanceof ArtifactReaderFailure) {
            cleanupFailures.push(cause);
          } else if (errorCode(cause) !== "ENOENT") failedRead ??= { cause };
          throw cause;
        }
      },
    },
  };
  const readRef = async (options: {
    readonly gitdir?: string;
    readonly ref: string;
  }) => {
    let head: string;
    try {
      head = await resolveRef({ fs: referenceFs, dir: root, ...options });
    } catch (cause: unknown) {
      if (cleanupFailures.length > 0)
        throwCleanupFailures(failedRead?.cause ?? cause);
      if (failedRead !== undefined) throw failedRead.cause;
      throw cause;
    }
    if (cleanupFailures.length > 0)
      throwCleanupFailures(failedRead?.cause ?? cleanupFailures[0]?.cause);
    signal?.throwIfAborted();
    if (failedRead !== undefined) throw failedRead.cause;
    return head;
  };
  const locations = await locateReferenceSourceGitDirectory(
    root,
    readMetadataText,
    signal,
  );
  if (locations === undefined) return { kind: "none", head: null, dirty: null };
  const { gitDirectory, commonDirectory } = locations;
  if (gitDirectory === commonDirectory) {
    const head = await readRef({ gitdir: gitDirectory, ref: "HEAD" });
    return isAborted(signal)
      ? unknownVcs()
      : { kind: "git", head, dirty: null };
  }
  const headText = (await readMetadataText(join(gitDirectory, "HEAD"))).trim();
  const ref = headText.startsWith("ref: ") ? headText.slice(5) : "HEAD";
  const privateRef =
    ref === "HEAD" ||
    ["refs/bisect/", "refs/rewritten/", "refs/worktree/"].some((prefix) =>
      ref.startsWith(prefix),
    );
  const head = await readRef({
    gitdir: privateRef ? gitDirectory : commonDirectory,
    ref,
  });
  if (isAborted(signal)) return unknownVcs();
  return { kind: "git", head, dirty: null };
};

const errorCode = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;
