import {
  javaScriptSemanticUnknownOmissionsSchema,
  javaScriptSemanticNodeSchema,
  javaScriptSemanticRelationSchema,
  javaScriptSemanticUnknownSchema,
  javaScriptSemanticFingerprintSchema,
  javaScriptSemanticEvidenceContextSchema,
} from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import { z } from "zod";
import { digestSchema } from "../../domain/digests.js";
import type { JavaScriptStaticAnalysis } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import { javaScriptRouteSourceFactsSchema } from "../../domain/javascript/javascriptRouteFacts.js";
import { javaScriptStaticCoverageSchema } from "../../domain/javascript/javascriptStaticCoverage.js";
import { JAVASCRIPT_AST_FINGERPRINT_ALGORITHM } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import type {
  JavaScriptSemanticProperty,
  JavaScriptSemanticValue,
} from "../../domain/javascript/javascriptSemanticValueTypes.js";
import { javaScriptSemanticResourceLimitSchema } from "../../domain/javascript/javascriptSemanticValueTypes.js";

const range =
  javaScriptSemanticNodeSchema.shape.identity.shape.source_range.unwrap();
const count = z.int().nonnegative();
const strings = z.array(z.string());
const pathContext = z.enum(["module-specifier", "filesystem-expression"]);
const findingContext = {
  module_key: z.string().nullable(),
  module_runtime: z.string().optional(),
  location: range,
};
const withRuntime = <
  Value extends {
    module_runtime?: string | undefined;
    resolution_basis?: "wrapper-substitution" | undefined;
  },
>(
  value: Value,
) => {
  const { module_runtime, resolution_basis, ...rest } = value;
  return {
    ...rest,
    ...(module_runtime === undefined ? {} : { module_runtime }),
    ...(resolution_basis === undefined ? {} : { resolution_basis }),
  };
};
const staticValue = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("literal"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    expression: z.null(),
  }),
  z.strictObject({
    status: z.literal("dynamic"),
    value: z.null(),
    expression: z.string(),
  }),
]);
const nullHandler = { handler_kind: z.null(), handler_location: z.null() };
const missingHandler = {
  handler_kind: z.literal("missing"),
  handler_location: z.null(),
};
const locatedHandler = {
  handler_kind: z.enum([
    "inline-function",
    "identifier",
    "member-expression",
    "dynamic-expression",
  ]),
  handler_location: range,
};
const ipcReceiver = z
  .strictObject({
    kind: z.enum(["web-contents", "main-frame"]),
    owner_location: range,
  })
  .exactOptional();
const ipcChannel = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.union([
    z.strictObject({
      ...findingContext,
      receiver: ipcReceiver,
      invocation_location: range.optional(),
      resolution_basis: z.literal("wrapper-substitution").optional(),
      ...shape,
      channel: z.string(),
      channel_expression: z.null(),
    }),
    z.strictObject({
      ...findingContext,
      receiver: ipcReceiver,
      invocation_location: range.optional(),
      resolution_basis: z.literal("wrapper-substitution").optional(),
      invocation_channels: z.literal("literal").exactOptional(),
      guarded_invocation_channels: strings.exactOptional(),
      ...shape,
      channel: z.null(),
      channel_expression: z.string(),
    }),
  ]);
const ipc = z
  .union([
    ipcChannel({
      side: z.literal("renderer"),
      operation: z.enum(["send", "send-sync", "post-message", "send-to-host"]),
      mode: z.literal("send"),
      ...nullHandler,
    }),
    ipcChannel({
      side: z.literal("renderer"),
      operation: z.literal("invoke"),
      mode: z.literal("invoke"),
      ...nullHandler,
    }),
    ipcChannel({
      side: z.enum(["renderer", "main"]),
      operation: z.enum(["on", "once"]),
      mode: z.literal("listen"),
      ...missingHandler,
    }),
    ipcChannel({
      side: z.enum(["renderer", "main"]),
      operation: z.enum(["on", "once"]),
      mode: z.literal("listen"),
      ...locatedHandler,
    }),
    ipcChannel({
      side: z.literal("main"),
      operation: z.enum(["handle", "handle-once"]),
      mode: z.literal("handle"),
      ...missingHandler,
    }),
    ipcChannel({
      side: z.literal("main"),
      operation: z.enum(["handle", "handle-once"]),
      mode: z.literal("handle"),
      ...locatedHandler,
    }),
  ])
  .transform((value) => {
    const { module_runtime, resolution_basis, invocation_location, ...rest } =
      value;
    return {
      ...rest,
      ...(module_runtime === undefined ? {} : { module_runtime }),
      ...(resolution_basis === undefined ? {} : { resolution_basis }),
      ...(invocation_location === undefined ? {} : { invocation_location }),
    };
  });
