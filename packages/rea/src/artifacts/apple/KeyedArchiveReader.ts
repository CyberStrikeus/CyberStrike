import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { realpath } from "node:fs/promises";
import { readStableArtifact } from "../readStableArtifact.js";
import { projectStableArtifactFailure } from "../StableArtifactFailure.js";
import { ARTIFACT_GRAPH_PROVIDER } from "../../domain/investigationProviders.js";
import { z } from "zod";

import { decodeBinaryPlistValue } from "./BinaryPlistMaterializer.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisInputError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import {
  binaryDatePrecisionOverlapLimitation,
  negativeZeroRealLimitation,
  nonFiniteRealLimitation,
  unknownDateLimitation,
  unknownScalarLimitation,
} from "../../domain/apple/plistValue.js";
import { createPlistNumberProjection } from "../../domain/apple/plistNumbers.js";
import {
  scanBinaryPlistScalars,
  UnsupportedBinaryPlistUidError,
} from "./PlistScalars.js";
import { parseXmlPropertyList } from "../../domain/propertyListKeys.js";
import {
  KeyedArchiveKindError,
  keyedArchiveInputSchema,
  keyedArchiveResultSchema,
  projectKeyedArchive,
} from "../../domain/apple/keyedArchive.js";
import {
  DirectoryArtifactReader,
  DirectoryArtifactEntryAccessDenied,
} from "../DirectoryArtifactReader.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import type { ArtifactEntry } from "../ArtifactReader.js";
import {
  artifactSelectedPathErrno,
  artifactFilePrimaryFacts,
  assertArtifactReadActive,
  bindArtifactFileCleanup,
} from "../ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { translateArtifactFailure } from "../ArtifactOperationFailure.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";

import { decodeXmlPlistText } from "../../domain/propertyListXmlText.js";
import {
  hasBinaryPlistSignature,
  hasNibArchiveSignature,
} from "../../domain/apple/appleArchiveFormat.js";
import { estimateBinaryPlistExpansion } from "./PropertyListDecodeBudget.js";

const MAX_BYTES = 64 * 1024 * 1024;
/** Decoded representation budget, the same 8:1 ratio Interface Builder uses. */
const MAX_DECODE_BYTES = 8 * MAX_BYTES;

/** Share typed selector validation across bundle and standalone reads. */
const parseKeyedArchiveInput = (parameters: unknown) => {
  const parsed = keyedArchiveInputSchema.safeParse(parameters);
  if (!parsed.success)
    throw analysisInputErrorFromIssues(
      "inspect_keyed_archive",
      parsed.error.issues,
      parameters,
      { cause: parsed.error },
    );
  return parsed.data;
};

/** Parse inert plist bytes, preserving data and dates with explicit typed values. */
export const decodeKeyedArchiveBytes = (
  bytes: Buffer,
  selection: { root?: string | undefined; offset: number; limit: number },
) => {
  if (bytes.length > MAX_BYTES)
    throw new RangeError("Keyed archive exceeds 64 MiB");
  if (hasNibArchiveSignature(bytes))
    throw new KeyedArchiveKindError(
      "Selected file is a compiled NIBArchive, not a Foundation plist archive; decode it with decode_interface_builder",
      "nib-archive",
    );
  const binary = hasBinaryPlistSignature(bytes);
  const xmlText = binary ? undefined : decodeXmlPlistText(bytes);
  // Scalar decoding and source container materialization expand shared references,
  // so a few hundred bytes can exhaust memory or the stack without preflight.
  // RangeError reports a resource limit; a reference cycle is malformed.
  const binaryExpansion = binary
    ? estimateBinaryPlistExpansion(bytes, MAX_DECODE_BYTES, {
        budget: "the keyed archive decode budget",
        fail: (kind, message) =>
          kind === "cycle"
            ? new TypeError(
                "binary plist object references form a cycle, which a property list cannot represent",
              )
            : new RangeError(message),
        bounds: "decoder",
        numberProjection: true,
        uidProjection: true,
      })
    : undefined;
  const binaryScalarMetadata = binary
    ? scanBinaryPlistScalars(bytes, binaryExpansion)
    : undefined;
  const parsed =
    binaryExpansion !== undefined
      ? {
          value: decodeBinaryPlistValue(
            bytes,
            binaryExpansion,
            binaryScalarMetadata,
          ),
          numberLiterals: binaryScalarMetadata!.literals,
        }
      : parseXmlPropertyList(xmlText ?? "");
  const {
    nonFiniteRealCount,
    negativeZeroRealCount,
    unknownDateCount,
    unknownScalarCount,
    ...graph
  } = projectKeyedArchive(parsed.value, selection);
  const numbers = createPlistNumberProjection(parsed.numberLiterals);
  // Classify the serialized graph before projecting values to typed decimals.
  // Numeric IDs, node kinds, references and pagination retain their original meaning.
  const roots = Object.fromEntries(
    Object.entries(graph.roots).map(([name, value]) => [
      name,
      numbers.project(value),
    ]),
  );
  const objects = graph.objects.map((object) => ({
    ...object,
    value: numbers.project(object.value),
  }));
  return {
    archive_format: binary ? ("binary-plist" as const) : ("xml-plist" as const),
    ...graph,
    roots,
    objects,
    limitations: [
      ...graph.limitations,
      ...numbers.limitations(),
      ...(nonFiniteRealCount === 0
        ? []
        : [nonFiniteRealLimitation(nonFiniteRealCount)]),
      ...(negativeZeroRealCount === 0
        ? []
        : [negativeZeroRealLimitation(negativeZeroRealCount)]),
      ...(unknownDateCount === 0
        ? []
        : [unknownDateLimitation(unknownDateCount)]),
      ...(binaryExpansion === undefined ||
      binaryExpansion.datePrecisionOverlapCount === 0
        ? []
        : [
            binaryDatePrecisionOverlapLimitation(
              binaryExpansion.datePrecisionOverlapCount,
            ),
          ]),
      ...(unknownScalarCount === 0
        ? []
        : [unknownScalarLimitation(unknownScalarCount)]),
    ],
  };
};

