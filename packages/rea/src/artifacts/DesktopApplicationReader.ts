import { desktopPathConventions } from "../domain/nativeConvention.js";
import { isAbsolute } from "node:path";
import {
  DirectoryArtifactReader,
  DirectoryArtifactRootFailure,
  DirectoryArtifactTraversalLimit,
  type DirectoryArtifactEntry,
} from "./DirectoryArtifactReader.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { artifactFileCompletion } from "./ArtifactFileOperation.js";
import {
  ArtifactResourceScope,
  type ArtifactResourceOwner,
} from "./ArtifactResourceScope.js";
import { abortIfNeeded } from "./ArtifactHash.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import {
  inspectDesktopFile,
  RETAINED_FACT_BYTES,
  retainedFactReferenceBytes,
  retainedTextBytes,
  type DesktopReadBudget,
} from "./DesktopFileInspection.js";
import type { DesktopApplicationPort } from "../application/artifacts/DesktopApplicationPort.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type {
  DesktopApplication,
  DesktopFact,
  DesktopFile,
  DesktopOmission,
  InspectDesktopApplicationInput,
} from "../domain/desktopApplication.js";
import { projectDesktopApplication } from "../domain/desktopApplicationProjection.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import { err, ok } from "../domain/result.js";
import { createDesktopApplicationEvidence } from "../domain/desktopApplicationEvidence.js";
import { ARTIFACT_GRAPH_PROVIDER } from "../domain/investigationProviders.js";
import {
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import type {
  AnalysisError,
  AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";

const RETAINED_METADATA_BYTES = 32 * 1024 * 1024;
/**
 * Upper bound for one file row besides its texts, facts and ranges: the row
 * and identity objects, file_id, identity strings, arrays, candidate and
 * component basis IDs and short constant issues. Whole rows, paths included,
 * measured 800–940 heap and 490–640 JSON bytes on real app bundles (64-bit
 * Node; #8104).
 */
const RETAINED_ROW_BYTES = 1024;
const RETAINED_OMISSION_BYTES = 512;
const RETAINED_ISSUE_BYTES = 64;

/** Stop traversal without discarding the preceding bounded observations. */
class DesktopRepresentationLimit extends ArtifactReaderFailure {
  constructor() {
    super(
      "limit",
      "Directory metadata reached the 32 MiB representation budget; remaining entry and omission facts are unavailable.",
      { boundary: "memory" },
    );
  }
}

/** Existing artifact ownership with bounded metadata, serial probes and no payload cache. */
export class DesktopApplicationReader implements DesktopApplicationPort {
  readonly #resources = new ArtifactResourceScope();
  #running = false;
  constructor(
    private readonly directoryReaderFor: (
      path: string,
    ) => DirectoryArtifactReader = (path) => new DirectoryArtifactReader(path),
  ) {}

  async inspect(
    input: InspectDesktopApplicationInput,
    options?: ExecutionOptions,
  ) {
    if (this.#running)
      return err(
        new AnalysisResourceConstraintError(
          "inspect_desktop_application",
          "capacity",
          "This artifact reader already owns a directory inspection",
          { max_concurrent_inspections: 1 },
          {
            retryable: true,
            remediationAction:
              "Wait for this directory inspection to finish before submitting another.",
          },
        ),
      );
    this.#running = true;
    try {
      return ok(
        await this.#resources.run(() => this.#inspect(input, options?.signal)),
      );
    } catch (cause: unknown) {
      const error = translateArtifactFailure(
        "inspect_desktop_application",
        cause,
      );
      return err(error);
    } finally {
      this.#running = false;
    }
  }

  close(): Promise<void> {
    return this.#resources.close();
  }

  async #inspect(
    input: InspectDesktopApplicationInput,
    signal?: AbortSignal,
  ): Promise<DesktopApplication> {
    if (!isAbsolute(input.path))
      throw new ArtifactReaderFailure(
        "path",
        "Expected an absolute directory path",
      );
    const reader = this.directoryReaderFor(input.path);
    const owner: ArtifactResourceOwner = {
      kind: "reader",
      resource: input.path,
      reader,
    };
    let outcome:
      | { kind: "completed"; value: DesktopApplication }
      | { kind: "failed"; cause: unknown };
    let report: DesktopApplication | undefined;
    try {
      const scanned = await scanDirectory(reader, input, signal);
      report = scanned.report;
      outcome =
        scanned.failure === undefined
          ? { kind: "completed", value: report }
          : { kind: "failed", cause: scanned.failure.cause };
    } catch (cause: unknown) {
      outcome = { kind: "failed", cause };
    }
    const closed = await this.#resources.release(owner);
    const partial =
      report === undefined ||
      (closed.kind !== "failed" &&
        outcome.kind !== "failed" &&
        signal?.aborted !== true)
        ? undefined
        : createDesktopApplicationEvidence(
            input,
            report,
            ARTIFACT_GRAPH_PROVIDER,
          );
    if (closed.kind === "failed")
      throw this.#resources.cleanupFailure(outcome, [closed], partial);
    if (outcome.kind === "failed") {
      const cause = outcome.cause;
      if (cause instanceof DirectoryArtifactRootFailure)
        throw selectedRootFailure(input.path, cause, partial);
      if (!(cause instanceof ArtifactReaderFailure) || partial === undefined)
        throw cause;
      throw new ArtifactReaderFailure(
        cause.reason,
        cause.message,
        {
          cause,
          cancellation: cause.cancellation,
          cleanup: cause.cleanup,
          cleanupLeases: cause.cleanupLeases,
          partialObservation: partial,
          ...(cause.boundary === undefined ? {} : { boundary: cause.boundary }),
        },
        cause.details,
      );
    }
    if (signal?.aborted)
      throw new ArtifactReaderFailure(
        "cancelled",
        "Directory inspection cancelled during final cleanup",
        { cause: signal.reason, partialObservation: partial },
      );
    return outcome.value;
  }
}

/**
 * The root is the caller's selection: a non-directory is an unsupported
 * target, and host failures keep the shared target-unavailable/access-denied
 * classification instead of becoming artifact I/O faults.
 */
const selectedRootFailure = (
  path: string,
  failure: DirectoryArtifactRootFailure,
  partialObservation: AnalysisPartialObservation | undefined,
): AnalysisError =>
  failure.reason === "path"
    ? new AnalysisUnsupportedTargetError(
        "inspect_desktop_application",
        path,
        failure.message,
        {
          cause: failure,
          partialObservation,
          remediationAction:
            "Select the application's local installation directory, such as a macOS .app bundle or the directory containing its executable.",
        },
      )
    : new BinaryTargetError(path, failure.message, {
        cause: failure.cause,
        partialObservation,
      });

const scanDirectory = async (
  reader: DirectoryArtifactReader,
  input: InspectDesktopApplicationInput,
  signal?: AbortSignal,
): Promise<{
  readonly report: DesktopApplication;
  readonly failure?: { readonly cause: unknown };
}> => {
  const admittedRoot = await reader.rootObservation();
  const root = {
    canonical_path: admittedRoot.canonicalPath,
    identity: {
      device: admittedRoot.identity.dev.toString(),
      inode: admittedRoot.identity.ino.toString(),
    },
  };
  const namespaceId = `dsr_${digestCanonicalValue(root, "Admitted desktop directory namespace")}`;
  const files: DesktopFile[] = [];
  const omissions: DesktopOmission[] = [];
  const unityWitnessRoots = new Set<string>();
  const budget: DesktopReadBudget = {
    bytes: 0,
    maximum: input.max_probe_bytes,
    retainedBytes:
      RETAINED_ROW_BYTES +
      retainedTextBytes(input.path) +
      retainedTextBytes(root.canonical_path),
    maximumRetainedBytes: RETAINED_METADATA_BYTES,
  };
  const fits = (bytes: number): boolean => {
    if (bytes > budget.maximumRetainedBytes - budget.retainedBytes)
      return false;
    budget.retainedBytes += bytes;
    return true;
  };
  const reserve = (bytes: number) => {
    if (!fits(bytes)) throw new DesktopRepresentationLimit();
  };
  let entries = 0;
  let probed = 0;
  let symlinks = 0;
  let special = 0;
  let partial = false;
  let failure: { readonly cause: unknown } | undefined;
  const limitations = [
    "Runtime candidates and component markers do not establish loaded code, execution, or build correspondence.",
    "The directory SHA-256 commits only to retained paths, omission kinds, available filesystem metadata and read-range digests, not to every file's contents. Unread bytes are unknown.",
    "Special-entry payloads are not read. Their paths and kinds are retained; other special-entry metadata is unavailable in this report.",
    "Child symlinks are not followed. Executable section-embedded PCKs without a trailer and encrypted contents remain unexamined.",
    "This is a sequence of stable entry observations, not an atomic snapshot of the entire directory.",
    "Unity reference decoding stops after a witness in each Data/Managed directory; other assemblies' references are unexamined. Header facts remain per-file.",
  ];
  try {
    for await (const entry of reader.entries(signal, {
      maximumEntries: input.max_entries,
      onOmission: (omission) => {
        if (omission.kind !== "directory-descendants") {
          special++;
          entries++;
        }
        partial = true;
        reserve(RETAINED_OMISSION_BYTES + retainedTextBytes(omission.path));
        const semantic = {
          root_namespace_id: namespaceId,
          path: omission.path,
          kind: omission.kind,
        };
        omissions.push({
          omission_id: `dso_${digestCanonicalValue(semantic, "Desktop traversal omission")}`,
          path: omission.path,
          kind: omission.kind,
        });
      },
      onCoverage: (coverage) => {
        if (coverage.examinedEntries !== undefined)
          entries = coverage.examinedEntries;
        if (coverage.status !== "complete") partial = true;
        limitations.push(...coverage.limitations);
      },
    })) {
      entries++;
      abortIfNeeded(signal);
      const conventions =
        entry.kind === "file" ? pathConventions(entry.path) : undefined;
      // Reserve the row and every repeated path before retaining them: each
      // convention fact copies the path and its probes copy the local path.
      reserve(
        RETAINED_ROW_BYTES +
          retainedTextBytes(entry.path) +
          retainedTextBytes(entry.adapterKey) +
          (conventions?.facts.length ?? 0) *
            (RETAINED_FACT_BYTES +
              retainedTextBytes(entry.path) +
              retainedFactReferenceBytes(entry.adapterKey)),
      );
      const row = fileRow(entry, namespaceId);
      files.push(row);
      if (entry.kind === "symlink") {
        symlinks++;
        continue;
      }
      if (conventions === undefined) continue;
      row.facts.push(...conventions.facts);
      const managedRoot = conventions.unityManagedDirectory;
      if (!probeSelected(entry)) continue;
      if (budget.bytes >= budget.maximum) {
        row.read_status = "unavailable";
        row.issues.push(
          "Probe byte budget exhausted; bytes were not inspected.",
        );
        partial = true;
        continue;
      }
      probed++;
      try {
        await reader.inspectFile(
          entry,
          (file) =>
            inspectDesktopFile(
              file,
              row,
              budget,
              signal,
              managedRoot !== null && !unityWitnessRoots.has(managedRoot)
                ? managedRoot
                : null,
            ),
          signal,
        );
        row.read_status = row.issues.length === 0 ? "examined" : "partial";
        if (
          managedRoot !== null &&
          row.facts.some((fact) => fact.kind === "unity-assembly-reference")
        )
          unityWitnessRoots.add(managedRoot);
        if (row.issues.length > 0) partial = true;
      } catch (cause: unknown) {
        if (!(cause instanceof ArtifactReaderFailure)) throw cause;
        const probeIssueCount = row.issues.length;
        row.read_status = "unavailable";
        // Host failures name the absolute path; charge that copy too.
        const issueRetained = fits(
          RETAINED_ISSUE_BYTES + retainedTextBytes(cause.message),
        );
        if (issueRetained) row.issues.push(cause.message);
        partial = true;
        const completedRead = artifactFileCompletion(cause) !== undefined;
        if (completedRead)
          row.read_status = probeIssueCount === 0 ? "examined" : "partial";
        if (
          !completedRead &&
          (cause.reason === "integrity" ||
            cause.reason === "io" ||
            cause.reason === "cancelled")
        ) {
          row.facts = row.facts.filter((fact) => fact.offset === null);
          row.ranges = [];
        }
        if (cause.cleanup !== undefined || cause.reason === "cancelled")
          throw cause;
        if (!issueRetained) throw new DesktopRepresentationLimit();
      }
    }
  } catch (cause: unknown) {
    partial = true;
    if (cause instanceof DirectoryArtifactTraversalLimit) {
      entries = cause.examinedEntries;
      limitations.push(
        "Directory traversal reached max_entries; unvisited paths and candidate families remain unknown.",
      );
    } else if (cause instanceof DesktopRepresentationLimit) {
      limitations.push(cause.message);
    } else {
      failure = { cause };
      limitations.push(
        "Inspection was interrupted; only preceding stable entry observations are retained.",
      );
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  omissions.sort((a, b) =>
    a.path < b.path
      ? -1
      : a.path > b.path
        ? 1
        : a.kind < b.kind
          ? -1
          : a.kind > b.kind
            ? 1
            : 0,
  );
  const coverage: DesktopApplication["coverage"] = {
    status: partial ? "partial" : "complete-within-scan",
    entries_examined: entries,
    files_probed: probed,
    bytes_read: budget.bytes,
    symlinks_not_followed: symlinks,
    special_entries_omitted: special,
    limits: {
      max_entries: input.max_entries,
      max_probe_bytes: input.max_probe_bytes,
    },
  };
  // Compose identities already owned by admitted root/entry observations and
  // retained reads. Caller policy, interpretations and cleanup diagnostics stay
  // in Evidence without renaming the same examined source.
  const snapshot = digestCanonicalValue(
    {
      root_namespace_id: namespaceId,
      files: files.map(({ file_id, bytes, ranges }) => ({
        file_id,
        bytes,
        ranges,
      })),
      omissions: omissions.map(({ omission_id }) => omission_id),
    },
    "Examined desktop directory facts",
  );
  const report: DesktopApplication = {
    root: {
      path: input.path,
      ...root,
      namespace_id: namespaceId,
      snapshot_sha256: snapshot,
      identity_scope: "examined-metadata-and-read-ranges",
    },
    files,
    omissions,
    ...projectDesktopApplication(files),
    coverage,
    limitations,
  };
  return { report, ...(failure === undefined ? {} : { failure }) };
};

const fileRow = (
  entry: DirectoryArtifactEntry,
  rootNamespaceId: string,
): DesktopFile => {
  const source = entry.sourceIdentity;
  const identity =
    source === undefined
      ? null
      : {
          device: source.device.toString(),
          inode: source.inode.toString(),
          size: source.size.toString(),
          mode: source.mode.toString(),
          mtime_ns: source.mtimeNs.toString(),
          ctime_ns: source.ctimeNs.toString(),
        };
  const semantic = {
    root_namespace_id: rootNamespaceId,
    path: entry.path,
    kind: entry.kind,
    identity,
  };
  return {
    file_id: `dsf_${digestCanonicalValue(semantic, "Desktop directory entry")}`,
    path: entry.path,
    local_path: entry.adapterKey,
    kind: entry.kind,
    bytes: entry.declaredSize,
    identity,
    read_status: "not-selected",
    ranges: [],
    facts: [],
    issues: [],
  };
};

/** Path-convention facts of one file; each repeats the path as its value. */
const pathConventions = (path: string) => {
  const conventions = desktopPathConventions(path);
  const facts: DesktopFact[] = [];
  if (conventions.electronArchive)
    facts.push({ kind: "electron-asar-convention", offset: null, value: path });
  if (conventions.unrealContainer)
    facts.push({
      kind: "unreal-container-convention",
      offset: null,
      value: path,
    });
  if (conventions.il2cppLibrary)
    facts.push({
      kind: "il2cpp-library-convention",
      offset: null,
      value: path,
    });
  return {
    facts,
    unityManagedDirectory: conventions.unityManagedDirectory,
  };
};

const probeSelected = (entry: DirectoryArtifactEntry): boolean =>
  entry.executable ||
  /(?:\.(?:exe|dll|so|dylib|pck|utoc|bundle|ab|unity3d)|(?:^|\/)(?:global-metadata\.dat|data\.win|game\.(?:unx|ios)))$/iu.test(
    entry.path,
  );
