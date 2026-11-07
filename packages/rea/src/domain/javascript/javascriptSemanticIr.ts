import type { JavaScriptSourceRange } from "./javascriptStaticAnalysisTypes.js";
import type {
  JavaScriptSemanticResourceLimit,
  JavaScriptSemanticValue,
} from "./javascriptSemanticValueTypes.js";
import type {
  JavaScriptSemanticCoverage,
  JavaScriptSemanticReturnCoverage,
} from "./javascriptSemanticCoverage.js";
import type { JavaScriptModuleResolutionMode } from "./javascriptModuleResolutionMode.js";

/** One exact module origin followed through imports, requires, or aliases. */
export interface JavaScriptModuleOrigin {
  readonly resolutionMode?: JavaScriptModuleResolutionMode;
  readonly specifier: string;
  readonly importedPath: readonly string[];
}

/**
 * Fail-closed module-alias provenance for one binding, not transitive data flow.
 * Locally constructed values may contain or derive from imported values.
 */
export type JavaScriptBindingProvenance =
  | {
      readonly status: "module";
      readonly origins: readonly [JavaScriptModuleOrigin];
      readonly reason: null;
    }
  | {
      readonly status: "local";
      readonly origins: readonly [];
      readonly reason: null;
    }
  | {
      readonly status: "ambiguous";
      readonly origins: readonly JavaScriptModuleOrigin[];
      readonly reason: string;
    }
  | {
      readonly status: "unknown" | "cycle";
      readonly origins: readonly [];
      readonly reason: string;
    };

/** One lexical scope recovered without executing source. */
export interface JavaScriptSemanticScope {
  readonly scopeId: string;
  readonly parentScopeId: string | null;
  readonly kind:
    | "program"
    | "function"
    | "block"
    | "static-block"
    | "class"
    | "catch";
  readonly location: JavaScriptSourceRange;
  readonly bindingsComplete: boolean;
  readonly bindingIds: readonly string[];
}

/** One declaration or assignment contributing to a binding. */
export interface JavaScriptSemanticDefinition {
  readonly kind:
    | "import"
    | "variable"
    | "parameter"
    | "function"
    | "class"
    | "catch"
    | "assignment";
  readonly location: JavaScriptSourceRange;
}

/** One resolved lexical binding plus static value and provenance. */
export interface JavaScriptSemanticBinding {
  readonly bindingId: string;
  readonly scopeId: string;
  readonly name: string;
  readonly kind: JavaScriptSemanticDefinition["kind"];
  readonly mutable: boolean;
  readonly definitions: readonly JavaScriptSemanticDefinition[];
  readonly value: JavaScriptSemanticValue;
  /** Value at the single initializer, before later member effects. */
  readonly initializerValue?: JavaScriptSemanticValue;
  readonly provenance: JavaScriptBindingProvenance;
}

/** One identifier use and its fail-closed lexical resolution. */
export interface JavaScriptSemanticReference {
  readonly name: string;
  readonly role: "read" | "write" | "export";
  readonly location: JavaScriptSourceRange;
  readonly bindingId: string | null;
  readonly resolution: "resolved" | "unbound" | "ambiguous" | "unknown";
}

/** Function, class, or method identity without pretending it is a binding. */
export interface JavaScriptSemanticCallable {
  readonly callableId: string;
  readonly kind: "function" | "class" | "method";
  readonly name: string | null;
  readonly containerScopeId: string;
  readonly bodyScopeId: string | null;
  readonly location: JavaScriptSourceRange;
  /** Evaluated by the enclosing callable, before this method is invoked. */
  readonly computedKeyLocation: JavaScriptSourceRange | null;
  readonly returnSites: readonly JavaScriptSemanticReturnSite[];
  readonly returnCoverage: JavaScriptSemanticReturnCoverage;
}

/** One direct return expression belonging to exactly one callable. */
export interface JavaScriptSemanticReturnSite {
  readonly returnSiteId: string;
  readonly location: JavaScriptSourceRange;
  readonly identityReferenceLocation: JavaScriptSourceRange | null;
  /**
   * Range of the unwrapped returned expression. Null when the return has no
   * value. This is the value's syntax, which may be wider than an identifier.
   */
  readonly valueExpressionLocation: JavaScriptSourceRange | null;
  readonly value: JavaScriptSemanticValue;
}

/** One statically visible call or construction expression. */
export interface JavaScriptSemanticCallSite {
  readonly callSiteId: string;
  readonly kind: "call" | "construct";
  readonly callerCallableId: string | null;
  readonly location: JavaScriptSourceRange;
  readonly calleeLocation: JavaScriptSourceRange;
  /** The call's value appears in an enclosing expression or return. */
  readonly resultUsed: boolean;
  readonly resolution: "exact" | "ambiguous" | "unresolved";
  readonly calleeCallableIds: readonly string[];
  readonly arguments: readonly JavaScriptSemanticCallArgument[];
}

