import {
  isBrowserNetworkRequest,
  createXhrOpenRequestQuery,
} from "./javascript/javascriptNetworkRequests.js";
import type { JavaScriptSemanticAnalysisState } from "./javascript/javascriptSemanticState.js";
import type {
  AnalysisAccumulator,
  IncludedScript,
} from "./webBundleAnalyzerState.js";
import * as t from "@babel/types";
import { JavaScriptRouteScan } from "./javascript/javascriptRouteScan.js";
import type { JavaScriptRouteSourceFacts } from "./javascript/javascriptRouteFacts.js";

import { sanitizeEndpointCandidate } from "./browserObservation.js";
import { compositeKey } from "./unicodeCodePointOrder.js";
import type { WebBundleAnalysis } from "./webBundleAnalysis.js";
import {
  traverseJavaScriptAst,
  completeSemanticSteps,
} from "./javascript/javascriptSemanticTraversal.js";
import { indexJavaScriptBindingsWithReceiversSteps } from "./javascript/javascriptSemanticAnalysis.js";
import type { JavaScriptOpenReceiverFact } from "./javascript/javascriptSemanticAnalysis.js";
import { isIntrinsicMapLookup } from "./javascript/javascriptSemanticMapOperations.js";
import {
  semanticStaticPropertyKey,
  semanticStaticPropertyName,
  isNullishJavaScriptSyntax,
  staticObjectProperty,
  staticObjectPropertyNames,
  unwrapJavaScriptExpression,
} from "./javascript/javascriptAstValues.js";
import {
  STATIC_ROUTE_CALL_NAMES,
  calleeName,
  endpointArgument,
  stringValue,
} from "./javascript/javascriptStaticAnalysisHelpers.js";
import {
  location,
  locationFields,
  objectString,
  resolveSpecifier,
  isUrlLikeModuleSpecifier,
} from "./webBundleAnalyzerAst.js";
import { createJavaScriptRpcScan } from "./javascript/javascriptRpcEndpoints.js";
import { semanticStaticModuleSource } from "./javascript/javascriptModuleDeclaration.js";
import { parseJavaScriptSource } from "./javascript/javascriptSourceParser.js";

type BundleObservations = WebBundleAnalysis["observations"];
type ChunkEdge = BundleObservations["chunks"]["edges"][number];
type Finding = BundleObservations["routes"][number];
type WebMcpDeclaration = BundleObservations["webmcp_declarations"][number];
type Inference = WebBundleAnalysis["inferences"][number];
export const analyzeScript = (
  script: IncludedScript,
  accumulator: AnalysisAccumulator,
): JavaScriptRouteSourceFacts | null => {
  const file = parseJavaScriptSource(script.source.artifact.text);
  if (file === null) {
    accumulator.failedScripts.push(script.script_key);
    return null;
  }
  accumulator.parsedScripts += 1;
  if ((file.errors?.length ?? 0) > 0)
    accumulator.recoveredScripts.push(script.script_key);
  detectVendorFingerprints(script, accumulator);
  const index = completeSemanticSteps(
    indexJavaScriptBindingsWithReceiversSteps(file.program),
  );
  completeSemanticSteps(index.indexAmbientWritesSteps());
  const { receivers } = index;
  const routeScan = completeSemanticSteps(
    JavaScriptRouteScan.createSteps(file, index, ({ node, value, mechanism }) =>
      addFinding({
        collection: accumulator.routes,
        script,
        rawValue: value,
        mechanism,
        node,
        accumulator,
      }),
    ),
  );
  const openReceiverFacts = receivers.openReceivers;
  let mutationFactsIndexed = false;
  const isMapLookup = (
    node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  ): boolean => {
    const proof = isIntrinsicMapLookup(node, index.bindings);
    if (proof !== undefined) return proof;
    if (!mutationFactsIndexed) {
      completeSemanticSteps(index.indexMemberMutationFactsSteps());
      mutationFactsIndexed = true;
    }
    return isIntrinsicMapLookup(node, index.bindings, index) === true;
  };
  const isXhrRequest = createXhrOpenRequestQuery(index);
  const rpc = createJavaScriptRpcScan(
    script.source.artifact.text,
    receivers.rpcClientRoots,
    index,
  );
  traverseJavaScriptAst(file, {
    enter: (node, parent) => {
      accumulator.visitedNodes += 1;
      routeScan.inspect(node, parent);
      inspectNode(
        script,
        node,
        accumulator,
        openReceiverFacts,
        isMapLookup,
        index.bindings,
        isXhrRequest,
      );
      const endpoint = rpc.inspect(node);
      if (endpoint !== undefined)
        addFinding({
          collection: accumulator.endpoints,
          script,
          rawValue: endpoint.value,
          mechanism: endpoint.mechanism,
          node,
          accumulator,
        });
    },
  });
  for (const endpoint of rpc.finish())
    if (endpoint !== undefined)
      addFinding({
        collection: accumulator.endpoints,
        script,
        rawValue: endpoint.value,
        mechanism: endpoint.mechanism,
        node: endpoint.node,
        accumulator,
      });
  if (index.bindings.returnedReferenceWidenings.size > 0)
    accumulator.widenedScripts.push(script.script_key);
  return completeSemanticSteps(routeScan.finishSteps());
};