/**
 * Point to the workflow that reads the selected kind of file on this host.
 * decode_interface_builder is portable; inspect_plist requires macOS.
 */
const keyedArchiveKindRemediation = (
  kind: KeyedArchiveKindError["kind"],
  platform: NodeJS.Platform,
): string => {
  if (kind === "nib-archive")
    return "Decode compiled NIBArchive files with decode_interface_builder on the app bundle.";
  return platform === "darwin"
    ? "Inspect an ordinary property list with inspect_plist; inspect_keyed_archive decodes NSKeyedArchiver archives only."
    : "Select an NSKeyedArchiver archive; inspect_keyed_archive decodes only those. inspect_plist, which reads ordinary property lists, requires a macOS host.";
};

interface BundleKeyedArchiveInput {
  bundlePath: string;
  targetSha256: string | null;
  resourceRoot?: import("../../domain/apple/bundleResourceRoot.js").BundleResourceRoot;
  parameters: unknown;
  signal?: AbortSignal;
  /** Host whose available workflows the remediation names. */
  platform?: NodeJS.Platform;
  resources?: ArtifactResourceScope;
}

/** Keep the selected archive and its reader under the caller's cleanup owner. */
export const inspectBundleKeyedArchive = (input: BundleKeyedArchiveInput) => {
  const resources = input.resources ?? new ArtifactResourceScope();
  return resources.run(async () => {
    const reader = new DirectoryArtifactReader(input.bundlePath);
    let outcome:
      | {
          kind: "completed";
          value: Awaited<ReturnType<typeof readSelectedKeyedArchive>>;
        }
      | { kind: "failed"; cause: unknown };
    try {
      outcome = {
        kind: "completed",
        value: await readSelectedKeyedArchive(input, reader),
      };
    } catch (cause: unknown) {
      outcome = { kind: "failed", cause };
    }
    const released = await resources.release({
      kind: "reader",
      reader,
      resource: input.bundlePath,
    });
    if (released.kind === "failed") {
      if (outcome.kind === "failed" && outcome.cause instanceof AnalysisError) {
        const cleanup = translateArtifactFailure(
          "inspect_keyed_archive",
          resources.cleanupFailure({ kind: "completed" }, [released]),
        );
        throw analysisErrorWithCleanupFailure(
          outcome.cause,
          cleanup,
          "inspect_keyed_archive",
        ).bindCleanupDependencies([outcome.cause, cleanup]);
      }
      throw resources.cleanupFailure(outcome, [released]);
    }
    if (outcome.kind === "failed") throw outcome.cause;
    return outcome.value;
  });
};