/** One argument occurrence retained without evaluating application code. */
export interface JavaScriptSemanticCallArgument {
  readonly index: number;
  readonly location: JavaScriptSourceRange;
  /** Unwrapped value expression; null for a spread or non-expression slot. */
  readonly valueExpressionLocation: JavaScriptSourceRange | null;
  readonly spread: boolean;
  /** Direct scalar syntax, before runtime evaluation; omitted for other expressions. */
  readonly literal?: string | number | boolean | null;
  /** A direct literal was omitted under a semantic resource bound. */
  readonly literalResourceLimit?: "primitive-bytes";
}

/** One positional argument that may initialize one local parameter binding. */
export interface JavaScriptSemanticArgumentFlow {
  readonly callSiteId: string;
  readonly argumentIndex: number;
  readonly argumentLocation: JavaScriptSourceRange;
  readonly callableId: string;
  readonly parameterBindingId: string;
  readonly parameterLocation: JavaScriptSourceRange;
}

/** One direct local return that may supply a call expression's value. */
export interface JavaScriptSemanticCallReturnFlow {
  readonly callSiteId: string;
  readonly callableId: string;
  readonly returnSiteId: string;
  readonly returnLocation: JavaScriptSourceRange;
}

/** One local binding initialized or assigned from a retained call expression. */
export interface JavaScriptSemanticCallResultFlow {
  readonly callSiteId: string;
  readonly bindingId: string;
  readonly definitionLocation: JavaScriptSourceRange;
}

/** One resolved outer lexical binding referenced by a nested callable. */
export interface JavaScriptSemanticClosureCapture {
  readonly callableId: string;
  readonly bindingId: string;
  readonly referenceLocation: JavaScriptSourceRange;
}

/** One promise/task operation recovered from explicit syntax. */
export interface JavaScriptSemanticPromiseOperation {
  readonly promiseId: string;
  readonly kind:
    | "constructor"
    | "static"
    | "chain"
    | "aggregate"
    | "awaited-expression";
  readonly method:
    | "new"
    | "resolve"
    | "reject"
    | "then"
    | "catch"
    | "finally"
    | "all"
    | "allSettled"
    | "await";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly ownership:
    | "awaited"
    | "returned"
    | "detached"
    | "assigned"
    | "chained"
    | "aggregated"
    | "unknown";
  readonly ownerBindingId: string | null;
  readonly returnSiteId: string | null;
  readonly sourcePromiseIds: readonly string[];
  readonly sourceResolution: "complete" | "partial" | "unresolved";
}

/** Rename-resistant bounded component commitment for one callable. */
export interface JavaScriptSemanticFunctionFingerprint {
  readonly callableId: string;
  readonly status: "complete" | "partial" | "unavailable";
  readonly components: {
    readonly parameterArity: number;
    readonly normalizedAstSha256: string;
    readonly controlFlowSha256: string;
    readonly relationShapeSha256: string;
    readonly literalSetSha256: string;
    readonly effects: readonly (
      | "async"
      | "child-process"
      | "event"
      | "network"
      | "promise"
      | "resource"
      | "timer"
    )[];
  };
  readonly limitations: readonly string[];
}

/** One EventEmitter-style registration, removal, or dispatch candidate. */
export interface JavaScriptSemanticEventOperation {
  readonly eventId: string;
  readonly kind: "register" | "remove" | "dispatch";
  readonly method:
    | "on"
    | "once"
    | "addListener"
    | "prependListener"
    | "prependOnceListener"
    | "off"
    | "removeListener"
    | "removeAllListeners"
    | "emit";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly emitterKey: string;
  readonly emitterBindingId: string | null;
  readonly eventName: string | null;
  readonly listenerBindingId: string | null;
  readonly listenerLocation: JavaScriptSourceRange | null;
  readonly resolution: "complete" | "partial" | "unresolved";
}

/** One timer scheduling or cancellation candidate. */
export interface JavaScriptSemanticTimerOperation {
  readonly timerId: string;
  readonly kind: "schedule" | "cancel";
  readonly method:
    | "setTimeout"
    | "setInterval"
    | "setImmediate"
    | "clearTimeout"
    | "clearInterval"
    | "clearImmediate";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly handleBindingId: string | null;
  readonly projectedResultBindings: readonly JavaScriptSemanticProjectedResultBinding[];
  readonly linkedTimerId: string | null;
  readonly delayMilliseconds: number | null;
  readonly resolution: "complete" | "partial" | "unresolved";
}

