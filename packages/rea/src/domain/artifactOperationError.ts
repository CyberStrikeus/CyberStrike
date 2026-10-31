import {
  projectArtifactIntegrityDetails,
  type ArtifactIntegrityDetails,
} from "./artifactIntegrity.js";
import {
  AnalysisError,
  type AnalysisErrorOptions,
} from "./analysisErrorBase.js";

/** The resource class that refused an artifact operation. */
export type ArtifactLimitBoundary = "file-size" | "capacity" | "memory";

/** Admission named by the producing reader, with its effective byte ceiling and its source. */
export interface ArtifactAdmissionLimit {
  readonly kind: "asar-header";
  readonly requiredBytes?: number;
  readonly maximumBytes: number;
  readonly source: "default" | "setting" | "runtime";
}

/** Artifact inventory or extraction failed a typed safety boundary. */
export class ArtifactOperationError extends AnalysisError {
  readonly _tag = "ArtifactOperationError";
  override readonly userMessage: string | undefined;
  readonly admission: ArtifactAdmissionLimit | undefined;
  readonly boundary: ArtifactLimitBoundary | undefined;

  constructor(
    readonly operation:
      | "inventory_artifact"
      | "inspect_artifact"
      | "inspect_desktop_application"
      | "inspect_pe_resources"
      | "inspect_pe_certificates"
      | "inspect_elf_notes"
      | "inspect_devicetree"
      | "inspect_kernel_module"
      | "inspect_erlang_beam"
      | "extract_artifact"
      | "decode_interface_builder"
      | "inspect_asset_catalog"
      | "inspect_keyed_archive"
      | "trace_dylib_resolution"
      | "export_web_scripts"
      | "trace_web_module_imports"
      | "trace_web_source_location"
      | "analyze_javascript_application",
    readonly reason:
      | "cancelled"
      | "format"
      | "integrity"
      | "limit"
      | "path"
      | "unavailable"
      | "io",
    readonly artifactDetails?: ArtifactIntegrityDetails,
    /** The specific constraint that failed, such as the colliding path. */
    readonly detail?: string,
    options?: AnalysisErrorOptions & {
      readonly userMessage?: string;
      readonly admission?: ArtifactAdmissionLimit;
      readonly boundary?: ArtifactLimitBoundary;
    },
  ) {
    super(
      artifactDetails === undefined
        ? `Artifact ${operation} failed: ${reason}`
        : artifactDetailsMessage(operation, reason, artifactDetails),
      options,
    );
    this.admission = options?.admission;
    this.boundary = options?.boundary;
    this.userMessage =
      options?.userMessage ??
      (options?.admission === undefined ? undefined : detail);
  }
}

const artifactDetailsMessage = (
  operation: string,
  reason: string,
  details: ArtifactIntegrityDetails,
): string => {
  const { logical_path, ...facts } = projectArtifactIntegrityDetails(details);
  const description = Object.entries(facts)
    .map(([key, value]) => `${key}=${String(value ?? "unavailable")}`)
    .join(", ");
  return `Artifact ${operation} failed: ${reason} at ${logical_path} (${description})`;
};
