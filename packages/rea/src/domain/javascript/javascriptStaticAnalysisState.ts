import type * as t from "@babel/types";
import type { JavaScriptBundlerFactoryRoles } from "./javascriptBundlerFactoryRoles.js";
import type { JavaScriptOpenReceiverFact } from "./javascriptSemanticReceiverFacts.js";
import type { JavaScriptRpcScan } from "./javascriptRpcEndpoints.js";
import type { JavaScriptStaticPathIntrinsicQuery } from "./javascriptStaticAnalysisHelpers.js";
import type { JavaScriptExpressionShapeResolver } from "./javascriptSemanticExpressionShapes.js";

import type {
  JavaScriptBundlerRegistration,
  JavaScriptRolePath,
  JavaScriptStaticAnalysis,
  JavaScriptStaticEndpoint,
  JavaScriptStaticReference,
  JavaScriptStaticStorage,
} from "./javascriptStaticAnalysisTypes.js";
import type {
  ElectronAppPathChangeFinding,
  ElectronCallPath,
  ElectronBrowserWindowFinding,
  ElectronContextBridgeFinding,
  ElectronIpcFinding,
  ElectronNativeAddonBindingFinding,
  ElectronSenderValidationFinding,
  ElectronProtocolFinding,
  ElectronUtilityProcessFinding,
} from "./electronStaticAnalysisTypes.js";
import { JavaScriptModuleRangeIndex } from "./javascriptStaticAnalysisFindings.js";

/** Source offsets for one recovered bundle module factory. */
export interface JavaScriptModuleRange {
  readonly start: number;
  readonly end: number;
  readonly key: string;
  readonly runtime: string;
  readonly requireName: string | null;
}

/** Static finding retained with its source offset until module attribution. */
export interface LocatedJavaScriptFinding<Value> {
  readonly offset: number;
  readonly value: Value;
}

/** Mutable collections used during one inert AST traversal. */
export interface JavaScriptAnalysisAccumulator {
  readonly pendingBundlerExports: {
    readonly factory: t.Node;
    readonly roles: JavaScriptBundlerFactoryRoles;
    readonly exports: string[];
  }[];
  /** Factory parameter defaults the bundler calling convention never runs. */
  readonly unusedFactoryDefaults: Set<t.Node>;
  readonly pendingModuleRequireCalls: (
    | t.CallExpression
    | t.OptionalCallExpression
    | t.NewExpression
  )[];
  readonly appPathChanges: LocatedJavaScriptFinding<ElectronAppPathChangeFinding>[];
  electronCallPaths?: readonly ElectronCallPath[];
  electronCallPathLimitReached?: boolean;
  readonly references: LocatedJavaScriptFinding<JavaScriptStaticReference>[];
  readonly endpoints: LocatedJavaScriptFinding<JavaScriptStaticEndpoint>[];
  /** Target and receiver identities awaiting the shared mutation index. */
  readonly pendingNetworkCalls: {
    readonly node:
      | t.CallExpression
      | t.OptionalCallExpression
      | t.NewExpression;
    readonly name: string;
  }[];
  readonly pendingSqliteCalls: {
    readonly node:
      | t.CallExpression
      | t.OptionalCallExpression
      | t.NewExpression;
    readonly name: string;
  }[];
  readonly storage: LocatedJavaScriptFinding<JavaScriptStaticStorage>[];
  readonly roles: LocatedJavaScriptFinding<JavaScriptRolePath>[];
  readonly sourceMaps: JavaScriptStaticAnalysis["source_map_urls"][number][];
  readonly registrations: JavaScriptBundlerRegistration[];
  readonly browserWindows: LocatedJavaScriptFinding<ElectronBrowserWindowFinding>[];
  readonly pendingBrowserWindows: t.NewExpression[];
  readonly contextBridgeApis: LocatedJavaScriptFinding<ElectronContextBridgeFinding>[];
  readonly ipc: LocatedJavaScriptFinding<ElectronIpcFinding>[];
  readonly senderValidations: LocatedJavaScriptFinding<ElectronSenderValidationFinding>[];
  readonly utilityProcesses: LocatedJavaScriptFinding<ElectronUtilityProcessFinding>[];
  readonly nativeAddonBindings: LocatedJavaScriptFinding<ElectronNativeAddonBindingFinding>[];
  readonly pendingNativeAddonBindings: (
    | t.VariableDeclarator
    | t.AssignmentExpression
  )[];
  readonly protocols: LocatedJavaScriptFinding<ElectronProtocolFinding>[];
  readonly moduleRangeIndex: JavaScriptModuleRangeIndex;
  /** Binding identities proven as third-parameter loaders of recovered factories. */
  readonly factoryRequireBindingIds: Set<string>;
  readonly seen: Set<string>;
  bundlerExportHelpersObserved: boolean;
  visitedNodes: number;
  unknownFindings: number;
}

