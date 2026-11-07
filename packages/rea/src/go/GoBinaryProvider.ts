import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../filesystem/RegularFile.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  assertArtifactReadActive,
  artifactFileCancellationCause,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { GoBinaryPort } from "../application/go/GoBinaryPort.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  goBinarySchema,
  type GoBinary,
  type InspectGoBinaryInput,
} from "../domain/go/goBinary.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { err, ok, type Result } from "../domain/result.js";
import { readGoBinaryImage, type GoBinaryImage } from "./GoBinaryImage.js";
import { requireSelectedNativeImage } from "../native/metadata/MachoSliceSelection.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
} from "../native/metadata/BinaryContainer.js";

/** Bundled format reader identity; embedded compiler versions are separate observed facts. */
export const GO_BINARY_PROVIDER_IDENTITY = {
  id: "go-build-info",
  name: "REA Go build-information reader",
  version: "1",
} as const;
const OPERATION = "inspect_go_binary";
const INPUT_BYTES = 256 * 1024 * 1024;
const OUTPUT_BYTES = 8 * 1024 * 1024;

const failureForPrimary = (
  facts: ArtifactFilePrimaryFacts,
  path: string,
): AnalysisError => {
  const { cause, origin } = facts;
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
      cause,
    });
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (cause instanceof BinaryResourceFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      cause.boundary === "search" ? "cpu" : "memory",
      `Selected artifact ${path}: ${cause.message}`,
      { boundary: cause.boundary, maximum_bytes: cause.maximum_bytes },
      {
        cause,
        ...fixedAllowanceOptions(
          cause.boundary === "search"
            ? "The Go build-info header-search allowance"
            : cause.boundary === "build-info"
              ? "The Go build-info string allowance"
              : "The Go structural decoding allowance",
          cause.boundary === "search" ? "work" : "parser",
        ),
      },
    );
  if (cause instanceof BinaryFormatFailure)
    return cause.kind === "unsupported"
      ? new AnalysisUnsupportedTargetError(OPERATION, path, cause.message, {
          cause,
        })
      : new AnalysisInputError(OPERATION, { cause }, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `Selected artifact ${path}: ${cause.message}`,
          },
        ]);
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        cause.message,
        { maximum_input_bytes: INPUT_BYTES },
        {
          cause,
          remediationAction: `Select a suitable stable artifact within the reported ${String(INPUT_BYTES)}-byte input byte allowance. This release has no runtime override. Do not truncate required bytes; retrying the unchanged oversized input will fail again.`,
        },
      );
    if (cause.reason === "path")
      return new AnalysisInputError(OPERATION, { cause }, [
        { path: ["path"], reason: "invalid_format", message: cause.message },
      ]);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
        cause,
      });
    if (isSelectedRegularFileError(cause))
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected artifact could not be read (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(GO_BINARY_PROVIDER_IDENTITY.id, OPERATION, {
    cause,
    diagnostics: {
      path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const failureFor = (cause: unknown, path: string): AnalysisError => {
  const primary = failureForPrimary(artifactFilePrimaryFacts(cause), path);
  return projectStableArtifactFailure(
    cause,
    primary,
    path,
    GO_BINARY_PROVIDER_IDENTITY.id,
    OPERATION,
  );
};

const outputLimit = (path: string) =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "transport",
    `Complete Go metadata for ${path} exceeds the inline output budget; no partial success is returned.`,
    { maximum_output_bytes: OUTPUT_BYTES },
    fixedAllowanceOptions("The Go complete-report allowance", "report"),
  );

/** Fixed reader boundaries plus unknowns left by the observed metadata. */
const limitationsFor = (
  info: GoBinaryImage["build_info"],
  sectionNamesLimitation: string | undefined,
): string[] => [
  "Embedded build metadata is observed file content, not proof of compiler identity, dependency authenticity or runtime behavior.",
  "Only Go build information is inspected; function names, source mappings, type metadata and decompiled code are not recovered.",
  "Resource guards bound stable artifact reads and cumulative header searches to 256 MiB each, aggregate embedded strings to 1 MiB, structural table decoding to 16 MiB and complete metadata payloads to 8 MiB; these are not operating-system memory or CPU limits.",
  ...(info !== null && (info.go_version === null || info.module_text === null)
    ? [
        "Some embedded Go strings contain non-UTF8 bytes; undecodable text is null and exact source bytes are preserved as base64.",
      ]
    : []),
  ...(info === null
    ? [
        "No recognized Go build-info record was found in the inspected image; absent metadata does not establish that the binary is not Go.",
      ]
    : []),
  ...(sectionNamesLimitation === undefined ? [] : [sectionNamesLimitation]),
  ...(info !== null && info.module.main === null
    ? [
        "Dependency coverage is unknown because no main-module record was decoded from the embedded module information, as in GOPATH-mode builds. Decoded dependency records remain visible; an empty list does not establish the absence of dependencies.",
      ]
    : []),
  ...(info?.module.complete === false
    ? [
        "Some embedded module-text records could not be parsed completely; their original lines are preserved and additional metadata remains unknown.",
      ]
    : []),
];

/** Locate image-relative build-info ranges in the selected file. */
const inFile = (
  info: GoBinaryImage["build_info"],
  fileOffset: number,
): GoBinaryImage["build_info"] =>
  info === null || fileOffset === 0
    ? info
    : {
        ...info,
        header_offset: info.header_offset + fileOffset,
        version_location: {
          ...info.version_location,
          offset: info.version_location.offset + fileOffset,
        },
        module_location: {
          ...info.module_location,
          offset: info.module_location.offset + fileOffset,
        },
      };

/** Stable in-process metadata inspection without subprocesses, temporary files or Go installation. */
export class GoBinaryProvider implements GoBinaryPort {
  readonly identity = GO_BINARY_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        GO_BINARY_PROVIDER_IDENTITY.id,
        OPERATION,
      );
    }
  }

  /** Read complete compiler/module metadata while preserving original byte identity and source ranges. */
  async inspect(
    input: Omit<InspectGoBinaryInput, "detail">,
    options?: ExecutionOptions,
  ): Promise<Result<GoBinary, AnalysisError>> {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          INPUT_BYTES,
          options?.signal,
          undefined,
          this.#resources,
        );
        assertArtifactReadActive(options?.signal);
        const selected = requireSelectedNativeImage(
          OPERATION,
          input.path,
          snapshot.bytes,
          input.architecture,
        );
        const image = readGoBinaryImage(selected.bytes);
        const {
          section_names_limitation: sectionNamesLimitation,
          ...publicImage
        } = image;
        const info = inFile(image.build_info, selected.fileOffset);
        const report = {
          ...publicImage,
          artifact: {
            path: input.path,
            sha256: snapshot.sha256,
            bytes: snapshot.bytes.length,
          },
          ...(selected.selection === null
            ? {}
            : { selected_slice: selected.selection }),
          build_info: info,
          limitations: limitationsFor(info, sectionNamesLimitation),
        };
        if (Buffer.byteLength(JSON.stringify(report), "utf8") > OUTPUT_BYTES)
          throw outputLimit(input.path);
        const parsed = goBinarySchema.safeParse(report);
        if (!parsed.success)
          throw new AnalysisOutputError(
            OPERATION,
            "Go reader produced invalid source ranges or report values.",
            { cause: parsed.error },
          );
        assertArtifactReadActive(options?.signal);
        return ok(parsed.data);
      });
    } catch (cause: unknown) {
      return err(failureFor(cause, input.path));
    }
  }
}