const windowShape = {
  ...findingContext,
  options_status: z.enum(["object-literal", "dynamic", "missing"]),
  web_preferences_status: z.enum(["object-literal", "dynamic", "missing"]),
  web_preferences: z.array(
    z.strictObject({ name: z.string(), value: staticValue }),
  ),
  resolution_sources: z.array(range).exactOptional(),
};
const bridgeShape = {
  resolution_basis: z.literal("wrapper-substitution").optional(),
  ...findingContext,
  world: z.enum(["main", "isolated"]),
  world_id: staticValue.nullable(),
  api_status: z.enum(["object-literal", "dynamic", "missing"]),
  members: strings,
  unknown_members: count,
};
const utilityShape = { ...findingContext, service_name: z.string().nullable() };
const electron = z
  .strictObject({
    app_path_changes: z
      .array(z.strictObject(findingContext).transform(withRuntime))
      .optional(),
    call_paths: z
      .array(
        z.strictObject({
          entry_kind: z.enum(["bridge-member", "ipc-handler"]),
          entry: z.string(),
          entry_path: strings.optional(),
          channel: z.string().nullable(),
          terminal: z.string(),
          resolution: z.literal("candidate"),
          steps: z.array(
            z.strictObject({
              kind: z.enum([
                "exposure",
                "factory",
                "function",
                "call",
                "ipc",
                "terminal",
              ]),
              label: z.string(),
              location: range,
              module_key: z.string().nullable(),
              module_runtime: z.string().nullable(),
            }),
          ),
          conditions: z.array(
            z.strictObject({ expression: z.string(), location: range }),
          ),
        }),
      )
      .transform((paths) =>
        paths.map(({ entry_kind, entry, entry_path, ...rest }) =>
          entry_path === undefined
            ? { entry_kind, entry, ...rest }
            : { entry_kind, entry, entry_path, ...rest },
        ),
      )
      .optional(),
    browser_windows: z.array(
      z.union([
        z
          .strictObject({
            ...windowShape,
            preload_path: z.string(),
            preload_resolution_context: pathContext,
          })
          .transform(withRuntime),
        z
          .strictObject({
            ...windowShape,
            preload_path: z.null(),
            preload_resolution_context: z.null(),
          })
          .transform(withRuntime),
      ]),
    ),
    context_bridge_apis: z.array(
      z.union([
        z
          .strictObject({
            ...bridgeShape,
            api_key: z.string(),
            api_key_expression: z.null(),
          })
          .transform(withRuntime),
        z
          .strictObject({
            ...bridgeShape,
            api_key: z.null(),
            api_key_expression: z.string(),
          })
          .transform(withRuntime),
        z
          .strictObject({
            ...bridgeShape,
            api_key: z.null(),
            api_key_expression: z.null(),
          })
          .transform(withRuntime),
      ]),
    ),
    ipc: z.array(ipc),
    sender_validations: z.array(
      z.strictObject({
        ...findingContext,
        subject: z.enum([
          "sender-url",
          "sender-origin",
          "sender-frame",
          "sender-id",
          "frame-id",
          "process-id",
        ]),
        mechanism: z.string(),
        expected: staticValue,
        enforcement: z.literal("unknown"),
      }),
    ),
    utility_processes: z.array(
      z.union([
        z
          .strictObject({
            ...utilityShape,
            module_path: z.string(),
            module_resolution_context: pathContext,
            module_expression: z.null(),
          })
          .transform(withRuntime),
        z
          .strictObject({
            ...utilityShape,
            module_path: z.null(),
            module_resolution_context: z.null(),
            module_expression: z.string(),
          })
          .transform(withRuntime),
      ]),
    ),
    native_addon_bindings: z.array(
      z.strictObject({
        ...findingContext,
        specifier: z.string(),
        binding_kind: z.enum(["import", "require", "re-export"]),
        module_kind: z.enum(["import", "require"]),
        members: strings,
        namespace_access: z.boolean().optional(),
        dynamic_member_access: z.boolean().optional(),
      }),
    ),
    protocols: z.array(
      z
        .strictObject({
          ...findingContext,
          api: z.string(),
          role: z.enum([
            "os-default-client",
            "privileged-scheme",
            "handler",
            "interceptor",
          ]),
          scheme: staticValue,
          session: z.enum(["default-protocol", "default-session"]),
          enabled_privileges: strings.nullable(),
        })
        .transform(withRuntime),
    ),
  })
  .transform(({ call_paths, app_path_changes, ...rest }) => ({
    ...rest,
    ...(app_path_changes === undefined ? {} : { app_path_changes }),
    ...(call_paths === undefined ? {} : { call_paths }),
  }));
