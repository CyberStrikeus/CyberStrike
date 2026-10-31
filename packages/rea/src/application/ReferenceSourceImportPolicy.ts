import { lstat, realpath, stat } from "node:fs/promises";
import fs from "node:fs";
import { join } from "node:path";
import { locateReferenceSourceGitDirectory } from "./ReferenceSourceGitDirectory.js";
import type { ReferenceSourceReaderError } from "../reference/ReferenceSourceReaderTypes.js";

import ignore from "ignore";
import {
  readRegularFileText,
  RegularFileReadFailure,
  retryRegularFileCleanup,
} from "./RegularFileRead.js";

import { err, ok, type Result } from "../domain/result.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  DEFAULT_REFERENCE_SOURCE_IGNORE_PATTERNS,
  type ReferenceSourceImportError,
  type ReferenceSourceImportOptions,
} from "./ReferenceSourceImportTypes.js";
import { rootFilesystemFailure } from "../reference/ReferenceSourceReaderErrors.js";
import {
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";

/** Validated inputs ready for filesystem traversal. */
export interface PreparedReferenceSourceImport {
  readonly root: string;
  readonly ignored: Pick<ReturnType<typeof ignore>, "test">;
  readonly beforeDirectory: (
    path: string,
  ) => Promise<Result<undefined, ReferenceSourceReaderError>>;
  readonly secrets: ReturnType<typeof ignore>;
}

const failure = (
  code: ReferenceSourceImportError["code"],
  message: string,
): ReferenceSourceImportError => ({
  tag: "reference-source-import",
  code,
  message,
});

class IgnorePolicyReadCancelled extends Error {
  constructor(readonly reason: unknown) {
    super("Reference source ignore policy read was cancelled", {
      cause: reason,
    });
    this.name = "IgnorePolicyReadCancelled";
  }
}

const isIgnorePolicyCancellation = (cause: unknown): boolean =>
  cause instanceof IgnorePolicyReadCancelled;

const ignorePolicyCause = (cause: unknown): unknown =>
  cause instanceof IgnorePolicyReadCancelled
    ? cause.reason
    : cause instanceof RegularFileReadFailure
      ? cause.operationCause
      : cause;

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

const addMarkedPatterns = (
  matcher: ReturnType<typeof ignore>,
  patterns: readonly string[],
  mark: "project-ignored" | "default-ignored" | "caller-excluded",
): void => {
  for (const pattern of patterns)
    for (const line of pattern.split(/\r?\n/u))
      matcher.add({ pattern: line, mark });
};

const resolveRoot = async (
  requestedRoot: string,
  signal?: AbortSignal,
): Promise<Result<string, ReferenceSourceImportError>> => {
  if (isAborted(signal))
    return err(failure("cancelled", "Reference source import cancelled"));
  try {
    const metadata = await stat(requestedRoot);
    if (isAborted(signal))
      return err(failure("cancelled", "Reference source import cancelled"));
    if (!metadata.isDirectory())
      return err(
        failure(
          "invalid-root",
          `Reference source root is not a directory: ${requestedRoot}`,
        ),
      );
    const canonicalRoot = await realpath(requestedRoot);
    if (isAborted(signal))
      return err(failure("cancelled", "Reference source import cancelled"));
    return ok(canonicalRoot);
  } catch (cause: unknown) {
    if (isAborted(signal))
      return err(failure("cancelled", "Reference source import cancelled"));
    const rootFailure = rootFilesystemFailure(
      cause,
      "Reference source root could not be resolved",
    );
    if (rootFailure === undefined) throw cause;
    return err({
      ...failure(rootFailure.code, rootFailure.message),
      ...(rootFailure.remediationAction === undefined
        ? {}
        : { remediationAction: rootFailure.remediationAction }),
      cause,
    });
  }
};

/** Read one policy/configuration file through the existing descriptor owner. */
const readPolicyFile = async (
  policyPath: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<string | undefined, ReferenceSourceImportError>> => {
  try {
    let present = true;
    try {
      await lstat(policyPath);
    } catch (cause: unknown) {
      if (
        !(
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
      )
        throw cause;
      present = false;
    }
    if (signal?.aborted === true)
      throw new IgnorePolicyReadCancelled(signal.reason);
    if (present) {
      let text: string;
      try {
        text = await readRegularFileText(policyPath, {
          signal,
          cancellationFailure: (reason) =>
            new IgnorePolicyReadCancelled(reason),
        });
      } catch (cause: unknown) {
        if (cause instanceof IgnorePolicyReadCancelled) throw cause;
        if (!(cause instanceof RegularFileCleanupFailure)) throw cause;
        const retry = await retryRegularFileCleanup(cause, resources, signal);
        const operationCancellation =
          cause.outcome.kind === "failed"
            ? regularFileCancellation(cause)
            : undefined;
        if (retry.cleanup !== undefined) {
          const primary =
            retry.outcome.kind === "failed"
              ? retry.outcome.cause
              : cause.cleanupCause;
          const primaryCause = ignorePolicyCause(primary);
          return err({
            ...failure(
              isIgnorePolicyCancellation(primary) ||
                operationCancellation !== undefined
                ? "cancelled"
                : "io",
              `Reference source ignore policy could not be read at ${policyPath}: ${errorMessage(primaryCause)}`,
            ),
            cleanup: retry.cleanup,
            cause: primaryCause,
          });
        }
        if (retry.outcome.kind === "failed") {
          if (operationCancellation !== undefined)
            throw new IgnorePolicyReadCancelled(operationCancellation.reason);
          throw retry.outcome.cause;
        }
        text = retry.outcome.value;
      }
      return ok(text);
    }
    return ok(undefined);
  } catch (cause: unknown) {
    const causeValue = ignorePolicyCause(cause);
    return err({
      ...failure(
        isIgnorePolicyCancellation(cause) ? "cancelled" : "io",
        `Reference source policy could not be read at ${policyPath}: ${errorMessage(causeValue)}`,
      ),
      cause: causeValue,
    });
  }
};

const readIgnoreCase = async (
  root: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<boolean, ReferenceSourceImportError>> => {
  let readFailure: ReferenceSourceImportError | undefined;
  const readText = async (path: string): Promise<string> => {
    // isomorphic-git probes readFile() without a path to detect promise APIs.
    if (path === undefined)
      throw new TypeError("Git metadata path is required");
    const read = await readPolicyFile(path, resources, signal);
    if (!read.ok) {
      readFailure = read.error;
      throw read.error;
    }
    if (read.value === undefined) {
      const absent = new Error(`Git metadata file is absent: ${path}`);
      Object.assign(absent, { code: "ENOENT" });
      throw absent;
    }
    return read.value;
  };
  try {
    const location = await locateReferenceSourceGitDirectory(
      root,
      readText,
      signal,
    );
    if (location === undefined) return ok(false);
    const { getConfig } = await import("isomorphic-git");
    const value = await getConfig({
      fs: { ...fs, promises: { ...fs.promises, readFile: readText } },
      gitdir: location.commonDirectory,
      path: "core.ignorecase",
    });
    if (readFailure !== undefined) return err(readFailure);
    if (value === undefined) return ok(false);
    // The installed Git parser applies the core.ignorecase boolean schema.
    if (typeof value === "boolean") return ok(value);
    return err(
      failure(
        "io",
        `Invalid core.ignorecase in ${location.commonDirectory}/config`,
      ),
    );
  } catch (cause: unknown) {
    if (readFailure !== undefined) return err(readFailure);
    if (isAborted(signal) || isIgnorePolicyCancellation(cause))
      return err(failure("cancelled", "Reference source import cancelled"));
    return err({
      ...failure(
        "io",
        `Reference source Git policy could not be read: ${errorMessage(cause)}`,
      ),
      cause,
    });
  }
};

const buildIgnored = async (
  root: string,
  excludePaths: readonly string[],
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<
  Result<
    Pick<PreparedReferenceSourceImport, "ignored" | "beforeDirectory">,
    ReferenceSourceImportError
  >
> => {
  const ignoreCase = await readIgnoreCase(root, resources, signal);
  if (!ignoreCase.ok) return ignoreCase;
  const mandatory = ignore();
  addMarkedPatterns(
    mandatory,
    DEFAULT_REFERENCE_SOURCE_IGNORE_PATTERNS,
    "default-ignored",
  );
  for (const path of excludePaths)
    addMarkedPatterns(mandatory, [path, `${path}/`], "caller-excluded");
  const scopes = new Map<string, ReturnType<typeof ignore>>();
  const loadDirectory = async (
    path: string,
  ): Promise<Result<undefined, ReferenceSourceImportError>> => {
    if (scopes.has(path)) return ok(undefined);
    const policyPath =
      path === "." ? join(root, ".gitignore") : join(root, path, ".gitignore");
    const read = await readPolicyFile(policyPath, resources, signal);
    if (!read.ok) return read;
    const matcher = ignore({ ignoreCase: ignoreCase.value });
    if (read.value !== undefined)
      addMarkedPatterns(matcher, [read.value], "project-ignored");
    scopes.set(path, matcher);
    return ok(undefined);
  };
  const rootPolicy = await loadDirectory(".");
  if (!rootPolicy.ok) return rootPolicy;
  return ok({
    ignored: {
      test: (path) => {
        const mandatoryMatch = mandatory.test(path);
        // Caller negations override project rules just as caller exclusions do.
        if (mandatoryMatch.ignored || mandatoryMatch.unignored)
          return mandatoryMatch;
        let result = mandatoryMatch;
        const pieces = path.replace(/\/$/u, "").split("/");
        for (let depth = 0; depth < pieces.length; depth += 1) {
          const scope = depth === 0 ? "." : pieces.slice(0, depth).join("/");
          const matcher = scopes.get(scope);
          if (matcher === undefined) continue;
          const scopedPath =
            pieces.slice(depth).join("/") + (path.endsWith("/") ? "/" : "");
          const match = matcher.test(scopedPath);
          if (match.ignored || match.unignored) result = match;
        }
        return result;
      },
    },
    beforeDirectory: async (path) => {
      const loaded = await loadDirectory(path);
      return loaded.ok
        ? loaded
        : err({
            ...loaded.error,
            tag: "reference-source-reader",
            code: loaded.error.code === "cancelled" ? "cancelled" : "io",
          });
    },
  });
};

/** Resolve the caller-selected directory and build path filters. */
export const prepareReferenceSourceImport = async (
  options: ReferenceSourceImportOptions,
  resources: ArtifactResourceScope,
): Promise<
  Result<PreparedReferenceSourceImport, ReferenceSourceImportError>
> => {
  try {
    return await resources.run(async () => {
      const root = await resolveRoot(options.root, options.signal);
      if (!root.ok) return root;
      try {
        const ignored = await buildIgnored(
          root.value,
          options.excludePaths ?? [],
          resources,
          options.signal,
        );
        if (!ignored.ok) return ignored;
        return ok({
          root: root.value,
          ...ignored.value,
          secrets: ignore().add([...options.policy.secretPatterns]),
        });
      } catch (cause: unknown) {
        const causeValue = ignorePolicyCause(cause);
        return err({
          ...failure(
            isIgnorePolicyCancellation(cause) ? "cancelled" : "io",
            `Reference source ignore policy could not be read at ${join(root.value, ".gitignore")}: ${errorMessage(causeValue)}`,
          ),
          cause: causeValue,
        });
      }
    });
  } catch (cause: unknown) {
    if (!(cause instanceof ArtifactReaderFailure)) throw cause;
    return err({
      ...failure(
        cause.reason === "cancelled" ? "cancelled" : "io",
        cause.message,
      ),
      ...(cause.cleanup === undefined ? {} : { cleanup: cause.cleanup }),
      cause,
    });
  }
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