/** One explicit asynchronous node:child_process creation candidate. */
export interface JavaScriptSemanticChildProcessSpawn {
  readonly processId: string;
  readonly method: "spawn" | "exec" | "execFile" | "fork";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly resultBindingId: string | null;
  readonly projectedResultBindings: readonly JavaScriptSemanticProjectedResultBinding[];
  readonly command: string | null;
  readonly argvCount: number | null;
  readonly environmentSupplied: boolean;
  readonly stdioMode: string;
  readonly resolution: "complete" | "partial";
}

/** One exit/error listener or signal operation linked to child candidates. */
export interface JavaScriptSemanticChildProcessInteraction {
  readonly interactionId: string;
  readonly kind: "listener" | "signal";
  readonly method: "on" | "once" | "addListener" | "kill";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly processBindingId: string | null;
  readonly linkedProcessIds: readonly string[];
  readonly eventName: "exit" | "error" | null;
  readonly signalName: string | null;
  readonly listenerLocation: JavaScriptSourceRange | null;
  readonly resolution: "complete" | "partial";
}

/** One environment, argv, file, or default configuration source. */
export interface JavaScriptSemanticConfigurationOperation {
  readonly configId: string;
  readonly kind: "environment" | "argv" | "file" | "default";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly resultBindingId: string | null;
  readonly key: string | null;
  readonly sourceConfigId: string | null;
  readonly value: string | number | boolean | null;
  readonly valueResourceLimit?: JavaScriptSemanticResourceLimit;
  readonly resolution: "complete" | "partial";
}

/** One request construction or response-consumer candidate. */
export interface JavaScriptSemanticRequestOperation {
  readonly requestId: string;
  readonly kind: "request" | "response-consumer";
  readonly method:
    | "fetch"
    | "WebSocket"
    | "request"
    | "get"
    | "json"
    | "text"
    | "arrayBuffer";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly resultBindingId: string | null;
  readonly projectedResultBindings: readonly JavaScriptSemanticProjectedResultBinding[];
  readonly linkedRequestIds: readonly string[];
  readonly endpoint: string | null;
  readonly fields: readonly {
    readonly name: string;
    readonly sourceBindingId: string | null;
  }[];
  readonly resolution: "complete" | "partial" | "unresolved";
}

/** A destructured result binding with its known projection path. */
export interface JavaScriptSemanticProjectedResultBinding {
  readonly bindingId: string;
  readonly projectionPath: readonly (string | number | null)[];
  readonly resolution: "complete" | "partial";
}

/** One parse, coercion, or validation boundary candidate. */
export interface JavaScriptSemanticBoundaryOperation {
  readonly boundaryId: string;
  readonly kind: "parse" | "coerce" | "validate";
  readonly method: string;
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly sourceBindingId: string | null;
  readonly resultBindingId: string | null;
  readonly resolution: "complete" | "partial";
}

/** One explicit built-in resource acquisition or release candidate. */
export interface JavaScriptSemanticResourceOperation {
  readonly resourceId: string;
  readonly kind: "acquire" | "release";
  readonly method:
    | "open"
    | "openSync"
    | "createReadStream"
    | "createWriteStream"
    | "connect"
    | "createConnection"
    | "close"
    | "destroy"
    | "end";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly resultBindingId: string | null;
  readonly linkedResourceIds: readonly string[];
  readonly resolution: "complete" | "partial";
}

/** One static property read/write, spread, or destructuring candidate. */
export interface JavaScriptSemanticObjectOperation {
  readonly objectOperationId: string;
  readonly kind: "read" | "write" | "spread" | "destructure";
  readonly location: JavaScriptSourceRange;
  readonly ownerCallableId: string | null;
  readonly objectBindingId: string | null;
  readonly targetBindingId: string | null;
  readonly propertyPath: readonly string[] | null;
  readonly resolution: "complete" | "partial";
}

/** One syntax location where exact local semantic continuation is unavailable. */
export interface JavaScriptSemanticFrontier {
  /**
   * `dynamic-call`/`dynamic-property` mark a callee or key the analyzer could
   * not resolve. `dynamic-scope` marks `with`/`eval`, where the binding
   * environment itself is not statically knowable.
   */
  readonly kind: "dynamic-call" | "dynamic-property" | "dynamic-scope";
  readonly callableId: string | null;
  readonly location: JavaScriptSourceRange;
  readonly reason: string;
}

/** Static import/export relationship retained for cross-file composition. */
export interface JavaScriptSemanticModuleLink {
  readonly resolutionMode?: JavaScriptModuleResolutionMode;
  readonly kind:
    | "import"
    | "type-import"
    | "require"
    | "export"
    | "re-export"
    | "commonjs-export";
  readonly specifier: string | null;
  readonly importedName: string | null;
  readonly localName: string | null;
  readonly exportedName: string | null;
  readonly callableId: string | null;
  readonly location: JavaScriptSourceRange;
}