const referenceShape = {
  ...findingContext,
  operation: z.enum(["load", "resolve"]),
  resolution_base_path: z.string().exactOptional(),
  kind: z.enum([
    "static-import",
    "dynamic-import",
    "require",
    "worker",
    "service-worker",
  ]),
};

/** Exact producer facts recoverable before a later semantic worker failure. */
export const javaScriptWorkerStaticAnalysisSchema = z
  .strictObject({
    parse_status: z.enum(["complete", "partial", "failed"]),
    analysis_coverage: javaScriptStaticCoverageSchema.exactOptional(),
    routes: javaScriptRouteSourceFactsSchema.exactOptional(),
    parse_error_count: count,
    visited_ast_nodes: count,
    references: z.array(
      z.union([
        z
          .strictObject({
            ...referenceShape,
            specifier: z.string(),
            expression: z.null(),
          })
          .transform(withRuntime),
        z
          .strictObject({
            ...referenceShape,
            specifier: z.null(),
            expression: z.string(),
          })
          .transform(withRuntime),
      ]),
    ),
    endpoints: z.array(
      z.strictObject({
        ...findingContext,
        kind: z.enum(["route", "network"]),
        value: z.string(),
        mechanism: z.string(),
        interpretation: z.literal("candidate").exactOptional(),
        resolution: z.literal("partial").exactOptional(),
      }),
    ),
    storage: z.array(
      z.strictObject({
        ...findingContext,
        kind: z.enum([
          "local-storage",
          "session-storage",
          "indexed-db",
          "cache-storage",
          "sqlite",
        ]),
        interpretation: z.literal("candidate").exactOptional(),
        name: z.string().nullable(),
        mechanism: z.string(),
      }),
    ),
    bundler_registrations: z.array(
      z.strictObject({
        bundler: z.enum(["webpack", "rspack", "esbuild"]),
        runtime: z.string(),
        chunk_keys: strings,
        unknown_chunk_keys: count,
        runtime_require_name: z.string().nullable(),
        runtime_module_cache_status: z.enum(["observed", "not-observed"]),
        entry_module_keys: strings,
        unknown_entry_module_keys: count,
        async_chunk_keys: strings,
        unknown_async_chunk_keys: count,
        modules: z.array(
          z.strictObject({
            module_key: z.string(),
            factory_require_name: z.string().nullable(),
            source_sha256: digestSchema,
            exports: strings,
            location: range,
            structural_fingerprint_sha256: digestSchema,
            structural_fingerprint_algorithm: z.literal(
              JAVASCRIPT_AST_FINGERPRINT_ALGORITHM,
            ),
          }),
        ),
        location: range,
      }),
    ),
    role_paths: z.array(
      z.strictObject({
        ...findingContext,
        role: z.enum(["preload", "renderer"]),
        path: z.string(),
        path_base: z.literal("source-directory").exactOptional(),
        resolution_context: pathContext,
        mechanism: z.string(),
      }),
    ),
    source_map_urls: z.array(
      z.strictObject({ declared_url: z.string(), location: range }),
    ),
    vendors: strings,
    electron,
    limitations: strings,
  })
  .transform((analysis) => ({
    ...analysis,
    endpoints: analysis.endpoints.map(withRuntime),
    storage: analysis.storage.map(withRuntime),
    role_paths: analysis.role_paths.map(withRuntime),
    electron: {
      ...analysis.electron,
      sender_validations: analysis.electron.sender_validations.map(withRuntime),
      native_addon_bindings: analysis.electron.native_addon_bindings.map(
        (value) => {
          const { namespace_access, dynamic_member_access, ...rest } =
            withRuntime(value);
          return {
            ...rest,
            ...(namespace_access === undefined ? {} : { namespace_access }),
            ...(dynamic_member_access === undefined
              ? {}
              : { dynamic_member_access }),
          };
        },
      ),
    },
  })) satisfies z.ZodType<JavaScriptStaticAnalysis>;

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const property: z.ZodType<JavaScriptSemanticProperty> = z.lazy(() =>
  z.strictObject({
    name: z.string(),
    value: semanticValue,
    presence: z.enum(["present", "absent", "unknown-coverage"]),
  }),
);
const semanticValue: z.ZodType<JavaScriptSemanticValue> = z.lazy(() =>
  z
    .discriminatedUnion("status", [
      z.strictObject({ status: z.literal("literal"), value: primitive }),
      z.strictObject({
        status: z.literal("union"),
        values: z.array(primitive),
      }),
      z.discriminatedUnion("unknownProperties", [
        z.strictObject({
          status: z.literal("object"),
          properties: z.array(property),
          unknownProperties: z.literal(false),
          omittedProperties: z.literal(0),
        }),
        z.strictObject({
          status: z.literal("object"),
          properties: z.array(property),
          unknownProperties: z.literal(true),
          omittedProperties: count.nullable(),
        }),
      ]),
      z.discriminatedUnion("unknownItems", [
        z.strictObject({
          status: z.literal("array"),
          items: z.array(property),
          unknownItems: z.literal(false),
          omittedItems: z.literal(0),
        }),
        z.strictObject({
          status: z.literal("array"),
          items: z.array(property),
          unknownItems: z.literal(true),
          omittedItems: count.nullable(),
        }),
      ]),
      z.strictObject({
        status: z.enum(["unknown", "ambiguous", "cycle"]),
        reason: z.string(),
        resourceLimit: javaScriptSemanticResourceLimitSchema.optional(),
      }),
    ])
    .transform((value) => {
      if (
        value.status === "literal" ||
        value.status === "union" ||
        value.status === "object" ||
        value.status === "array"
      )
        return value;
      const { resourceLimit: limit, ...rest } = value;
      return {
        ...rest,
        ...(limit === undefined ? {} : { resourceLimit: limit }),
      };
    }),
);
const origin = z
  .strictObject({
    specifier: z.string(),
    importedPath: strings,
    resolutionMode: z
      .enum(["import", "require", "compiler-dependent"])
      .optional(),
  })
  .transform(({ resolutionMode, ...rest }) => ({
    ...rest,
    ...(resolutionMode === undefined ? {} : { resolutionMode }),
  }));