/** Inspect the admitted physical file while retaining its caller-selected identity. */
export const inspectStandaloneKeyedArchive = (input: {
  readonly path: string;
  readonly selectedPath: string;
  readonly targetSha256: string;
  readonly parameters: unknown;
  readonly platform: NodeJS.Platform;
  readonly resources: ArtifactResourceScope;
  readonly signal?: AbortSignal;
}) =>
  input.resources.run(async () => {
    const selected = parseKeyedArchiveInput(input.parameters);
    const selectedBasename = basename(input.selectedPath);
    const physicalBasename = basename(input.path);
    const basenames = [...new Set([selectedBasename, physicalBasename])];
    if (selected.path !== "." && !basenames.includes(selected.path))
      throw new AnalysisInputError("inspect_keyed_archive", undefined, [
        {
          path: ["path"],
          reason: "invalid_value",
          message:
            "For an active plist, path must select that archive (omit path or use its basename).",
          expected: basenames.length === 1 ? selectedBasename : basenames,
        },
      ]);
    await assertStandaloneArchiveSelection(
      input.path,
      input.selectedPath,
      input.signal,
    );
    const snapshot = await readStableArtifact(
      input.path,
      MAX_BYTES,
      input.signal,
      undefined,
      input.resources,
    ).catch((cause: unknown) => {
      const failure = artifactFilePrimaryFacts(cause).cause;
      if (
        failure instanceof Error &&
        "code" in failure &&
        (failure.code === "EACCES" || failure.code === "EPERM")
      )
        throw projectStableArtifactFailure(
          cause,
          new AnalysisAccessDeniedError(
            "inspect_keyed_archive",
            input.selectedPath,
            failure.code,
            { cause: failure },
          ),
          input.selectedPath,
          ARTIFACT_GRAPH_PROVIDER.id,
          "inspect_keyed_archive",
        );
      throw cause;
    });
    await assertStandaloneArchiveSelection(
      input.path,
      input.selectedPath,
      input.signal,
    );
    if (snapshot.sha256 !== input.targetSha256)
      throw new ArtifactReaderFailure(
        "integrity",
        `Active archive digest changed: expected ${input.targetSha256}, observed ${snapshot.sha256}`,
      );
    return decodeSelectedArchive(snapshot.bytes, {
      targetSha256: input.targetSha256,
      archiveSha256: snapshot.sha256,
      parameters: selected,
      platform: input.platform,
      archivePath: selected.path === "." ? selectedBasename : selected.path,
      artifactPath: input.selectedPath,
    });
  });

/** Selected aliases must continue naming the admitted physical archive. */
const assertStandaloneArchiveSelection = async (
  path: string,
  selectedPath: string,
  signal?: AbortSignal,
): Promise<void> => {
  assertArtifactReadActive(signal);
  const changed = (cause?: unknown) =>
    new AnalysisArtifactChangedError(
      "inspect_keyed_archive",
      selectedPath,
      "Selected archive no longer resolves to the admitted file.",
      { cause },
    );
  let current: string;
  try {
    current = await realpath(selectedPath);
  } catch (cause: unknown) {
    if (artifactSelectedPathErrno(cause) !== undefined) throw changed(cause);
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "EACCES" || cause.code === "EPERM")
    )
      throw new AnalysisAccessDeniedError(
        "inspect_keyed_archive",
        selectedPath,
        cause.code,
        { cause },
      );
    throw cause;
  }
  assertArtifactReadActive(signal);
  if (current !== path) throw changed();
};

