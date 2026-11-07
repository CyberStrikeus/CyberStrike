import { isSelectedRegularFileError } from "../filesystem/RegularFile.js";
import { Il2cppBinaryFormatFailure } from "./Il2cppBinaryFormat.js";
import { Il2cppMetadataFormatFailure } from "./Il2cppMetadataFormat.js";
import type { AnalysisPartialObservation } from "../domain/analysisErrorBase.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { setImmediate } from "node:timers/promises";
import {
  readStableArtifact,
  type StableArtifactSnapshot,
} from "../artifacts/readStableArtifact.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCompletion,
  bindArtifactFileCleanup,
  artifactFileCancellationCause,
  assertArtifactReadActive,
} from "../artifacts/ArtifactFileOperation.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { Il2cppMetadataPort } from "../application/il2cpp/Il2cppMetadataPort.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { createEvidence } from "../domain/evidence.js";
import { createIl2cppMetadataAdmission } from "./Il2cppMetadataAdmission.js";
import { hexAddress as hex } from "./Il2cppBinaryImage.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  il2cppMetadataSchema,
  type Il2cppMetadata,
  type Il2cppMetadataProviderInput,
} from "../domain/il2cpp/il2cppMetadata.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  readIl2cppMetadataForLinkingSteps,
  readIl2cppMetadataSteps,
  type Il2cppMetadataRowCounts,
} from "./Il2cppMetadataFile.js";
import {
  linkIl2cppBinarySteps,
  type Il2cppBinaryLink,
} from "./Il2cppBinaryFile.js";

/** Bundled format reader identity; the metadata version is a separate observed fact. */
export const IL2CPP_METADATA_PROVIDER_IDENTITY = {
  id: "il2cpp-metadata",
  name: "REA IL2CPP global-metadata reader",
  version: "1",
} as const;
const OPERATION = "inspect_il2cpp_metadata";
const INPUT_BYTES = 256 * 1024 * 1024;
// GameAssembly binaries of large games reach several hundred megabytes.
const BINARY_BYTES = 1024 * 1024 * 1024;
// A 12.9 MB Unity 6000.4 file with 112,232 methods serializes to 7.8 MB.
const OUTPUT_BYTES = 64 * 1024 * 1024;
/** Instruction form the module-array fallback matched, per architecture. */
const inferredReferenceForm = (architecture: string) =>
  architecture === "arm64"
    ? "an adjacent ADRP+ADD pair"
    : "RIP-relative LEA/MOV";
