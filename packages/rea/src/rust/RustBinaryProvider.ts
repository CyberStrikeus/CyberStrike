import {
  projectStableArtifactFailure,
  projectArtifactCloseFailure,
} from "../artifacts/StableArtifactFailure.js";
import { isSelectedRegularFileError } from "../filesystem/RegularFile.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
  assertArtifactReadActive,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { RustBinaryPort } from "../application/rust/RustBinaryPort.js";
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
  RUST_AUDITABLE_FORMAT_VERSIONS,
  rustBinarySchema,
  type InspectRustBinaryInput,
  type RustBinary,
} from "../domain/rust/rustBinary.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  readRustBinaryImage,
  type RustBinaryImage,
} from "./RustBinaryImage.js";
import { requireSelectedNativeImage } from "../native/metadata/MachoSliceSelection.js";
import {
  RUST_BINARY_INPUT_BYTES,
  RUST_OUTPUT_BYTES,
  RustAuditableFormatFailure,
  RustAuditableResourceFailure,
} from "./RustAuditableReader.js";

/** Bundled reader identity. Embedded package versions are separate observed facts. */
export const RUST_BINARY_PROVIDER_IDENTITY = {
  id: "rust-auditable",
  name: "REA Rust dependency reader",
  version: "1",
} as const;
const OPERATION = "inspect_rust_binary";