const provenance = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("module"),
    origins: z.tuple([origin]),
    reason: z.null(),
  }),
  z.strictObject({
    status: z.literal("local"),
    origins: z.tuple([]),
    reason: z.null(),
  }),
  z.strictObject({
    status: z.literal("ambiguous"),
    origins: z.array(origin),
    reason: z.string(),
  }),
  z.strictObject({
    status: z.enum(["unknown", "cycle"]),
    origins: z.tuple([]),
    reason: z.string(),
  }),
]);
const coverage = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("complete"),
      omittedCount: z.literal(0),
      resourceLimits: z.array(javaScriptSemanticResourceLimitSchema).optional(),
      widenedReturnedReferences: z.array(range).optional(),
    }),
    z.strictObject({
      status: z.literal("partial"),
      omittedCount: z.union([z.literal(0), z.null()]),
      resourceLimits: z.array(javaScriptSemanticResourceLimitSchema).optional(),
      widenedReturnedReferences: z.array(range).optional(),
    }),
    z.strictObject({
      status: z.literal("failed"),
      omittedCount: z.null(),
      resourceLimits: z.array(javaScriptSemanticResourceLimitSchema).optional(),
      widenedReturnedReferences: z.array(range).optional(),
    }),
  ])
  .transform((value) => {
    const { resourceLimits, widenedReturnedReferences, ...rest } = value;
    return {
      ...rest,
      ...(resourceLimits === undefined ? {} : { resourceLimits }),
      ...(widenedReturnedReferences === undefined
        ? {}
        : { widenedReturnedReferences }),
    };
  });
