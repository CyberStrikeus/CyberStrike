import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { JADX_BRIDGE_IDENTITY } from "../../../src/android/JadxRelease.ts";

// An actual child MCP server exercising the production stdio/process seam.
// It is a protocol fixture, not evidence of JADX decompiler support.
const mode = process.env.REA_FAKE_JADX_MODE ?? "normal";
const server = new McpServer({
  name: mode === "empty-server-identity" ? "" : "rea-jadx-bridge",
  version:
    mode === "empty-server-identity"
      ? ""
      : mode === "version"
        ? "99.0.0"
        : JADX_BRIDGE_IDENTITY.version,
});
const requestedCount = Number.parseInt(
  process.env.REA_FAKE_JADX_CLASS_COUNT ?? "",
  10,
);
const generatedCount =
  Number.isInteger(requestedCount) && requestedCount >= 0
    ? requestedCount
    : mode === "large-inventory"
      ? 9000
      : 400;
const classes = [
  "fixture.Target",
  ...Array.from(
    { length: generatedCount },
    (_, index) => `fixture.Class${index}`,
  ),
  ...(mode === "duplicate-class-name" ? ["fixture.Target"] : []),
];
const methods = [
  {
    name: "onCreate",
    raw_name: "onCreate",
    signature: "onCreate(Bundle): void",
    dex_descriptor: "(Landroid/os/Bundle;)V",
    is_constructor: false,
    def_pos: 0,
  },
  {
    name: "choose",
    raw_name: "choose",
    signature: "choose(String): void",
    dex_descriptor: "(Ljava/lang/String;)V",
    is_constructor: false,
    def_pos: 0,
  },
  {
    name: "choose",
    raw_name: "choose",
    signature: "choose(int): void",
    dex_descriptor: "(I)V",
    is_constructor: false,
    def_pos: 0,
  },
];
const text = (value) => ({ content: [{ type: "text", text: value }] });
const json = (value) => text(JSON.stringify(value));
const register = (name, handler) =>
  server.registerTool(name, { inputSchema: z.looseObject({}) }, handler);