/** Read exactly one regular, contained bundle entry without following symlinks. */
const readSelectedKeyedArchive = async (
  input: BundleKeyedArchiveInput,
  reader: DirectoryArtifactReader,
) => {
  const selected = parseKeyedArchiveInput(input.parameters);
  if (
    selected.path.startsWith("/") ||
    selected.path
      .split("/")
      .some((part) => part === ".." || part === "." || part.length === 0)
  )
    throw archivePathError(
      "invalid_format",
      selected.path === "."
        ? "Select a keyed archive path relative to the active app bundle."
        : `Archive path must be a canonical relative bundle path without empty, '.', or '..' segments: ${selected.path}`,
    );
  // Match inventory spelling while retaining the raw path for I/O and evidence.
  const wanted = selected.path.normalize("NFC");
  let entry: ArtifactEntry | undefined;
  for await (const candidate of reader.entries(input.signal, (directory) =>
    wanted.startsWith(`${directory.normalize("NFC")}/`),
  )) {
    if (candidate.path.normalize("NFC") !== wanted) continue;
    if (candidate.kind !== "file")
      throw archivePathError(
        "invalid_value",
        `Archive path selects a ${candidate.kind}, not a regular file: ${selected.path}`,
      );
    if ((candidate.declaredSize ?? 0) > MAX_BYTES)
      throw new ArtifactReaderFailure("limit", "Keyed archive exceeds 64 MiB");
    if (entry !== undefined)
      throw archivePathError(
        "invalid_value",
        `Archive path matches multiple Unicode-equivalent bundle entries; selection is ambiguous: ${selected.path}`,
      );
    entry = candidate;
  }
  if (entry === undefined)
    throw archivePathError(
      "invalid_value",
      `No regular file exists at ${selected.path} in the active app bundle.`,
    );
  const stream = await reader
    .open(entry, input.signal)
    .catch((cause: unknown) => {
      throw selectedArchiveReadFailure(input.bundlePath, entry, cause);
    });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    if (input.signal?.aborted) {
      stream.destroy();
      throw new ArtifactReaderFailure(
        "cancelled",
        "Archive inspection cancelled",
        { cause: input.signal.reason },
      );
    }
    const bytes = z.instanceof(Buffer).parse(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) {
      stream.destroy();
      throw new ArtifactReaderFailure("limit", "Keyed archive exceeds 64 MiB");
    }
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks, size);
  return decodeSelectedArchive(bytes, {
    targetSha256: input.targetSha256,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    resourceRoot: input.resourceRoot,
    parameters: selected,
    platform: input.platform,
    archivePath: entry.path,
    artifactPath: join(input.bundlePath, entry.path),
  });
};

/** Decode and bind one archive at its owning read boundary. */
const decodeSelectedArchive = (
  bytes: Buffer,
  input: {
    readonly targetSha256: BundleKeyedArchiveInput["targetSha256"];
    readonly archiveSha256: string;
    readonly resourceRoot?: BundleKeyedArchiveInput["resourceRoot"];
    readonly parameters: ReturnType<typeof keyedArchiveInputSchema.parse>;
    readonly platform?: NodeJS.Platform | undefined;
    readonly archivePath: string;
    readonly artifactPath: string;
  },
) => {
  try {
    return keyedArchiveResultSchema.parse({
      target_sha256: input.targetSha256,
      ...(input.resourceRoot === undefined
        ? {}
        : { resource_root: input.resourceRoot }),
      archive_path: input.archivePath,
      archive_sha256: input.archiveSha256,
      ...decodeKeyedArchiveBytes(bytes, input.parameters),
    });
  } catch (cause) {
    if (cause instanceof AnalysisInputError) throw cause;
    if (cause instanceof UnsupportedBinaryPlistUidError)
      throw new AnalysisUnsupportedTargetError(
        "inspect_keyed_archive",
        input.artifactPath,
        cause.message,
        { cause },
      );
    // An intact file of another kind is not a damaged archive.
    if (cause instanceof KeyedArchiveKindError)
      throw new AnalysisUnsupportedTargetError(
        "inspect_keyed_archive",
        input.artifactPath,
        cause.message,
        {
          cause,
          remediationAction: keyedArchiveKindRemediation(
            cause.kind,
            input.platform ?? process.platform,
          ),
        },
      );
    throw new ArtifactReaderFailure(
      cause instanceof RangeError ? "limit" : "format",
      `Cannot decode selected Foundation keyed archive: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
};

/** A caller-selected archive path, not the artifact, failed its constraint. */
const archivePathError = (
  reason: "invalid_format" | "invalid_value",
  message: string,
) =>
  new AnalysisInputError("inspect_keyed_archive", undefined, [
    { path: ["path"], reason, message },
  ]);

/**
 * The caller selected this entry, so a refused open is a selection outcome:
 * preserve the host's read-access denial and its system code instead of
 * reporting a generic artifact execution failure.
 */
const selectedArchiveReadFailure = (
  bundlePath: string,
  entry: ArtifactEntry,
  cause: unknown,
): unknown => {
  if (!(cause instanceof DirectoryArtifactEntryAccessDenied)) return cause;
  const error = new AnalysisAccessDeniedError(
    "inspect_keyed_archive",
    join(bundlePath, entry.path),
    cause.systemCode,
    {
      cause,
      // The cleanup observation, not just the leases, makes the projection
      // report an unresolved resource; binding leases alone would claim the
      // denied open left nothing owned.
      ...(cause.cleanup === undefined ? {} : { cleanup: cause.cleanup }),
      ...(cause.partialObservation === undefined
        ? {}
        : { partialObservation: cause.partialObservation }),
    },
  );
  bindArtifactFileCleanup(cause, error);
  return error;
};