const inspectNode = (
  script: IncludedScript,
  node: t.Node,
  accumulator: AnalysisAccumulator,
  openReceiverFacts: ReadonlyMap<number, JavaScriptOpenReceiverFact>,
  isMapLookup: (
    node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  ) => boolean,
  bindings: JavaScriptSemanticAnalysisState,
  isXhrRequest: (node: t.Node) => boolean,
): void => {
  const moduleSource = semanticStaticModuleSource(node);
  if (moduleSource !== null)
    addEdge({
      script,
      specifier: moduleSource.value,
      kind: "static_import",
      node,
      accumulator,
    });
  else if (t.isImportExpression(node)) {
    const specifier = stringValue(node.source);
    if (specifier !== undefined)
      addEdge({
        script,
        specifier,
        kind: "dynamic_import",
        node,
        accumulator,
      });
  }
  if (
    t.isCallExpression(node) ||
    t.isOptionalCallExpression(node) ||
    t.isNewExpression(node)
  )
    inspectCall(
      script,
      node,
      accumulator,
      openReceiverFacts,
      isMapLookup,
      bindings,
      isXhrRequest,
    );
};

const inspectCall = (
  script: IncludedScript,
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  accumulator: AnalysisAccumulator,
  openReceiverFacts: ReadonlyMap<number, JavaScriptOpenReceiverFact>,
  isMapLookup: (
    node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  ) => boolean,
  bindings: JavaScriptSemanticAnalysisState,
  isXhrRequest: (node: t.Node) => boolean,
): void => {
  const name = calleeName(node.callee);
  const first = stringValue(node.arguments[0]);
  if ((name === "require" || name.endsWith(".require")) && first !== undefined)
    addEdge({
      script,
      specifier: first,
      kind: "require",
      node,
      accumulator,
    });
  if (name === "importScripts" || name.endsWith(".importScripts"))
    for (const argument of node.arguments) {
      const specifier = stringValue(argument);
      if (specifier === undefined) continue;
      addEdge({ script, specifier, kind: "worker_import", node, accumulator });
    }
  if (
    STATIC_ROUTE_CALL_NAMES.some(
      (candidate) => name === candidate || name.endsWith(`.${candidate}`),
    )
  ) {
    addRouteFrameworkInference({
      script,
      name,
      node,
      accumulator,
    });
  }
  const endpoint = endpointArgument(
    name,
    node.arguments,
    node.callee,
    openReceiverFacts.get(node.start ?? -1),
  );
  const mapLookup = isMapLookup(node);
  const knownRequest =
    isBrowserNetworkRequest(node, bindings) || isXhrRequest(node);
  const networkEndpoint =
    endpoint !== undefined && !mapLookup
      ? { ...endpoint, kind: knownRequest ? "endpoint" : endpoint.kind }
      : undefined;
  if (networkEndpoint?.kind === "candidate")
    addEndpointCandidate(
      script,
      node,
      name,
      networkEndpoint.value,
      accumulator,
    );
  else if (networkEndpoint !== undefined)
    addFinding({
      collection: accumulator.endpoints,
      script,
      rawValue: networkEndpoint.value,
      mechanism: `call:${name}`,
      node,
      accumulator,
    });
  if (isWebMcpRegistrationCallee(node.callee))
    addWebMcpDeclaration(script, node, accumulator);
};