register("rea_jvm_status", () =>
  json({
    engine_reported_version: mode === "engine-version" ? "0.7.0" : "0.7.1",
    max_heap_bytes:
      mode === "heap-failure" || mode === "other-memory-failure"
        ? 67108864
        : 8 * 1024 * 1024 * 1024,
    available_processors: 4,
    java_version: "21-fixture",
    metadata_scope: "parsed_members",
  }),
);
register("load_apk", async ({ path }) => {
  if (mode === "stall") await new Promise(() => {});
  if (mode === "heap-failure" || mode === "other-memory-failure")
    return {
      ...json({
        kind: "jvm-memory-failure",
        memory_area: mode === "heap-failure" ? "heap" : "unknown",
        exception_type: "java.lang.OutOfMemoryError",
        message: mode === "heap-failure" ? "Java heap space" : "Metaspace",
        max_heap_bytes: 67108864,
      }),
      isError: true,
    };
  if (mode === "heap-decoy")
    return {
      ...text("load failed: cannot read /inputs/Java heap space.apk"),
      isError: true,
    };
  return json({
    state: "LOADED",
    apk_path: mode === "wrong-apk" ? "/different.apk" : path,
    class_count: classes.length,
    resource_count: 1,
    threads: 1,
    resources: "full",
  });
});
register("rea_native_declarations", ({ path }) => {
  if (typeof path !== "string")
    return { ...text("path must be a string"), isError: true };
  const methods = [
    {
      source_index: 0,
      class_name: "fixture.Target",
      method_name: "readNative",
      descriptor: "(I)I",
      dex_entry: "classes.dex",
      dex_entry_index: 0,
      class_index: 0,
      method_index: 1,
    },
  ];
  if (mode === "duplicate-native-declaration")
    methods.push({
      ...methods[0],
      source_index: 1,
      dex_entry: "classes2.dex",
      dex_entry_index: 1,
    });
  return json({
    scope: "apk-root-dex-declarations",
    methods,
    coverage: {
      status: mode === "partial-native-inventory" ? "partial" : "complete",
      dex_entries: mode === "partial-native-inventory" ? 2 : methods.length,
      examined_dex_entries: methods.length,
      examined_classes: methods.length,
      examined_methods: methods.length,
    },
    unknowns:
      mode === "partial-native-inventory"
        ? ["Controlled unreadable second DEX member"]
        : [],
  });
});
register("get_app_info", () => {
  if (mode === "rpc-disconnect") process.exit(17);
  return json({
    package: "fixture",
    version_name: "1",
    version_code: "1",
    min_sdk: "26",
    target_sdk: "33",
    permissions: ["android.permission.INTERNET"],
  });
});
register("get_android_manifest", () => {
  if (mode === "tool-error" || mode === "cleanup-failure")
    return {
      ...text("manifest decoder rejected malformed binary XML"),
      isError: true,
    };
  if (mode === "frame-overflow") return text("x".repeat(9 * 1024 * 1024));
  if (mode === "large-manifest") return text("x".repeat(1024 * 1024));
  return text('<manifest package="fixture"/>');
});
register("list_classes", ({ offset, limit, query = "" }) => {
  const matching = [];
  let nextOffset = offset;
  while (nextOffset < classes.length && matching.length < limit) {
    const name = classes[nextOffset++];
    if (name.includes(query)) matching.push(name);
  }
  const page = {
    scope: "top_level",
    total_classes: classes.length,
    next_offset: nextOffset,
    offset,
    limit,
    items: mode === "empty-page" ? [] : matching,
    ...(mode === "search-audit-metadata"
      ? {
          fixture_metadata: {
            page_offset: offset,
            retained: "unknown page field",
          },
        }
      : {}),
  };
  const response = json(page);
  if (mode !== "search-audit-metadata") return response;
  return {
    ...response,
    _meta: { fixture_envelope_offset: offset },
    content: response.content.map((entry) => ({
      ...entry,
      annotations: { audience: ["user"], priority: 0.5 },
      _meta: { fixture_content_offset: offset },
    })),
  };
});
register("get_class_summary", () =>
  json({
    full_name: mode === "wrong-class" ? "fixture.Other" : "fixture.Target",
    raw_name: mode === "wrong-class" ? "fixture.Other" : "fixture.Target",
    name: "Target",
    method_count: mode === "summary-error" ? -1 : methods.length,
    field_count: 0,
    inner_class_count: 0,
    methods: mode === "summary-error" ? [] : methods,
    fields: [],
    inner_classes: [],
    inner_class_raw_names: [],
    ...(mode === "summary-error" ? { error: "summary timed out" } : {}),
  }),
);
register("get_method_body", ({ method_name, overload_index }) => {
  if (mode === "body-error")
    return {
      ...text("// ERROR: decompile timed out or failed"),
      isError: true,
    };
  const selected = methods.filter((method) => method.name === method_name)[
    overload_index
  ];
  return json({
    class_name: "fixture.Target",
    method_name,
    full_name: `fixture.Target.${method_name}`,
    overload_index:
      mode === "wrong-method" ? overload_index + 1 : overload_index,
    overload_count: method_name === "choose" ? 2 : 1,
    dex_descriptor:
      mode === "wrong-descriptor" ? "()V" : selected.dex_descriptor,
    mode:
      mode === "smali" || mode === "selected-overload-smali" ? "smali" : "java",
    fell_back: mode === "smali" || mode === "selected-overload-smali",
    markers:
      mode === "smali" || mode === "selected-overload-smali"
        ? ["Method not decompiled"]
        : mode === "native-method"
          ? ["native_method"]
          : [],
    body:
      mode === "smali" || mode === "selected-overload-smali"
        ? `.method public ${method_name}${selected.dex_descriptor}\n    .registers 2\n    return-void\n.end method`
        : mode === "native-method"
          ? ""
          : mode === "truncated"
            ? "void onCreate(){}\n\n... [truncated: exceeds 18 bytes, total 100 bytes]"
            : `void ${method_name}() { /* overload ${overload_index} */ }`,
  });
});
for (const name of ["get_xrefs_to_class", "get_xrefs_to_method"])
  register(name, ({ class_name, method_name, overload_index }) =>
    json({
      target:
        method_name === undefined ? class_name : `${class_name}.${method_name}`,
      ...(method_name === undefined
        ? {}
        : {
            overload_index,
            reported_signature: methods.filter(
              (method) => method.name === method_name,
            )[overload_index]?.signature,
          }),
      total: mode === "partial-xrefs" ? 2 : 1,
      count: 1,
      resolve_line: false,
      items: [
        {
          kind: "method",
          name: "caller",
          full_name: "fixture.Other.caller",
          containing_class: "fixture.Other",
          top_class: "fixture.Other",
          def_pos: 42,
        },
      ],
    }),
  );
await server.connect(new StdioServerTransport());
// A refused cleanup must leave a live process for verified fixture teardown.
// Otherwise stdin EOF races the ownership scan with the server's natural exit.
if (mode === "cleanup-failure") setInterval(() => {}, 1000);