const moduleLink = z
  .strictObject({
    resolutionMode: z
      .enum(["import", "require", "compiler-dependent"])
      .optional(),
    kind: z.enum([
      "import",
      "type-import",
      "require",
      "export",
      "re-export",
      "commonjs-export",
    ]),
    specifier: z.string().nullable(),
    importedName: z.string().nullable(),
    localName: z.string().nullable(),
    exportedName: z.string().nullable(),
    callableId: z.string().nullable(),
    location: range,
  })
  .transform(({ resolutionMode, ...rest }) => ({
    ...rest,
    ...(resolutionMode === undefined ? {} : { resolutionMode }),
  }));
const definitionKind = z.enum([
  "import",
  "variable",
  "parameter",
  "function",
  "class",
  "catch",
  "assignment",
]);
const scope = z.strictObject({
  scopeId: z.string(),
  parentScopeId: z.string().nullable(),
  kind: z.enum([
    "program",
    "function",
    "block",
    "static-block",
    "class",
    "catch",
  ]),
  location: range,
  bindingsComplete: z.boolean(),
  bindingIds: strings,
});
const binding = z
  .strictObject({
    bindingId: z.string(),
    scopeId: z.string(),
    name: z.string(),
    kind: definitionKind,
    mutable: z.boolean(),
    definitions: z.array(
      z.strictObject({ kind: definitionKind, location: range }),
    ),
    value: semanticValue,
    initializerValue: semanticValue.optional(),
    provenance,
  })
  .transform(({ initializerValue, ...rest }) => ({
    ...rest,
    ...(initializerValue === undefined ? {} : { initializerValue }),
  }));
const callable = z.strictObject({
  callableId: z.string(),
  kind: z.enum(["function", "class", "method"]),
  name: z.string().nullable(),
  containerScopeId: z.string(),
  bodyScopeId: z.string().nullable(),
  location: range,
  computedKeyLocation: range.nullable(),
  returnSites: z.array(
    z.strictObject({
      returnSiteId: z.string(),
      location: range,
      identityReferenceLocation: range.nullable(),
      valueExpressionLocation: range.nullable(),
      value: semanticValue,
    }),
  ),
  returnCoverage: z.strictObject({
    retainedCount: count,
    status: z.enum(["complete", "partial"]),
    omittedCount: z.union([z.literal(0), z.null()]),
  }),
});

/** Validate each transferred graph fact independently of its emitting realm. */
export const javaScriptWorkerGraphRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("evidence-context"),
    value: javaScriptSemanticEvidenceContextSchema,
  }),
  z.strictObject({
    kind: z.literal("node"),
    value: javaScriptSemanticNodeSchema,
  }),
  z.strictObject({
    kind: z.literal("relation"),
    value: javaScriptSemanticRelationSchema,
  }),
  z.strictObject({
    kind: z.literal("unknown"),
    value: javaScriptSemanticUnknownSchema,
  }),
  z.strictObject({
    kind: z.literal("fingerprint"),
    value: javaScriptSemanticFingerprintSchema,
  }),
]);

/** Portable per-file header, before any graph binding or immutable proof. */
export const javaScriptWorkerProjectionHeaderSchema = z.strictObject({
  omittedUnknownOccurrences:
    javaScriptSemanticUnknownOmissionsSchema.exactOptional(),
  roots: z.array(javaScriptSemanticNodeSchema.shape.node_id),
  nodesTruncated: z.boolean(),
});

/** Module facts are transferred individually to avoid a whole-IR JSON string. */
export const javaScriptWorkerModuleRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scope"), value: scope }),
  z.strictObject({ kind: z.literal("binding"), value: binding }),
  z.strictObject({ kind: z.literal("callable"), value: callable }),
  z.strictObject({ kind: z.literal("module-link"), value: moduleLink }),
]);

/** Coverage and limitations are independent of module collection sizes. */
export const javaScriptWorkerModuleHeaderSchema = z.strictObject({
  coverage,
  limitations: strings,
});