/** Syntactic influence into one simple assignment target; no value evaluation. */
export interface JavaScriptSemanticAssignmentFlow {
  readonly target: JavaScriptSourceRange;
  readonly source: JavaScriptSourceRange;
  readonly sourceIsReference: boolean;
  readonly operator: string;
  readonly ownerCallableId: string | null;
}

/** Syntactic inputs to one operator result; this is influence, not identity. */
export interface JavaScriptSemanticExpressionFlow {
  readonly location: JavaScriptSourceRange;
  readonly operator: string;
  readonly operands: readonly {
    readonly location: JavaScriptSourceRange;
    readonly kind: "reference" | "expression" | "literal" | "unsupported";
    readonly conditional: boolean;
    readonly literal?: string | number | boolean | null;
  }[];
  readonly ownerCallableId: string | null;
}

/** A direct identifier declaration initialized by an operator expression. */
export interface JavaScriptSemanticInitializerFlow {
  readonly target: JavaScriptSourceRange;
  readonly source: JavaScriptSourceRange;
}

/** Provider-neutral JavaScript semantic IR. */
export interface JavaScriptSemanticIr {
  readonly schema: "JavaScriptSemanticIR";
  readonly scopes: readonly JavaScriptSemanticScope[];
  readonly bindings: readonly JavaScriptSemanticBinding[];
  readonly callables: readonly JavaScriptSemanticCallable[];
  readonly references: readonly JavaScriptSemanticReference[];
  readonly moduleLinks: readonly JavaScriptSemanticModuleLink[];
  readonly callSites: readonly JavaScriptSemanticCallSite[];
  readonly argumentFlows: readonly JavaScriptSemanticArgumentFlow[];
  readonly callReturnFlows: readonly JavaScriptSemanticCallReturnFlow[];
  readonly callResultFlows: readonly JavaScriptSemanticCallResultFlow[];
  readonly closureCaptures: readonly JavaScriptSemanticClosureCapture[];
  readonly promiseOperations: readonly JavaScriptSemanticPromiseOperation[];
  readonly eventOperations: readonly JavaScriptSemanticEventOperation[];
  readonly timerOperations: readonly JavaScriptSemanticTimerOperation[];
  readonly childProcessSpawns: readonly JavaScriptSemanticChildProcessSpawn[];
  readonly childProcessInteractions: readonly JavaScriptSemanticChildProcessInteraction[];
  readonly configurationOperations: readonly JavaScriptSemanticConfigurationOperation[];
  readonly requestOperations: readonly JavaScriptSemanticRequestOperation[];
  readonly boundaryOperations: readonly JavaScriptSemanticBoundaryOperation[];
  readonly resourceOperations: readonly JavaScriptSemanticResourceOperation[];
  readonly assignmentFlows: readonly JavaScriptSemanticAssignmentFlow[];
  readonly expressionFlows: readonly JavaScriptSemanticExpressionFlow[];
  readonly initializerFlows: readonly JavaScriptSemanticInitializerFlow[];
  readonly literalReturns: readonly {
    readonly location: JavaScriptSourceRange;
    readonly value: string | number | boolean | null;
  }[];
  readonly expressionFlowsTruncated: boolean;
  readonly objectOperations: readonly JavaScriptSemanticObjectOperation[];
  readonly functionFingerprints: readonly JavaScriptSemanticFunctionFingerprint[];
  readonly frontiers: readonly JavaScriptSemanticFrontier[];
  readonly coverage: JavaScriptSemanticCoverage;
  readonly limitations: readonly string[];
}

/** Fail-closed result when Babel cannot produce an inert syntax tree. */
export const failedJavaScriptSemanticIr = (): JavaScriptSemanticIr => ({
  schema: "JavaScriptSemanticIR",
  scopes: [],
  bindings: [],
  callables: [],
  references: [],
  moduleLinks: [],
  callSites: [],
  argumentFlows: [],
  callReturnFlows: [],
  callResultFlows: [],
  closureCaptures: [],
  promiseOperations: [],
  eventOperations: [],
  timerOperations: [],
  childProcessSpawns: [],
  childProcessInteractions: [],
  configurationOperations: [],
  requestOperations: [],
  boundaryOperations: [],
  resourceOperations: [],
  assignmentFlows: [],
  expressionFlows: [],
  initializerFlows: [],
  literalReturns: [],
  expressionFlowsTruncated: false,
  objectOperations: [],
  functionFingerprints: [],
  frontiers: [],
  coverage: { status: "failed", omittedCount: null },
  limitations: [
    "JavaScript parsing failed; no semantic absence claim is available.",
    "No JavaScript was executed.",
  ],
});
