import {
  JsonSchemaReferences,
  type JsonSchemaScope,
} from "./jsonSchemaReferences.js";
import { z } from "zod";

import type { ToolContract } from "./toolContractTypes.js";
import { advertisedInputExamples } from "./advertisedInputExamples.js";
import { presentInputJsonSchema } from "./inputSchemaPresentation.js";
import {
  schemaArrays,
  schemaChildren,
  schemaMaps,
  schemaLiteralValues,
} from "./jsonSchemaKeywords.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import { getEvidenceInputContract } from "../domain/evidenceInputContract.js";

const PROPERTY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  addresses: "Ordered provider-normalized procedure addresses to analyze.",
  after: "The later or right-hand observation to compare.",
  before: "The earlier or left-hand observation to compare.",
  boundary_id: "Exact reconstruction boundary identifier to evaluate.",
  case_sensitive:
    "Whether text matching distinguishes uppercase and lowercase.",
  cdp_endpoint: "Literal loopback Chrome DevTools Protocol endpoint.",
  comment: "Exact analyst comment text to write.",
  comparisons: "Validated comparison Evidence records to aggregate.",
  coverage: "Exact reconstruction-coverage commitment to verify.",
  direction: "Direction in which to traverse or compare relationships.",
  document: "Exact provider document or program identity.",
  error: "Structured, caller-actionable error when the operation fails.",
  evidence: "Evidence record produced by this operation.",
  evidence_id: "Stable identifier of the recorded Evidence observation.",
  executable: "Command name or executable path to run.",
  format: "Declared input artifact format.",
  name: "Exact name used by this operation.",
  pattern:
    "Literal text or regular expression used to filter matching results.",
  phase: "Current plan or execution phase of the operation.",
  plan: "Content-bound execution plan and its digest commitment.",
  query: "Non-empty feature or text query to investigate.",
  question: "Concrete unresolved question to retain for later investigation.",
  result: "Primary structured result returned by this operation.",
  left: "Left-hand input used for comparison or differential execution.",
  limits:
    "Resource budgets that bound execution and retained output for this operation.",
  mode: "Operation mode that selects the requested behavior.",
  overwrite: "Whether an existing destination may be replaced.",
  path: "Local filesystem path used by this operation.",
  provider_id:
    "Exact deep-analysis provider ID, or automatic selection when omitted.",
  right: "Right-hand input used for comparison or differential execution.",
  source_evidence:
    "Evidence records supporting the prepared source transformation.",
  status: "Current lifecycle or verification status.",
  summary: "Concise evidence-backed summary of the result.",
  symbols: "Ordered Swift symbols to demangle.",
  target_id:
    "Exact CDP target identifier selected from the endpoint's target listing.",
  unknown_id: "Exact residual-unknown identifier.",
};

type JsonSchemaProjection = z.ZodType["~standard"]["jsonSchema"]["input"];

/** Attach caller guidance to a canonical schema for the SDK wire projection. */
export const toolInputSchemaWithMetadata = <Contract extends ToolContract>(
  contract: Contract,
): Contract["inputSchema"] =>
  withAdvertisedJsonSchema(
    contract.inputSchema,
    "input",
    (project) => (options) => {
      const inline = project({
        ...options,
        libraryOptions: { ...options.libraryOptions, reused: "inline" },
      });
      const examples = advertisedInputExamples(contract);
      const presented = presentInputJsonSchema(
        inline,
        fallbackPropertyDescription,
      );
      const sourceGuidance = getEvidenceInputContract(contract.inputSchema)
        .hasEvidence
        ? 'Declared Evidence fields accept complete records or {"kind":"retained-evidence","evidence_id":"ev_..."}. For a complete source, use the summary\'s parent_evidence_id.'
        : undefined;
      return {
        // Keep advertised parameters self-contained for clients that do not
        // resolve local references. The registered canonical schema remains
        // responsible for runtime validation.
        ...presented,
        ...(sourceGuidance === undefined
          ? {}
          : {
              description: [presented.description, sourceGuidance]
                .filter((text) => typeof text === "string")
                .join(" "),
            }),
        ...(examples.length === 0 ? {} : { examples }),
      };
    },
  );