/** Match exact WebMCP receiver and method properties without flattening keys. */
const isWebMcpRegistrationCallee = (callee: t.Node): boolean => {
  const method = unwrapJavaScriptExpression(callee).node;
  if (!t.isMemberExpression(method) && !t.isOptionalMemberExpression(method))
    return false;
  if (
    semanticStaticPropertyKey(method.property, method.computed) !==
    "registerTool"
  )
    return false;

  const receiver = unwrapJavaScriptExpression(method.object).node;
  if (t.isIdentifier(receiver, { name: "modelContext" })) return true;
  return (
    (t.isMemberExpression(receiver) ||
      t.isOptionalMemberExpression(receiver)) &&
    semanticStaticPropertyKey(receiver.property, receiver.computed) ===
      "modelContext"
  );
};

interface AddEdgeContext {
  readonly script: IncludedScript;
  readonly specifier: string;
  readonly kind: ChunkEdge["kind"];
  readonly node: t.Node;
  readonly accumulator: AnalysisAccumulator;
}

const addEdge = (context: AddEdgeContext): void => {
  const key = `edge\0${context.script.script_key}\0${context.kind}\0${context.specifier}`;
  addUnique(context.accumulator, key, () =>
    context.accumulator.edges.push({
      from_script_key: context.script.script_key,
      kind: context.kind,
      specifier: context.specifier,
      resolved_url:
        context.kind === "worker_import" ||
        isUrlLikeModuleSpecifier(context.specifier)
          ? resolveSpecifier(context.specifier, context.script.url)
          : null,
      location: location(context.script.script_key, context.node),
    }),
  );
};

interface AddFindingContext {
  readonly collection: Finding[];
  readonly script: IncludedScript;
  readonly rawValue: string;
  readonly mechanism: string;
  readonly node: t.Node;
  readonly accumulator: AnalysisAccumulator;
}

const addEndpointCandidate = (
  script: IncludedScript,
  node: t.Node,
  name: string,
  rawValue: string,
  accumulator: AnalysisAccumulator,
): void => {
  const value = sanitizeEndpointCandidate(rawValue);
  const detector = `call:${name}:unverified-network-receiver`;
  const key = compositeKey([
    "endpoint-candidate",
    script.script_key,
    value,
    detector,
  ]);
  // This is a per-script candidate inventory, not a callsite list. Keep the
  // first representative source position without multiplying inline records.
  addUnique(accumulator, key, () =>
    accumulator.inferences.push({
      kind: "endpoint_candidate",
      value,
      confidence: "low",
      basis: [{ ...basis(script, detector), ...locationFields(node) }],
    }),
  );
};

const addFinding = (context: AddFindingContext): void => {
  const value = sanitizeEndpointCandidate(context.rawValue);
  const key = `finding\0${context.mechanism}\0${context.script.script_key}\0${value}`;
  addUnique(context.accumulator, key, () =>
    context.collection.push({
      value,
      mechanism: context.mechanism,
      location: location(context.script.script_key, context.node),
    }),
  );
};

const addWebMcpDeclaration = (
  script: IncludedScript,
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  accumulator: AnalysisAccumulator,
): void => {
  const declaration = node.arguments[0];
  if (!t.isObjectExpression(declaration)) return;
  const name = objectString(declaration, "name");
  const description = objectString(declaration, "description");
  const camelSchema = staticObjectProperty(
    declaration,
    "inputSchema",
    isNullishJavaScriptSyntax,
  );
  const schemaProperty =
    camelSchema.status === "missing" ||
    (camelSchema.status === "explicit" &&
      isNullishJavaScriptSyntax(camelSchema.value))
      ? staticObjectProperty(
          declaration,
          "input_schema",
          isNullishJavaScriptSyntax,
        )
      : camelSchema;
  let schemaPropertyNames: readonly string[] = [];
  let schemaPropertyNamesCoverage: NonNullable<
    WebMcpDeclaration["schema_property_names_coverage"]
  > = "unknown";
  if (schemaProperty.status === "missing") {
    schemaPropertyNamesCoverage = "not_present";
  } else if (schemaProperty.status === "explicit") {
    const schema = schemaProperty.value;
    if (t.isObjectExpression(schema)) {
      const propertiesProperty = staticObjectProperty(
        schema,
        "properties",
        isNullishJavaScriptSyntax,
      );
      if (propertiesProperty.status === "missing") {
        schemaPropertyNamesCoverage = "not_present";
      } else if (propertiesProperty.status === "explicit") {
        const properties = propertiesProperty.value;
        if (t.isObjectExpression(properties)) {
          const projection = staticObjectPropertyNames(
            properties,
            isNullishJavaScriptSyntax,
          );
          if (
            projection.status === "complete" ||
            projection.status === "partial"
          ) {
            schemaPropertyNames = projection.names;
            schemaPropertyNamesCoverage = projection.status;
          }
        }
      }
    }
  }
  const metadata = {
    name: name ?? null,
    description: description ?? null,
    schema_property_names: [...new Set(schemaPropertyNames)].sort(),
    schema_property_names_coverage: schemaPropertyNamesCoverage,
  };
  // Deduplicate the metadata we return, preserving omission and descriptions.
  // Property names are a variable-length source-derived list: NUL-joins
  // would collapse ["a\0b"] with ["a", "b"] and drop a declaration.
  const key = compositeKey(["webmcp", script.script_key, metadata]);
  addUnique(accumulator, key, () =>
    accumulator.webMcp.push({
      ...metadata,
      trust: "page-declared-untrusted",
      location: location(script.script_key, node),
    }),
  );
};

