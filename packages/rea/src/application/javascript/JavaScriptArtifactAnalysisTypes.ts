import type { JavaScriptSourceMapReference } from "../../domain/javascript/javascriptSourceMapPaths.js";
import type {
  JavaScriptSourceRange,
  JavaScriptStaticAnalysis,
} from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import type { JavaScriptModuleSemanticIr } from "../../domain/javascript/javascriptModuleSemanticIr.js";
import type {
  ExternalSourceMapSection,
  InvalidSourceMapSection,
} from "../../domain/sourceMapEnvelope.js";
import type {
  JavaScriptArtifactFile,
  JavaScriptArtifactFileKind,
} from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";

interface JavaScriptStructuredObservation {
  readonly path: string;
  readonly sha256: string;
}

/** Present source declarations only; non-strings stay bounded and retain source ownership. */
export type JavaScriptPackageRendererDeclarations = Partial<
  Record<
    "renderer" | "browser" | "module",
    string | { readonly status: "non-string" }
  >
>;

interface JavaScriptPackageValues {
  readonly name: string | null;
  readonly version: string | null;
  readonly main: string | null;
  readonly main_status: "default" | "declared" | "invalid";
  /** Node launch declaration; an empty string requests the package index fallback. */
  readonly main_entrypoint: string;
  readonly renderer_declarations: JavaScriptPackageRendererDeclarations;
  /** Selected static renderer candidate, retaining the declaration that supplied it. */
  readonly renderer_entrypoint: {
    readonly field: "renderer" | "browser" | "module";
    readonly path: string;
  } | null;
}

/** Parsed package metadata used only for static entrypoint discovery. */
export type JavaScriptPackageObservation = JavaScriptStructuredObservation &
  (
    | (JavaScriptPackageValues & {
        readonly status: "included";
        readonly limitation: null;
      })
    | {
        readonly status: "invalid" | "unavailable";
        readonly name: null;
        readonly version: null;
        readonly main: null;
        readonly main_status: "unavailable";
        readonly main_entrypoint: null;
        readonly renderer_declarations: null;
        readonly renderer_entrypoint: null;
        readonly limitation: string;
      }
  );

/** One HTML script source observed without building or executing a DOM. */
export interface JavaScriptHtmlScriptObservation {
  readonly html_path: string;
  readonly script_path: string;
  /** Parsed JavaScript type; null for data blocks or other non-JavaScript types. */
  readonly script_type: "classic" | "module" | null;
  readonly base_href: string | null;
  readonly location: JavaScriptSourceRange;
}

/** Bounded source locations for inline JavaScript bodies skipped by analysis. */
export interface JavaScriptHtmlInlineScriptsObservation {
  readonly path: string;
  readonly script_count: number;
  readonly scripts: readonly {
    readonly script_type: "classic" | "module";
    readonly location: JavaScriptSourceRange;
  }[];
}

/** One original source declared by a local source map. */
export interface JavaScriptSourceMapOriginal {
  /** Indexed-map section containing this declaration; empty for regular maps. */
  readonly section_path: readonly number[];
  /** Index within the leaf map's sources and sourcesContent arrays. */
  readonly source_index: number;
  /** Index across the flattened map's leaf declarations. */
  readonly declaration_index: number;
  readonly reference: JavaScriptSourceMapReference | null;
  readonly content: string | null;
  readonly content_sha256: string | null;
}

/** Local source-map parse result. */
export type JavaScriptSourceMapObservation = JavaScriptStructuredObservation &
  (
    | {
        readonly status: "included";
        readonly sources: readonly JavaScriptSourceMapOriginal[];
        readonly limitation: null;
      }
    | {
        readonly status: "invalid";
        readonly sources: readonly JavaScriptSourceMapOriginal[];
        readonly limitation: string;
        readonly external_sections?: readonly ExternalSourceMapSection[];
        readonly invalid_sections?: readonly InvalidSourceMapSection[];
      }
  );

