import { digestCanonicalValue } from "../canonicalDigest.js";

import type { JavaScriptSemanticGraph } from "./javascriptSemanticGraph.js";
import type { JavaScriptSemanticGraphNode } from "./javascriptSemanticGraphSchemas.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { JavaScriptSemanticQueryInput } from "./javascriptSemanticQuerySchemas.js";
import { semanticCallLiteralValues } from "./javascriptSemanticCallLiterals.js";

/** Derive the stable identity for one graph-bound query. */
export const javaScriptSemanticQueryIdentifier = (
  graph: JavaScriptSemanticGraph,
  input: JavaScriptSemanticQueryInput,
): string => {
  const semantic = input;
  return `jsrq_${digestCanonicalValue(
    {
      source_graph_id: graph.graph_id,
      ...semantic,
      allowed_relations:
        semantic.allowed_relations === undefined
          ? undefined
          : uniqueSorted(semantic.allowed_relations),
      expected:
        semantic.expected === null
          ? null
          : {
              ...semantic.expected,
              classes: uniqueSorted(semantic.expected.classes),
            },
    },
    "JavaScript semantic query",
  )}`;
};

/** Resolve deterministic seed candidates without applying traversal limits. */
export const resolveJavaScriptSemanticQuerySeeds = (
  graph: JavaScriptSemanticGraph,
  input: JavaScriptSemanticQueryInput,
): string[] => {
  const fingerprintFunctions = new Set(
    input.seed.kind === "function"
      ? graph.fingerprints
          .filter(
            ({ fingerprint_sha256 }) =>
              input.seed.kind === "function" &&
              fingerprint_sha256 === input.seed.fingerprint_sha256,
          )
          .map(({ function_node_id }) => function_node_id)
      : [],
  );
  const unresolvedAccesses = new Set(
    input.seed.kind === "property"
      ? graph.unknowns.flatMap(({ family, node_id }) =>
          family === "object-flow" && node_id !== null ? [node_id] : [],
        )
      : [],
  );
  const seed = input.seed;
  const representedCalls = new Set(
    seed.kind === "literal"
      ? graph.nodes.flatMap((node) =>
          node.kind === "expression" &&
          node.properties.literal_argument_value === seed.value &&
          typeof node.properties.literal_argument_call_site_node_id === "string"
            ? [node.properties.literal_argument_call_site_node_id]
            : [],
        )
      : [],
  );
  return graph.nodes
    .filter((node) =>
      seedMatches(
        node,
        input,
        fingerprintFunctions,
        unresolvedAccesses,
        representedCalls,
      ),
    )
    .map(({ node_id }) => node_id)
    .sort(compareUnicodeCodePoints);
};

const seedMatches = (
  node: JavaScriptSemanticGraphNode,
  input: JavaScriptSemanticQueryInput,
  fingerprintFunctions: ReadonlySet<string>,
  unresolvedAccesses: ReadonlySet<string>,
  representedCalls: ReadonlySet<string>,
): boolean => {
  const seed = input.seed;
  if (seed.kind === "semantic-node") return node.node_id === seed.node_id;
  if (seed.kind === "application-node")
    return node.application_node_ids.includes(seed.node_id);
  if (seed.kind === "function") return fingerprintFunctions.has(node.node_id);
  if (seed.kind === "literal") {
    if (node.kind === "literal") return node.properties.value === seed.value;
    if (
      node.kind === "expression" &&
      typeof node.properties.literal_argument_call_site_node_id === "string"
    )
      return node.properties.literal_argument_value === seed.value;
    if (representedCalls.has(node.node_id)) return false;
    return semanticCallLiteralValues(node).some(
      (value) => value === seed.value,
    );
  }
  if (seed.kind === "property") {
    if (node.kind === "property-slot")
      return node.properties.name === seed.name;
    if (node.kind !== "expression") return false;
    const path = node.properties.property_path;
    // Older retained graphs did not record slot resolution. Their existing
    // source-bound unknown establishes an unresolved access without guessing
    // from an absent or resource-omitted relation.
    const slotless =
      node.properties.property_slot_resolution === "unresolved" ||
      (node.properties.property_slot_resolution === undefined &&
        unresolvedAccesses.has(node.node_id));
    return slotless && Array.isArray(path) && path.at(-1) === seed.name;
  }
  if (seed.kind === "endpoint")
    return (
      (node.kind === "request" || node.kind === "response") &&
      node.properties.endpoint === seed.value
    );
  if (seed.kind === "event")
    return (
      ["event", "listener"].includes(node.kind) &&
      node.properties.event_name === seed.name
    );
  return node.kind === "boundary" && node.properties.field === seed.field;
};