const detectVendorFingerprints = (
  script: IncludedScript,
  accumulator: AnalysisAccumulator,
): void => {
  const text = script.source.artifact.text;
  for (const detector of vendorDetectors) {
    if (!detector.patterns.some((pattern) => text.includes(pattern))) continue;
    const key = `vendor\0${script.script_key}\0${detector.value}`;
    addUnique(accumulator, key, () =>
      accumulator.inferences.push({
        kind: detector.kind,
        value: detector.value,
        confidence: detector.confidence,
        basis: [basis(script, detector.detector)],
      }),
    );
  }
};

interface RouteFrameworkContext {
  readonly script: IncludedScript;
  readonly name: string;
  readonly node: t.Node;
  readonly accumulator: AnalysisAccumulator;
}

const addRouteFrameworkInference = (context: RouteFrameworkContext): void => {
  const value =
    context.name.endsWith("useRoutes") ||
    context.name.endsWith("createBrowserRouter")
      ? "React Router-compatible route API"
      : "Generic route registration API";
  const key = `route-framework\0${context.script.script_key}\0${value}`;
  addUnique(context.accumulator, key, () =>
    context.accumulator.inferences.push({
      kind: "route_framework",
      value,
      confidence: "medium",
      basis: [
        {
          ...basis(context.script, `call:${context.name}`),
          ...locationFields(context.node),
        },
      ],
    }),
  );
};

const addUnique = (
  accumulator: AnalysisAccumulator,
  key: string,
  add: () => void,
): void => {
  if (accumulator.seen.has(key)) return;
  accumulator.seen.add(key);
  add();
};

const basis = (script: IncludedScript, detector: string) => ({
  script_key: script.script_key,
  artifact_sha256: script.source.artifact.sha256,
  line: null,
  column: null,
  detector,
});

const vendorDetectors: readonly {
  readonly value: string;
  readonly detector: string;
  readonly patterns: readonly string[];
  readonly confidence: Inference["confidence"];
  readonly kind: Inference["kind"];
}[] = [
  {
    value: "webpack",
    detector: "webpack-runtime",
    patterns: ["__webpack_require__"],
    confidence: "high",
    kind: "bundle_runtime",
  },
  {
    value: "Vite",
    detector: "vite-runtime",
    patterns: ["__vite__", "import.meta.hot"],
    confidence: "medium",
    kind: "bundle_runtime",
  },
  {
    value: "React",
    detector: "react-runtime",
    patterns: ["__REACT_DEVTOOLS_GLOBAL_HOOK__", "React.createElement"],
    confidence: "medium",
    kind: "vendor_fingerprint",
  },
  {
    value: "Vue",
    detector: "vue-runtime",
    patterns: ["__VUE__", "createApp("],
    confidence: "medium",
    kind: "vendor_fingerprint",
  },
  {
    value: "Next.js",
    detector: "next-runtime",
    patterns: ["__NEXT_DATA__", "/_next/"],
    confidence: "high",
    kind: "vendor_fingerprint",
  },
  {
    value: "Angular",
    detector: "angular-runtime",
    patterns: ["ɵɵdefineComponent"],
    confidence: "high",
    kind: "vendor_fingerprint",
  },
  {
    value: "Svelte",
    detector: "svelte-runtime",
    patterns: ["svelte/internal"],
    confidence: "medium",
    kind: "vendor_fingerprint",
  },
];