/** Stable in-process dependency inspection without subprocesses, temporary files, or a Rust toolchain. */
export class RustBinaryProvider implements RustBinaryPort {
  readonly identity = RUST_BINARY_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();

  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw projectArtifactCloseFailure(
        cause,
        RUST_BINARY_PROVIDER_IDENTITY.id,
        OPERATION,
      );
    }
  }

  /** Read one dependency section and any inferred rustc commit from the selected file. */
  async inspect(
    input: InspectRustBinaryInput,
    options?: ExecutionOptions,
  ): Promise<Result<RustBinary, AnalysisError>> {
    try {
      return await this.#resources.run(async () => {
        const snapshot = await readStableArtifact(
          input.path,
          RUST_BINARY_INPUT_BYTES,
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
        const image = inFile(
          readRustBinaryImage(selected.bytes),
          selected.fileOffset,
        );
        const report = {
          format: image.format,
          architecture: image.architecture,
          bits: image.bits,
          byte_order: image.byte_order,
          auditable_metadata: image.auditable_metadata,
          rustc_commit: image.rustc_commit,
          artifact: {
            path: input.path,
            sha256: snapshot.sha256,
            bytes: snapshot.bytes.length,
          },
          ...(selected.selection === null
            ? {}
            : { selected_slice: selected.selection }),
          limitations: limitationsFor(image),
        };
        if (
          Buffer.byteLength(JSON.stringify(report), "utf8") > RUST_OUTPUT_BYTES
        )
          throw outputLimit(input.path);
        const parsed = rustBinarySchema.safeParse(report);
        if (!parsed.success)
          throw new AnalysisOutputError(
            OPERATION,
            "Rust reader produced an invalid dependency report.",
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

/** Locate image-relative section and rustc-path offsets in the selected file. */
const inFile = (image: RustBinaryImage, fileOffset: number): RustBinaryImage =>
  fileOffset === 0
    ? image
    : {
        ...image,
        auditable_metadata:
          image.auditable_metadata === null
            ? null
            : {
                ...image.auditable_metadata,
                file_offset: image.auditable_metadata.file_offset + fileOffset,
              },
        rustc_commit:
          image.rustc_commit === null
            ? null
            : {
                ...image.rustc_commit,
                hashes: image.rustc_commit.hashes.map((entry) => ({
                  ...entry,
                  file_offset: entry.file_offset + fileOffset,
                })),
              },
      };

const outputLimit = (path: string) =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "transport",
    `Complete Rust metadata for ${path} exceeds the inline output budget; no partial success is returned.`,
    { maximum_output_bytes: RUST_OUTPUT_BYTES },
    fixedAllowanceOptions("The Rust complete-report allowance", "report"),
  );

const limitationsFor = (
  image: ReturnType<typeof readRustBinaryImage>,
): string[] => [
  "Embedded dependency metadata is file content. It does not authenticate package names, versions, sources, or the compiler that produced the binary.",
  "Only the .dep-v0 dependency section and read-only compiler path strings are inspected. Functions, types, and runtime behavior are not recovered.",
  "Resource guards bound the selected file to 256 MiB, a dependency section to 1 MiB, inflated JSON to the smaller of 8 MiB and 64 times the section size, and the complete report to 8 MiB. Package and dependency counts are admitted against that output budget before schema cloning, graph objects, or reverse-edge allocation.",
  ...(image.section_names_limitation === undefined
    ? []
    : [image.section_names_limitation]),
  ...(image.auditable_metadata === null &&
  image.section_names_limitation === undefined
    ? [
        "No .dep-v0 section was found. Absence of .dep-v0 does not mean the binary has no dependencies.",
      ]
    : []),
  ...(image.auditable_metadata === null &&
  image.section_names_limitation !== undefined
    ? [
        "The presence of .dep-v0 could not be determined because ELF section names are unavailable.",
      ]
    : []),
  ...unknownFormatLimitation(image.auditable_metadata?.format_version),
  ...(image.auditable_metadata?.packages.some((pkg) => pkg.kind === null)
    ? [
        "An omitted package kind is left null. The embedded format treats an omitted kind as runtime, and that default was not stored in the section.",
      ]
    : []),
  ...(image.auditable_metadata !== null &&
  image.auditable_metadata.cyclic_dependency_indices.length > 0
    ? [
        "Dependency indices contain a cycle. The cycle is reported and was not traversed.",
      ]
    : []),
  ...rustcLimitation(image.rustc_commit),
];

const unknownFormatLimitation = (
  format: number | null | undefined,
): string[] => {
  if (format === null || format === undefined) return [];
  let preceding = 0;
  for (const known of RUST_AUDITABLE_FORMAT_VERSIONS) {
    if (known === format) return [];
    if (known < format) preceding = known;
  }
  return [
    `cargo-auditable format revision ${format} is unknown. Its schema directs readers to interpret it using the highest known preceding revision (${preceding}); this specific revision has not been independently verified.`,
  ];
};

const rustcLimitation = (
  commit: ReturnType<typeof readRustBinaryImage>["rustc_commit"],
): string[] => {
  if (commit === null)
    return [
      "No /rustc/<40-hex>/ path was found in read-only data, so a rustc commit hash is unknown.",
    ];
  if (commit.hashes.length === 1)
    return [
      "The rustc commit hash is inferred from a /rustc/<40-hex>/ path in read-only data. It does not by itself prove which compiler produced the binary.",
    ];
  return [
    "Read-only data contains more than one /rustc/<40-hex>/ path, so a single rustc commit is unknown.",
  ];
};

const failureForPrimary = (
  facts: ArtifactFilePrimaryFacts,
  path: string,
): AnalysisError => {
  const { cause, origin } = facts;
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (cause instanceof RustAuditableResourceFailure)
    return new AnalysisResourceConstraintError(
      OPERATION,
      cause.constraint.resource,
      `Selected artifact ${path}: ${cause.message}`,
      cause.constraint.reported_limits,
      {
        cause,
        ...fixedAllowanceOptions(
          cause.constraint.resource === "capacity"
            ? "The rustc commit-path inventory"
            : cause.constraint.resource === "transport"
              ? "The Rust complete-report allowance"
              : "This Rust inspection allowance",
          cause.constraint.resource === "capacity"
            ? "count"
            : cause.constraint.resource === "transport"
              ? "report"
              : "parser",
        ),
      },
    );
  if (cause instanceof RustAuditableFormatFailure)
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
  return artifactFailure(facts, path);
};

const failureFor = (cause: unknown, path: string): AnalysisError => {
  const primary = failureForPrimary(artifactFilePrimaryFacts(cause), path);
  return projectStableArtifactFailure(
    cause,
    primary,
    path,
    RUST_BINARY_PROVIDER_IDENTITY.id,
    OPERATION,
  );
};

const artifactFailure = (
  facts: ArtifactFilePrimaryFacts,
  path: string,
): AnalysisError => {
  const { cause, origin } = facts;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  )
    return artifactReaderFailure(cause, path);
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
  return new ProviderAdapterError(RUST_BINARY_PROVIDER_IDENTITY.id, OPERATION, {
    cause,
    diagnostics: {
      path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const artifactReaderFailure = (
  cause: ArtifactReaderFailure,
  path: string,
): AnalysisError => {
  if (cause.reason === "integrity")
    return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
      cause,
    });
  if (cause.reason === "cancelled")
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (cause.reason === "limit")
    return new AnalysisResourceConstraintError(
      OPERATION,
      "file-size",
      cause.message,
      { maximum_input_bytes: RUST_BINARY_INPUT_BYTES },
      {
        cause,
        ...fixedAllowanceOptions("the fixed Rust input allowance", "input"),
      },
    );
  if (cause.reason === "path")
    return new AnalysisInputError(OPERATION, { cause }, [
      { path: ["path"], reason: "invalid_format", message: cause.message },
    ]);
  return new ProviderAdapterError(RUST_BINARY_PROVIDER_IDENTITY.id, OPERATION, {
    cause,
    diagnostics: { path, reason: cause.message },
  });
};
