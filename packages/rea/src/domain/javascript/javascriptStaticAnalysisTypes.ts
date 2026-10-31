import type { ElectronStaticFindings } from "./electronStaticAnalysisTypes.js";
import type { JavaScriptRouteSourceFacts } from "./javascriptRouteFacts.js";
import type { JavaScriptStaticCoverage } from "./javascriptStaticCoverage.js";

/** Token semantics shared by bundle producers and worker admission. */
export const JAVASCRIPT_AST_FINGERPRINT_ALGORITHM = "babel-ast-v3";

/**
 * Marks a Vite preload dependency written relative to the build output
 * directory (Vite's absolute-base form, such as `assets/chunk.js`). The
 * runtime helper prefixes the configured base, so the path is not a module
 * specifier and not relative to the importing chunk.
 */
export const VITE_OUTPUT_DEPENDENCY_PREFIX = "vite-output:";

/** Static syntax context retained for later artifact path resolution. */
export type JavaScriptStaticPathContext =
  | "module-specifier"
  | "filesystem-expression";

/** One source coordinate produced by the JavaScript parser. */
export interface JavaScriptSourcePoint {
  readonly line: number;
  readonly column: number;
}

/** One exact source range within a JavaScript artifact. */
export interface JavaScriptSourceRange {
  readonly start: JavaScriptSourcePoint;
  readonly end: JavaScriptSourcePoint;
}

interface JavaScriptStaticReferenceState {
  /** Resolution discovers a target without loading or executing it. */
  readonly operation: "load" | "resolve";
  readonly kind:
    | "static-import"
    | "dynamic-import"
    | "require"
    | "worker"
    | "service-worker";
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  /** Source-relative filename selected by a proven createRequire factory. */
  readonly resolution_base_path?: string;
  readonly location: JavaScriptSourceRange;
}

/** A statically visible module, worker, or service-worker reference. */
export type JavaScriptStaticReference = JavaScriptStaticReferenceState &
  (
    | { readonly specifier: string; readonly expression: null }
    | { readonly specifier: null; readonly expression: string }
  );

/** A route or network endpoint literal observed in syntax. */
export interface JavaScriptStaticEndpoint {
  readonly kind: "route" | "network";
  readonly value: string;
  readonly mechanism: string;
  /**
   * Only a name suggests this value: an overloaded callee whose network receiver
   * is unproven, or a `path`/`route` property outside a router record.
   */
  readonly interpretation?: "candidate";
  /** The request target is unresolved source text rather than an exact value. */
  readonly resolution?: "partial";
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

/** A storage API or explicitly uncertain candidate, without executing source. */
export interface JavaScriptStaticStorage {
  readonly kind:
    | "local-storage"
    | "session-storage"
    | "indexed-db"
    | "cache-storage"
    | "sqlite";
  readonly interpretation?: "candidate";
  readonly name: string | null;
  readonly mechanism: string;
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

interface JavaScriptBundlerModuleState {
  readonly module_key: string;
  readonly factory_require_name: string | null;
  readonly source_sha256: string;
  readonly exports: readonly string[];
  readonly location: JavaScriptSourceRange;
}

/** One exact module factory recovered from a Webpack/Rspack registration. */
export interface JavaScriptBundlerModule extends JavaScriptBundlerModuleState {
  readonly structural_fingerprint_sha256: string;
  readonly structural_fingerprint_algorithm: typeof JAVASCRIPT_AST_FINGERPRINT_ALGORITHM;
}

/** One statically recognized bundler chunk or module registration. */
export interface JavaScriptBundlerRegistration {
  readonly bundler: "webpack" | "rspack" | "esbuild";
  readonly runtime: string;
  readonly chunk_keys: readonly string[];
  readonly unknown_chunk_keys: number;
  readonly runtime_require_name: string | null;
  readonly runtime_module_cache_status: "observed" | "not-observed";
  readonly entry_module_keys: readonly string[];
  readonly unknown_entry_module_keys: number;
  readonly async_chunk_keys: readonly string[];
  readonly unknown_async_chunk_keys: number;
  readonly modules: readonly JavaScriptBundlerModule[];
  readonly location: JavaScriptSourceRange;
}

/** Static Electron role paths discovered from package or JavaScript syntax. */
export interface JavaScriptRolePath {
  readonly role: "preload" | "renderer";
  readonly path: string;
  readonly resolution_context: JavaScriptStaticPathContext;
  /** Inferred from intact source-directory intrinsics; not a runtime/bundler guarantee. */
  readonly path_base?: "source-directory";
  readonly mechanism: string;
  readonly module_key: string | null;
  /** Recovered factory runtime; absent in older or unbundled findings. */
  readonly module_runtime?: string;
  readonly location: JavaScriptSourceRange;
}

/** Deterministic AST-only analysis of one JavaScript source file. */
export interface JavaScriptStaticAnalysis {
  /** Established overall summary; syntax alone is reported in analysis_coverage. */
  readonly parse_status: "complete" | "partial" | "failed";
  /** Historical facts omit this measurement; consumers must not infer it. */
  readonly analysis_coverage?: JavaScriptStaticCoverage;
  readonly parse_error_count: number;
  readonly visited_ast_nodes: number;
  readonly references: readonly JavaScriptStaticReference[];
  readonly endpoints: readonly JavaScriptStaticEndpoint[];
  /** Missing in historical analyses; absence means unmeasured route coverage. */
  readonly routes?: JavaScriptRouteSourceFacts;
  readonly storage: readonly JavaScriptStaticStorage[];
  readonly bundler_registrations: readonly JavaScriptBundlerRegistration[];
  readonly role_paths: readonly JavaScriptRolePath[];
  readonly source_map_urls: readonly {
    readonly declared_url: string;
    readonly location: JavaScriptSourceRange;
  }[];
  readonly vendors: readonly string[];
  readonly electron: ElectronStaticFindings;
  readonly limitations: readonly string[];
}

/** Hard bounds applied to one AST-only JavaScript analysis. */