/** Parse status for one inventoried JSON module. */
export type JavaScriptJsonModuleObservation = JavaScriptStructuredObservation &
  (
    | {
        readonly status: "included";
        readonly top_level_keys: readonly string[];
        readonly omitted_top_level_keys: number;
        readonly limitation: null;
      }
    | {
        readonly status: "invalid";
        readonly top_level_keys: readonly [];
        readonly omitted_top_level_keys: 0;
        readonly limitation: string;
      }
    | {
        readonly status: "unavailable";
        readonly top_level_keys: readonly [];
        readonly omitted_top_level_keys: null;
        readonly limitation: string;
      }
  );

/** Applicable processing of inventoried files; native bytes remain metadata-only. */
export const javascriptArtifactAnalysisScopes = {
  javascript: {
    operation: "analyze-javascript-source",
    authority: "ast-static-analysis",
  },
  "package-json": {
    operation: "parse-package-json",
    authority: "artifact-bytes",
  },
  json: { operation: "parse-json-module", authority: "artifact-bytes" },
  html: {
    operation: "parse-html-script-references",
    authority: "artifact-bytes",
  },
  "source-map": {
    operation: "parse-local-source-map",
    authority: "artifact-bytes",
  },
  "native-addon": null,
} as const satisfies Record<
  JavaScriptArtifactFileKind,
  {
    readonly operation: string;
    readonly authority: "artifact-bytes" | "ast-static-analysis";
  } | null
>;

export type JavaScriptArtifactAnalysisScope = NonNullable<
  (typeof javascriptArtifactAnalysisScopes)[JavaScriptArtifactFileKind]
>;

/** A processing gap preserves applicability and whether the phase was entered. */
export interface JavaScriptArtifactAnalysisFailure {
  readonly scope: JavaScriptArtifactAnalysisScope;
  readonly status: "interrupted" | "not-started";
  readonly reason: string;
  readonly error: JsonValue;
  readonly limits: Readonly<Record<string, JsonValue>> | null;
}

/** One relevant file and the module facts retained after file-local projection. */
export interface AnalyzedJavaScriptArtifactFile {
  readonly file: JavaScriptArtifactFile;
  readonly javascript: JavaScriptStaticAnalysis | null;
  readonly semantic: {
    readonly ir: JavaScriptModuleSemanticIr;
  } | null;
  /** Operational incompleteness, distinct from a malformed source file. */
  readonly analysis_failure?: JavaScriptArtifactAnalysisFailure;
  /** Facts retained inline when their expanded graph exceeds available memory. */
  readonly application_projection_failure?: {
    readonly reason: string;
    readonly error: JsonValue;
    readonly limits: Readonly<Record<string, JsonValue>> | null;
  };
}

/**
 * A JavaScript source selected for analysis whose worker produced no facts.
 * The analysis failure carries the reason; the null parse status alone reads
 * as "nothing there" instead of "not analyzed".
 */
export const isSkippedJavaScriptAnalysis = (
  entry: Pick<
    AnalyzedJavaScriptArtifactFile,
    "file" | "javascript" | "analysis_failure"
  >,
): boolean =>
  entry.file.kind === "javascript" &&
  entry.file.text.included &&
  entry.javascript === null &&
  entry.analysis_failure !== undefined;

/** Retained source facts shared by application graph construction. */
export interface JavaScriptArtifactAnalysis {
  /** Internal source-facts owner shared with graph path resolution. */
  readonly jsonDocuments: JavaScriptJsonDocuments;
  readonly files: readonly AnalyzedJavaScriptArtifactFile[];
  readonly packages: readonly JavaScriptPackageObservation[];
  readonly json_modules: readonly JavaScriptJsonModuleObservation[];
  readonly html_scripts: readonly JavaScriptHtmlScriptObservation[];
  readonly html_inline_scripts: readonly JavaScriptHtmlInlineScriptsObservation[];
  readonly source_maps: readonly JavaScriptSourceMapObservation[];
  readonly visited_ast_nodes: number;
  readonly findings: number;
  readonly modules: number;
  readonly parse_failures: number;
  readonly limitations: readonly string[];
}
