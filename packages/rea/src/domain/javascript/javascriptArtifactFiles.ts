import { z } from "zod";
import { digestSchema } from "../digests.js";
import type { JavaScriptSourceSelection } from "./javascriptSourceSelection.js";
import type { JavaScriptStaticAnalysis } from "./javascriptStaticAnalysisTypes.js";
import type {
  ArtifactInventoryCoverage,
  ArtifactOccurrence,
} from "../artifactGraph.js";

/** One physical file occurrence, independent of its graph representations. */
export const javaScriptFileOccurrenceSchema = z.strictObject({
  container_sha256: digestSchema,
  path: z.string().min(1),
  sha256: digestSchema,
});
export type JavaScriptFileOccurrence = z.infer<
  typeof javaScriptFileOccurrenceSchema
>;

/** Whether an inventoried path has a source extension read by the analyzer. */
export const isJavaScriptSourcePath = (path: string): boolean =>
  /\.(?:cjs|cts|mjs|mts|js|jsx|ts|tsx)$/iu.test(path);

/** Relevant file categories projected from the complete artifact inventory. */
export type JavaScriptArtifactFileKind =
  | "package-json"
  | "json"
  | "javascript"
  | "html"
  | "source-map"
  | "native-addon";

/** One content-addressed local artifact file and its text availability. */
export interface JavaScriptArtifactFile {
  readonly path: string;
  readonly container_sha256: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly inventory_artifact_id: string;
  readonly kind: JavaScriptArtifactFileKind;
  readonly unpacked: boolean;
  readonly text:
    | { readonly included: true; readonly value: string }
    | {
        readonly included: false;
        readonly reason:
          | "not-applicable"
          | "invalid-utf8"
          | "outside-analysis-scope";
      };
}

/** Producer text exclusions shared by full and incremental source projections. */
export const javaScriptArtifactTextExclusion = (
  file: JavaScriptArtifactFile,
): string | null => {
  if (file.text.included || file.text.reason === "not-applicable") return null;
  if (file.text.reason === "invalid-utf8" && file.kind !== "javascript")
    return null;
  return file.text.reason === "outside-analysis-scope"
    ? "Source was not analyzed because it is outside the caller-selected source_paths."
    : "Source bytes are not valid UTF-8; JavaScript semantics were not analyzed.";
};

/** Source availability shared by semantic consumers of parsed artifact facts. */
export const javaScriptSemanticSourceExclusion = (
  file: JavaScriptArtifactFile,
  parseStatus: JavaScriptStaticAnalysis["parse_status"] | null,
): string | null => {
  if (file.kind !== "javascript") return null;
  return (
    javaScriptArtifactTextExclusion(file) ??
    (parseStatus === "failed"
      ? "JavaScript syntax could not be parsed; JavaScript semantics were not analyzed."
      : null)
  );
};

/**
 * One inventoried regular file not backed by analyzed source bytes. Its inventory
 * occurrence remains available even when content is opaque or unavailable.
 */
export interface JavaScriptUnanalyzedArtifactFile {
  readonly path: string;
  readonly container_sha256: string;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly inventory_artifact_id: string | null;
  readonly inventory_occurrence_id?: string;
  readonly kind?: JavaScriptArtifactFileKind;
  readonly artifact_kind?: ArtifactOccurrence["artifact_kind"];
  readonly hash_status?:
    | "verified"
    | "mismatched"
    | "not-hashed"
    | "unavailable";
  readonly limitations?: readonly string[];
}

/** Borrowed inventory lookup; metadata is materialized only for requested paths. */
export interface JavaScriptUnanalyzedArtifactLookup {
  /** Inventory traversal coverage qualifies every negative lookup. */
  readonly coverage: ArtifactInventoryCoverage;
  get(path: string): JavaScriptUnanalyzedArtifactFile | undefined;
  hasDirectory(path: string, containerSha256: string | undefined): boolean;
}

/** One filesystem-backed ASAR nested beneath a directory input. */
export interface JavaScriptArtifactContainer {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly inventory_artifact_id: string;
}

/** Deterministic relevant-file projection plus explicit omissions. */
export interface JavaScriptArtifactFileSet {
  readonly files: readonly JavaScriptArtifactFile[];
  /** Borrowed inventory lookup for regular files the source projection does not read. */
  readonly unanalyzed_files?: JavaScriptUnanalyzedArtifactLookup;
  /** Relevant inventoried files whose bytes were unavailable. */
  readonly unavailable_relevant_files: readonly JavaScriptUnanalyzedArtifactFile[];
  readonly containers: readonly JavaScriptArtifactContainer[];
  readonly text_bytes_read: number;
  readonly invalid_utf8_files: number;
  readonly source_selection?: JavaScriptSourceSelection;
}