/** Return the full-profile advertised input JSON Schema registered on MCP. */
export const advertisedInputJsonSchema = <Contract extends ToolContract>(
  contract: Contract,
): Record<string, unknown> =>
  toolInputSchemaWithMetadata(contract)["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  }) as Record<string, unknown>;

/** Share output definitions and content-bound validator identities on the wire. */
export const toolOutputSchemaWithMetadata = <Contract extends ToolContract>(
  contract: Contract,
): Contract["outputSchema"] =>
  withAdvertisedJsonSchema(
    contract.outputSchema,
    "output",
    (project) => (options) => {
      const shared = project({
        ...options,
        libraryOptions: { reused: "ref", ...options.libraryOptions },
      });
      // An explicit ID owns the reference base. Relative external references
      // also depend on that base, so leave those projections unchanged.
      if ("$id" in shared || hasRelativeSchemaReference(shared)) return shared;
      return {
        ...shared,
        $id: `urn:rea:tool-output:sha256:${digestCanonicalValue(
          { target: options.target, schema: shared },
          "Tool output schema",
        )}`,
      };
    },
  );

/**
 * Apply a wire-presentation transform to one schema's advertised input
 * projection. The wrapper preserves the schema's own parser and standard
 * metadata, so both Zod registrations and plain standard schemas keep their
 * canonical validation while only the advertised JSON changes.
 */
export const transformAdvertisedInputJsonSchema = <Schema>(
  schema: Schema,
  transform: (projected: Record<string, unknown>) => Record<string, unknown>,
): Schema => {
  const standard = Reflect.get(schema as object, "~standard");
  if (!isSchemaRecord(standard)) return schema;
  const jsonSchema = Reflect.get(standard, "jsonSchema");
  if (!isSchemaRecord(jsonSchema)) return schema;
  const project = Reflect.get(jsonSchema, "input");
  if (typeof project !== "function") return schema;
  const byTarget = new Map<string, Record<string, unknown>>();
  const transformedInput = (options: unknown): unknown => {
    const target = Reflect.get(options as object, "target");
    const cacheable =
      typeof target === "string" &&
      Reflect.get(options as object, "libraryOptions") === undefined;
    if (cacheable) {
      const cached = byTarget.get(target);
      if (cached !== undefined) return cached;
    }
    const projected = (project as (options: unknown) => unknown)(options);
    const transformed = isSchemaRecord(projected)
      ? transform(projected)
      : projected;
    if (cacheable && isSchemaRecord(transformed))
      byTarget.set(target, transformed);
    return transformed;
  };
  return {
    ...(schema as object),
    "~standard": {
      ...standard,
      jsonSchema: { ...jsonSchema, input: transformedInput },
    },
  } as Schema;
};

type SchemaPosition = "schema" | "map" | "unknown";

const hasRelativeSchemaReference = (
  schema: Record<string, unknown>,
): boolean => {
  // Local pointers can make even annotation values executable schemas. Keep
  // their resource root and traversal role separate from ordinary instance data.
  const references = new JsonSchemaReferences(schema);
  const pending: {
    value: unknown;
    scope: JsonSchemaScope | undefined;
    position: SchemaPosition;
  }[] = [{ value: schema, scope: references.rootScope, position: "schema" }];
  const visited = new WeakMap<
    JsonSchemaScope,
    Record<SchemaPosition, WeakSet<object>>
  >();
  while (pending.length > 0) {
    const entry = pending.pop()!;
    const current = entry.value;
    if (current === null || typeof current !== "object") continue;
    const { position } = entry;
    const scope =
      position !== "map" && isSchemaRecord(current)
        ? references.enter(current, entry.scope)
        : entry.scope;
    if (scope === undefined) return true;
    let positions = visited.get(scope);
    if (positions === undefined) {
      positions = {
        schema: new WeakSet(),
        map: new WeakSet(),
        unknown: new WeakSet(),
      };
      visited.set(scope, positions);
    }
    if (positions[position].has(current)) continue;
    positions[position].add(current);
    if (Array.isArray(current)) {
      for (const value of current) pending.push({ value, scope, position });
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (
        position !== "map" &&
        ["$id", "$ref", "$dynamicRef", "$recursiveRef"].includes(key) &&
        typeof value === "string"
      ) {
        if (key === "$dynamicRef" || key === "$recursiveRef") return true;
        if (!value.startsWith("#") && !URL.canParse(value)) return true;
        if (key !== "$id" && value.startsWith("#")) {
          const target = references.resolve(scope, value);
          // Unknown anchors are already examined at their schema positions.
          // Unresolvable pointers retain the existing reference base.
          if (target.kind === "unresolved") return true;
          if (target.kind === "target")
            pending.push({ value: target.value, scope, position: "schema" });
        }
      }
      if (position === "schema" && schemaLiteralValues.has(key)) continue;
      const childPosition =
        position === "map"
          ? "schema"
          : position === "schema" && schemaMaps.has(key)
            ? "map"
            : position === "schema" &&
                (schemaArrays.has(key) || schemaChildren.has(key))
              ? "schema"
              : "unknown";
      if (value !== null && typeof value === "object")
        pending.push({ value, scope, position: childPosition });
    }
  }
  return false;
};

const withAdvertisedJsonSchema = <Schema extends z.ZodType>(
  canonical: Schema,
  io: "input" | "output",
  advertise: (project: JsonSchemaProjection) => JsonSchemaProjection = (
    project,
  ) => project,
): Schema => {
  // Zod's input projection drops root metadata when a descendant transforms.
  // Preserve the parser and let the SDK own conversion of everything else.
  const schema = canonical.meta(z.globalRegistry.get(canonical) ?? {});
  const standard = schema["~standard"];
  const project = standard.jsonSchema?.[io];
  if (project === undefined)
    throw new TypeError(
      `Tool ${io} schema does not expose Standard JSON Schema`,
    );
  Object.defineProperty(schema, "~standard", {
    value: {
      ...standard,
      jsonSchema: {
        ...standard.jsonSchema,
        [io]: memoizeByTarget(advertise(project)),
      },
    },
  });
  return schema;
};

// The SDK reconverts every registered schema on each `tools/list`, although a
// registered contract cannot change. Like the SDK's own memoized output
// projection, the advertised value is shared and treated as read-only.
const memoizeByTarget = (
  project: JsonSchemaProjection,
): JsonSchemaProjection => {
  const byTarget = new Map<string, Record<string, unknown>>();
  return (options) => {
    if (options.libraryOptions !== undefined) return project(options);
    const cached = byTarget.get(options.target);
    if (cached !== undefined) return cached;
    const projected = project(options);
    byTarget.set(options.target, projected);
    return projected;
  };
};

const isSchemaRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fallbackPropertyDescription = (property: string): string | undefined => {
  const explicit = Object.hasOwn(PROPERTY_DESCRIPTIONS, property)
    ? PROPERTY_DESCRIPTIONS[property]
    : undefined;
  if (explicit !== undefined) return explicit;
  const words = property.replaceAll("_", " ");
  if (property.startsWith("max_"))
    return `Maximum permitted ${words.slice(4)} for this operation.`;
  if (property.startsWith("include_"))
    return `Whether to include ${words.slice(8)} in the result.`;
  if (property.startsWith("expected_"))
    return `Expected ${words.slice(9)} used to reject stale or mismatched input.`;
  if (property.endsWith("_sha256"))
    return `Exact SHA-256 digest of ${words.slice(0, -7)}.`;
  if (property.endsWith("_evidence_id"))
    return `Exact Evidence identifier for the ${words.slice(0, -12)} observation.`;
  if (property.endsWith("_evidence_ids"))
    return `Ordered Evidence identifiers for the ${words.slice(0, -13)} observations.`;
  if (property.endsWith("_path"))
    return `Local filesystem path for ${words.slice(0, -5)}.`;
  if (property.endsWith("_uri"))
    return `Canonical URI for ${words.slice(0, -4)}.`;
  if (property.endsWith("_bytes"))
    return `Byte count for ${words.slice(0, -6)}.`;
  if (property.endsWith("_root") || property.endsWith("_roots"))
    return `Local filesystem ${words} selected for this operation.`;
  if (property.startsWith("is_") || property.startsWith("has_"))
    return `Whether ${words}.`;
  // A generic sentence would only restate the property name in every schema.
  return undefined;
};