const failureForPrimary = (
  facts: ArtifactFilePrimaryFacts,
  path: string,
  field: "path" | "binary_path" = "path",
  maximum = INPUT_BYTES,
  metadataPath = path,
): AnalysisError => {
  const { cause, origin } = facts;
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (cause instanceof Il2cppBinaryFormatFailure && cause.kind === "capacity")
    return new AnalysisResourceConstraintError(
      OPERATION,
      cause.reason === "native-type-text-capacity" ? "memory" : "capacity",
      cause.message,
      {},
      {
        cause,
        ...fixedAllowanceOptions(
          "The IL2CPP native-link allowance",
          cause.reason === "native-type-text-capacity" ? "parser" : "count",
        ),
      },
    );
  if (
    cause instanceof Il2cppBinaryFormatFailure ||
    cause instanceof Il2cppMetadataFormatFailure
  ) {
    const binary = cause instanceof Il2cppBinaryFormatFailure;
    // Metadata names are read on demand while linking, so a metadata failure
    // can surface while path still names the binary.
    const target = binary ? path : metadataPath;
    return cause.kind === "unsupported"
      ? new AnalysisUnsupportedTargetError(OPERATION, target, cause.message, {
          cause,
        })
      : new AnalysisInputError(OPERATION, { cause }, [
          {
            path: [binary ? field : "path"],
            reason: "invalid_format",
            message: binary
              ? `Selected binary ${target} does not link to the metadata: ${cause.message}`
              : `Selected artifact ${target} is corrupt: ${cause.message}`,
          },
        ]);
  }
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
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  ) {
    if (cause.reason === "limit")
      return new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        cause.message,
        { maximum_input_bytes: maximum },
        {
          cause,
          ...fixedAllowanceOptions("the fixed IL2CPP input allowance", "input"),
        },
      );
    if (cause.reason === "path")
      return new AnalysisInputError(OPERATION, { cause }, [
        { path: [field], reason: "invalid_format", message: cause.message },
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
          path: [field],
          reason: "invalid_value",
          message: `Selected artifact could not be read (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(
    IL2CPP_METADATA_PROVIDER_IDENTITY.id,
    OPERATION,
    {
      cause,
      diagnostics: {
        path,
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    },
  );
};

const failureFor = (
  cause: unknown,
  path: string,
  field: "path" | "binary_path" = "path",
  maximum = INPUT_BYTES,
  metadataPath = path,
): AnalysisError => {
  const primary = failureForPrimary(
    artifactFilePrimaryFacts(cause),
    path,
    field,
    maximum,
    metadataPath,
  );
  if (
    cause instanceof ArtifactReaderFailure &&
    cause.partialObservation !== undefined &&
    primary.partialObservation === undefined
  )
    primary.retainPartialObservation(cause.partialObservation);
  if (!(cause instanceof ArtifactReaderFailure) || cause.cleanup === undefined)
    return primary;
  const cleanup = new ProviderCleanupError(
    IL2CPP_METADATA_PROVIDER_IDENTITY.id,
    cause.cleanup.resources,
    { reason: cause.cleanup.reason },
    { operation: OPERATION, cause },
  );
  const error = analysisErrorWithCleanupFailure(primary, cleanup, OPERATION);
  bindArtifactFileCleanup(cause, error);
  return error;
};

/** Report fields for a linked binary, with addresses as exact hexadecimal strings. */
const binaryReport = (
  link: Il2cppBinaryLink,
  artifact: { path: string; sha256: string; bytes: number },
) => ({
  binary: {
    artifact,
    format: link.format,
    architecture: link.architecture,
    image_base: hex(link.image_base),
    code_gen_modules_field:
      link.code_gen_modules_field === null
        ? null
        : hex(link.code_gen_modules_field),
    code_gen_modules_array: hex(link.code_gen_modules_array),
    code_gen_modules: link.code_gen_modules.map((module) => ({
      image: module.image,
      address: hex(module.address),
      method_pointer_count: module.method_pointer_count,
    })),
    types_field: link.types_field === null ? null : hex(link.types_field),
    types_count: link.types_count,
    generic_methods:
      link.generic_methods === null
        ? null
        : {
            generic_method_pointers_field:
              link.generic_methods.generic_method_pointers_field === null
                ? null
                : hex(link.generic_methods.generic_method_pointers_field),
            generic_method_pointers_count:
              link.generic_methods.generic_method_pointers_count,
            generic_method_table: hex(
              link.generic_methods.generic_method_table,
            ),
            generic_method_table_count:
              link.generic_methods.generic_method_table_count,
            generic_method_table_stride:
              link.generic_methods.generic_method_table_stride,
            method_specs_count: link.generic_methods.method_specs_count,
            generic_insts_count: link.generic_methods.generic_insts_count,
            issues: link.generic_methods.issues,
          },
  },
  return_types: link.return_types,
  field_types: link.field_types,
  parameter_types: link.parameter_types,
  method_addresses: link.method_addresses,
  generic_method_instances: link.generic_methods?.instances ?? null,
});

/**
 * Source facts stay on the refusal. The shared report sentence would deny an
 * Evidence record that this reader attaches and MCP retains.
 */
const completeReportRecovery =
  "The IL2CPP complete-report allowance is a fixed report allowance. No complete metadata inventory is retained. Source facts already observed stay with this refusal, and complete CLI JSON does not raise the allowance. Repeating the unchanged request fails the same way.";

const reportLimit = (path: string, maximumBytes: number) =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "memory",
    `Complete IL2CPP metadata for ${path} exceeds the retained report budget; no complete inventory is retained.`,
    { maximum_report_bytes: maximumBytes },
    { retryable: false, remediationAction: completeReportRecovery },
  );

const sourceArtifact = (path: string, snapshot: StableArtifactSnapshot) => ({
  path,
  sha256: snapshot.sha256,
  bytes: snapshot.bytes.length,
});

/** Source identity survives a failed inventory without claiming decoded coverage. */
const metadataSourceEvidence = (
  artifact: Il2cppMetadata["artifact"],
  counts: Il2cppMetadataRowCounts | undefined,
  binary:
    | {
        path: string;
        architecture?: string;
        genericInstances?: boolean;
        artifact?: Il2cppMetadata["artifact"];
      }
    | undefined = undefined,
  previous?: AnalysisPartialObservation,
) =>
  createEvidence(
    {
      path: artifact.path,
      sha256: artifact.sha256,
      format: "file",
    },
    IL2CPP_METADATA_PROVIDER_IDENTITY,
    {
      operation: "observe_il2cpp_metadata_source",
      predicateType: "rea.il2cpp-metadata-source",
      parameters: {
        path: artifact.path,
        ...(binary === undefined
          ? {}
          : {
              binary_path: binary.path,
              ...(binary.architecture === undefined
                ? {}
                : { binary_architecture: binary.architecture }),
              ...(binary.genericInstances === true
                ? { generic_instances: true }
                : {}),
            }),
      },
      result: {
        artifact,
        inventory_status: "not-returned-as-complete",
        ...(binary === undefined
          ? {}
          : {
              selected_binary: {
                path: binary.path,
                identity_status:
                  binary.artifact === undefined ? "unavailable" : "observed",
                ...(binary.artifact === undefined
                  ? {}
                  : {
                      sha256: binary.artifact.sha256,
                      bytes: binary.artifact.bytes,
                    }),
                ...(binary.architecture === undefined
                  ? {}
                  : { architecture: binary.architecture }),
              },
            }),
        ...(previous === undefined
          ? {}
          : { upstream_partial_observation: jsonValueSchema.parse(previous) }),
        ...(counts === undefined
          ? {}
          : { validated_section_row_counts: { ...counts } }),
      },
      confidence: "observed",
      limitations: [
        "This partial source observation does not contain a complete metadata inventory. Section row counts, when available, are derived from the validated header extents and record layout; names and relationships may remain unexamined.",
      ],
      locations: [
        { kind: "artifact-path", path: artifact.path },
        {
          kind: "file-offset-range",
          start: 0,
          end: artifact.bytes,
        },
      ],
    },
  );

/** Stable in-process decoding without subprocesses, temporary files, native binaries or decryption. */
export class Il2cppMetadataProvider implements Il2cppMetadataPort {
  readonly identity = IL2CPP_METADATA_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();
  #inspecting = false;
  /** `close()` stops admission permanently, including while an inspection is active. */
  #admissionStopped = false;

  /** `outputBytes` exists so tests can reach the guard with small files. */
  constructor(
    private readonly outputBytes: number = OUTPUT_BYTES,
    private readonly yieldControl: () => Promise<void> = setImmediate,
  ) {}

  async close(): Promise<void> {
    this.#admissionStopped = true;
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      if (
        !(cause instanceof ArtifactReaderFailure) ||
        cause.cleanup === undefined
      )
        throw cause;
      const error = new ProviderCleanupError(
        IL2CPP_METADATA_PROVIDER_IDENTITY.id,
        cause.cleanup.resources,
        { reason: cause.cleanup.reason },
        { cause, operation: OPERATION },
      );
      bindArtifactFileCleanup(cause, error);
      throw error;
    }
  }

  /** Read every image, type and method name from one stable file snapshot. */
  async inspect(
    input: Il2cppMetadataProviderInput,
    options?: ExecutionOptions,
  ): Promise<Result<Il2cppMetadata, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    if (this.#admissionStopped)
      return err(
        new AnalysisCapabilityUnavailableError(
          IL2CPP_METADATA_PROVIDER_IDENTITY.id,
          OPERATION,
          "IL2CPP metadata reader is closed",
          {
            remediationAction:
              "This reader has stopped admitting inspections. Create a new IL2CPP metadata reader to inspect again. Repeating the request on this reader fails the same way.",
          },
        ),
      );
    if (this.#inspecting)
      return err(
        new AnalysisResourceConstraintError(
          OPERATION,
          "capacity",
          "Only one IL2CPP metadata inspection is admitted per reader.",
          { maximum_concurrent_inspections: 1 },
          {
            remediationAction:
              "Retry after the active IL2CPP metadata inspection on this reader completes.",
          },
        ),
      );
    this.#inspecting = true;
    const observed: {
      artifact?: Il2cppMetadata["artifact"];
      counts?: Il2cppMetadataRowCounts;
      binary?: Il2cppMetadata["artifact"];
    } = {};
    const selectedBinarySource = () =>
      input.binary_path === undefined
        ? undefined
        : {
            path: input.binary_path,
            ...(input.binary_architecture === undefined
              ? {}
              : { architecture: input.binary_architecture }),
            ...(input.generic_instances === true
              ? { genericInstances: true }
              : {}),
            ...(observed.binary === undefined
              ? {}
              : { artifact: observed.binary }),
          };
    try {
      return await this.#resources.run(async () => {
        const snapshot = await this.#readArtifact(
          input.path,
          INPUT_BYTES,
          options?.signal,
          (artifact) => {
            observed.artifact = artifact;
          },
        );
        const artifact = sourceArtifact(input.path, snapshot);
        observed.artifact = artifact;
        assertArtifactReadActive(options?.signal);
        const limit = this.outputBytes;
        const admission = createIl2cppMetadataAdmission(
          limit,
          () => {
            throw reportLimit(input.path, limit);
          },
          input.binary_path !== undefined,
        );
        const readMetadata =
          input.binary_path === undefined
            ? readIl2cppMetadataSteps
            : readIl2cppMetadataForLinkingSteps;
        const steps = readMetadata(snapshot.bytes, {
          ...admission,
          beforeRows: (counts) => {
            observed.counts = counts;
            admission.beforeRows(counts);
          },
        });
        let step = steps.next();
        while (!step.done) {
          await this.yieldControl();
          assertArtifactReadActive(options?.signal);
          step = steps.next();
        }
        const value = step.value;
        const decoded = "metadata" in value ? value.metadata : value;
        const link = "metadata" in value ? value.link : undefined;
        const binaryPath = input.binary_path;
        let linked: Pick<
          Il2cppMetadata,
          | "binary"
          | "method_addresses"
          | "return_types"
          | "field_types"
          | "parameter_types"
          | "generic_method_instances"
        > = {
          binary: null,
          method_addresses: [],
          return_types: [],
          field_types: [],
          parameter_types: [],
          generic_method_instances: null,
        };
        if (binaryPath !== undefined) {
          if (link === undefined)
            throw new AnalysisOutputError(
              OPERATION,
              "Native linking facts were not retained for the selected binary.",
            );
          try {
            const binary = await this.#readArtifact(
              binaryPath,
              BINARY_BYTES,
              options?.signal,
              (artifact) => {
                observed.binary = artifact;
              },
            );
            assertArtifactReadActive(options?.signal);
            const linking = linkIl2cppBinarySteps(
              binary.bytes,
              decoded,
              link,
              input.binary_architecture,
              {
                ...admission,
                genericInstances: input.generic_instances === true,
              },
            );
            let linkStep = linking.next();
            while (!linkStep.done) {
              await this.yieldControl();
              assertArtifactReadActive(options?.signal);
              linkStep = linking.next();
            }
            linked = binaryReport(linkStep.value, {
              path: binaryPath,
              sha256: binary.sha256,
              bytes: binary.bytes.length,
            });
          } catch (cause: unknown) {
            const failure = failureFor(
              cause,
              binaryPath,
              "binary_path",
              BINARY_BYTES,
              input.path,
            );
            failure.partialObservation = metadataSourceEvidence(
              artifact,
              observed.counts,
              selectedBinarySource(),
              failure.partialObservation,
            );
            return err(failure);
          }
        }
        const report = {
          ...decoded,
          ...linked,
          artifact,
          limitations: [
            "Only unencrypted global-metadata.dat versions 24, 27, 29, 31 and 39 are decoded; names, counts and string literals are observed file content, not runtime behavior.",
            binaryPath === undefined
              ? "Native code addresses and IL2CPP binary registration are not recovered without binary_path."
              : `Method addresses come from the binary's code-generation module methodPointers, matched by module name, method count and metadata token; ${input.generic_instances === true ? "" : "generic method instances (see generic_instances), "}adjustor thunks and invokers are not linked, no-body means an observed zero slot, and unknown means no module claimed the method or its slot has an unresolved relocation.`,
            ...(binaryPath !== undefined && input.generic_instances === true
              ? [
                  "Generic method instances come from genericMethodTable, methodSpecs, genericInsts and genericMethodPointers, with names following Il2CppDumper's GetMethodSpecName (namespace on the declaring type, nested types joined with '.', arity cut, IntPtr/UIntPtr, no byref mark). The CodeRegistration layout is the only one of the known 27.0 to 31 layouts whose counts bound every genericMethodTable row; metadata versions 24 and 39 and builds without a static CodeRegistration are refused. A generic row is no-body for an observed zero pointer slot and unknown, with no address, exactly when an issue names its row: a contradicting method spec (its name is then null), a shared method spec, an unmapped or non-executable pointer, or an unresolved relocation.",
                ]
              : []),
            binaryPath === undefined
              ? "Field, parameter and return types are not recovered without binary_path; type indices refer to the native binary."
              : decoded.metadata_version === 27
                ? "Field, parameter and return type names are null for metadata version 27: versions 27.0 to 27.2 share that header number but place the Il2CppType byref flag differently, so a name could gain or lose & without warning; type indices are still reported."
                : "Field, parameter and return type names are rendered from the binary's Il2CppType table in a C#-like form (keywords for primitives, Namespace.Outer+Inner, generic parameters by metadata name); nested generic arguments stay with the type component that declares them. An unresolved type-table slot retains its type index with a null name; a loader-unresolved value inside the type graph is refused rather than rendered from stored placeholder bytes. Custom modifiers, array bounds and attributes are not reported.",
            ...(linked.binary !== null &&
            linked.binary.code_gen_modules_field === null
              ? [
                  `The static CodeRegistration pair was not resolved. The module array is inferred from executable bytes consistent with ${inferredReferenceForm(linked.binary.architecture)} referencing one array candidate; instruction boundaries and runtime use were not verified.`,
                ]
              : []),
            ...(linked.binary !== null && linked.binary.types_field === null
              ? [
                  `No static MetadataRegistration had the type-definition counts. The type table is inferred from executable bytes consistent with ${inferredReferenceForm(linked.binary.architecture)} referencing the one run of Il2CppType-shaped pointers long enough for every referenced type index; types_count is that run's length, at least every referenced type index but not an observed typesCount, and instruction boundaries and runtime use were not verified.`,
                ]
              : []),
            ...(binaryPath === undefined
              ? []
              : [
                  "The binary/metadata pair is caller-selected. Module name/count/token agreement is structural evidence, not a cryptographic proof that both files come from the same build.",
                ]),
            "declaring_type for types is derived from the nestedTypes section, and member and parameter owners from the owners' index ranges; row positions are the metadata indices.",
          ],
        };
        if (jsonValueByteLength(report, limit) > limit)
          throw reportLimit(input.path, limit);
        const parsed = il2cppMetadataSchema.safeParse(report);
        if (!parsed.success)
          throw new AnalysisOutputError(
            OPERATION,
            "IL2CPP metadata reader produced invalid section ranges or report values.",
            { cause: parsed.error },
          );
        assertArtifactReadActive(options?.signal);
        return ok(parsed.data);
      });
    } catch (cause: unknown) {
      const failure = failureFor(cause, input.path);
      if (observed.artifact !== undefined)
        failure.partialObservation = metadataSourceEvidence(
          observed.artifact,
          observed.counts,
          selectedBinarySource(),
          failure.partialObservation,
        );
      return err(failure);
    } finally {
      this.#inspecting = false;
    }
  }
  async #readArtifact(
    path: string,
    maximum: number,
    signal: AbortSignal | undefined,
    observe: (artifact: Il2cppMetadata["artifact"]) => void,
  ): Promise<StableArtifactSnapshot> {
    try {
      const snapshot = await readStableArtifact(
        path,
        maximum,
        signal,
        undefined,
        this.#resources,
      );
      observe(sourceArtifact(path, snapshot));
      return snapshot;
    } catch (cause) {
      const completion = artifactFileCompletion(cause);
      if (completion !== undefined)
        observe(
          sourceArtifact(path, completion.value as StableArtifactSnapshot),
        );
      throw cause;
    }
  }
}
