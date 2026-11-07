import { posix } from "node:path";

import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { createReferenceSourcePathLookup } from "../domain/referenceSourcePathIdentity.js";
import { err, ok } from "../domain/result.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { traverseDirectory } from "./ReferenceSourceReaderEntries.js";
import type {
  ReferenceSourceReaderOptions,
  ReferenceSourceEntry,
  ReferenceSourceRootFailure,
  ReferenceSourceRead,
  ReferenceSourceResult,
  TraversalState,
} from "./ReferenceSourceReaderTypes.js";
import {
  isAborted,
  noFollowOpenSupported,
  prepareRoot,
} from "./ReferenceSourceReaderValidate.js";
import { referenceSourceResourceFailure } from "./ReferenceSourceReaderErrors.js";

const PATH_RACE_LIMITATION =
  "Path identity is revalidated around operations; Node lacks portable descriptor-relative openat traversal, so a syscall-boundary pathname race remains.";

/** Read a source tree without intentionally following symbolic links. */
export const readReferenceSource = async (
  root: string,
  resources: ArtifactResourceScope,
  options: ReferenceSourceReaderOptions = {},
): Promise<ReferenceSourceResult<ReferenceSourceRead>> => {
  try {
    return await resources.run(() => readSource(root, resources, options));
  } catch (cause: unknown) {
    if (!(cause instanceof ArtifactReaderFailure)) throw cause;
    return err(referenceSourceResourceFailure(cause));
  }
};

const readSource = async (
  root: string,
  resources: ArtifactResourceScope,
  options: ReferenceSourceReaderOptions,
): Promise<ReferenceSourceResult<ReferenceSourceRead>> => {
  if (!noFollowOpenSupported())
    return err({
      tag: "reference-source-reader",
      code: "unsupported",
      message: "Safe no-follow file opens are unavailable",
    });
  const prepared = await prepareRoot(root, options.signal);
  if (!prepared.ok) return prepared;
  const { canonicalRoot, rootIdentity } = prepared.value;
  const state: TraversalState = {
    resources,
    root: canonicalRoot,
    rootIdentity,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.shouldExclude === undefined
      ? {}
      : { shouldExclude: options.shouldExclude }),
    ...(options.beforeDirectory === undefined
      ? {}
      : { beforeDirectory: options.beforeDirectory }),
    entries: [],
    exclusions: [],
    pending: [{ path: canonicalRoot }],
    bytesRead: 0,
  };
  const traversal = await traverse(state);
  if (
    !isAborted(state.signal) &&
    (traversal.ok || traversal.error.code !== "cancelled")
  )
    reconcileUnobservedSymlinkTargets(
      state.entries,
      state.exclusions,
      state.signal,
      state.rootFailure,
    );
  state.entries.sort((left, right) =>
    compareUnicodeCodePoints(left.path, right.path),
  );
  const read: ReferenceSourceRead = {
    root: canonicalRoot,
    ...(state.rootFailure === undefined
      ? {}
      : { rootFailure: state.rootFailure }),
    entries: state.entries,
    bytesRead: state.bytesRead,
    limitations: [PATH_RACE_LIMITATION],
  };
  if (traversal.ok && state.rootFailure?.code === "io")
    return err({
      tag: "reference-source-reader",
      code: "io",
      message: state.rootFailure.message,
      partial: read,
    });
  return traversal.ok ? ok(read) : err({ ...traversal.error, partial: read });
};

/**
 * Resolve internal link observations against the completed reader inventory.
 * If the closest containing directory failed before enumeration completed,
 * the target remains unknown; a broader failed ancestor cannot override a
 * successfully enumerated directory or a recorded exclusion.
 */
export const reconcileUnobservedSymlinkTargets = (
  entries: ReferenceSourceEntry[],
  exclusions: TraversalState["exclusions"] = [],
  signal?: AbortSignal,
  rootFailure?: ReferenceSourceRootFailure,
): void => {
  const failedDirectories = new Map(
    entries.flatMap((entry) =>
      entry.status === "failed" &&
      entry.kind === "directory" &&
      entry.code !== "cancelled"
        ? [[entry.path, entry] as const]
        : [],
    ),
  );
  if (
    (failedDirectories.size === 0 && rootFailure === undefined) ||
    isAborted(signal)
  )
    return;
  const directoryEntries = entries.filter(
    (entry) => entry.kind === "directory",
  );
  const directoryPaths = createReferenceSourcePathLookup(
    directoryEntries.map(({ path }) => path),
  );
  const observedPaths = createReferenceSourcePathLookup(
    entries.map(({ path }) => path),
  );
  const excludedPaths = createReferenceSourcePathLookup(
    exclusions.map(({ path }) => path),
  );
  for (const [index, entry] of entries.entries()) {
    if (isAborted(signal)) return;
    if (
      entry.status !== "read" ||
      entry.kind !== "symlink" ||
      entry.targetState !== "internal" ||
      observedPaths.resolve(entry.target) !== undefined ||
      excludedPaths.resolve(entry.target) !== undefined
    )
      continue;
    const ancestor = nearestFailedAncestor(
      entry.target,
      directoryPaths,
      failedDirectories,
      excludedPaths,
      signal,
      rootFailure,
    );
    if (ancestor === undefined) continue;
    entries[index] = {
      status: "failed",
      kind: "symlink",
      path: entry.path,
      code: ancestor.code,
      message: `Symbolic link target ${JSON.stringify(entry.target)} was not inventoried because directory ${JSON.stringify(ancestor.path)} could not be enumerated: ${ancestor.message}`,
    };
  }
};

const nearestFailedAncestor = (
  target: string,
  directoryPaths: ReturnType<typeof createReferenceSourcePathLookup>,
  failedDirectories: ReadonlyMap<
    string,
    Extract<ReferenceSourceEntry, { status: "failed" }>
  >,
  excludedPaths: ReturnType<typeof createReferenceSourcePathLookup>,
  signal: AbortSignal | undefined,
  rootFailure: ReferenceSourceRootFailure | undefined,
): (ReferenceSourceRootFailure & { readonly path: string }) | undefined => {
  for (
    let candidate = posix.dirname(target);
    candidate !== "." && candidate !== "/";
    candidate = posix.dirname(candidate)
  ) {
    if (isAborted(signal)) return undefined;
    if (excludedPaths.resolve(candidate) !== undefined) return undefined;
    const observedDirectory = directoryPaths.resolve(candidate);
    if (observedDirectory !== undefined)
      return failedDirectories.get(observedDirectory);
  }
  if (isAborted(signal)) return undefined;
  if (excludedPaths.resolve(".") !== undefined) return undefined;
  return rootFailure === undefined ? undefined : { path: ".", ...rootFailure };
};

const traverse = async (
  state: TraversalState,
): Promise<ReferenceSourceResult<undefined>> => {
  while (state.pending.length > 0) {
    if (isAborted(state.signal))
      return err({
        tag: "reference-source-reader",
        code: "cancelled",
        message: "Reference source traversal cancelled",
      });
    const current = state.pending.pop();
    if (current === undefined) break;
    const result = await traverseDirectory(state, current);
    if (!result.ok) return result;
  }
  return ok(undefined);
};