/** Shared source and accumulator for helper inspections. */
export interface JavaScriptFindingContext {
  /** Native path/URL identities established by shared lexical and mutation owners. */
  readonly pathIntrinsics?: JavaScriptStaticPathIntrinsicQuery;
  readonly electronExportIntact?: (path: readonly string[]) => boolean;
  readonly browserWindowReceiver?: (
    node: t.Node,
    site: t.Node,
    suffix: readonly string[],
  ) =>
    | { readonly owner: t.NewExpression; readonly path: readonly string[] }
    | undefined;
  readonly xhrOpenRequest?: (node: t.Node) => boolean;
  readonly rendererLoad?: (callee: t.Node, site: t.Node) => boolean;
  readonly rpcScan: JavaScriptRpcScan;
  /** Shared bounded argv/nullish argument shapes for optional-slot signatures. */
  readonly expressionShapes: JavaScriptExpressionShapeResolver;
  readonly source: string;
  readonly accumulator: JavaScriptAnalysisAccumulator;
  readonly vitePreloadDependencyTable: readonly (string | undefined)[] | null;
  readonly openReceiverFacts?: ReadonlyMap<number, JavaScriptOpenReceiverFact>;
  /** Proven Electron export path segments by root offset. */
  readonly electronBindings?: ReadonlyMap<number, readonly string[]>;
  /** Normalized invocation target from the shared Electron and intrinsic owners. */
  readonly electronInvocationPath?: (
    node: t.CallExpression | t.OptionalCallExpression,
  ) => readonly string[] | undefined;
  /** A possible shared-app mutation does not establish concrete API identity. */
  readonly electronAppPathChangePossible?: (node: t.Node) => boolean;
}

/** Candidate import, require, worker, or service-worker reference. */
export interface JavaScriptReferenceInput {
  readonly operation?: JavaScriptStaticReference["operation"];
  readonly node: t.Node;
  readonly kind: JavaScriptStaticReference["kind"];
  readonly specifier: string | undefined;
  readonly resolutionBasePath?: string;
}

/** Candidate route or network endpoint literal. */
export interface JavaScriptEndpointInput {
  readonly node: t.Node;
  readonly kind: JavaScriptStaticEndpoint["kind"];
  readonly value: string;
  readonly mechanism: string;
  readonly interpretation?: "candidate";
  readonly resolution?: "partial";
}

/** Values required to append one module-attributable static finding. */
export interface LocatedJavaScriptFindingInput<
  Value extends { readonly module_key: string | null },
> {
  readonly collection: LocatedJavaScriptFinding<Value>[];
  readonly key: string;
  readonly node: t.Node;
  readonly value: Value;
}

/** Create isolated mutable state for one source analysis. */
export const createJavaScriptAnalysisAccumulator = (
  sourceLength: number,
): JavaScriptAnalysisAccumulator => ({
  pendingBundlerExports: [],
  unusedFactoryDefaults: new Set(),
  pendingModuleRequireCalls: [],
  appPathChanges: [],
  references: [],
  endpoints: [],
  pendingNetworkCalls: [],
  storage: [],
  pendingSqliteCalls: [],
  roles: [],
  sourceMaps: [],
  registrations: [],
  browserWindows: [],
  pendingBrowserWindows: [],
  contextBridgeApis: [],
  ipc: [],
  senderValidations: [],
  utilityProcesses: [],
  nativeAddonBindings: [],
  pendingNativeAddonBindings: [],
  protocols: [],
  moduleRangeIndex: new JavaScriptModuleRangeIndex(sourceLength),
  factoryRequireBindingIds: new Set(),
  seen: new Set(),
  bundlerExportHelpersObserved: false,
  visitedNodes: 0,
  unknownFindings: 0,
});
