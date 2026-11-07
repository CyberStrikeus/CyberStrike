import { expect, it } from "vitest";

import {
  analyzeJadxRequest,
  type JadxToolPort,
} from "../../../src/android/JadxAnalysis.js";
import {
  type AndroidRequest,
  androidInputSchemas,
  androidResultSchemas,
} from "../../../src/domain/android/androidAnalysis.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import {
  ANDROID_MAPPING_LIMITS,
  type AndroidMappingSource,
} from "../../../src/domain/android/androidMapping.js";
import { parseProguardMapping } from "../../../src/domain/android/proguardMapping.js";

const summary = {
  full_name: "fixture.Target",
  raw_name: "fixture.Target",
  name: "Target",
  method_count: 2,
  field_count: 0,
  inner_class_count: 0,
  methods: [
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
  ],
  fields: [],
  inner_classes: [],
  inner_class_raw_names: [],
};

const engine = {
  name: "jadx",
  version: "0.7.1",
  artifact_sha256: "a".repeat(64),
  source_revision: null,
  worker_count: 1,
  heap_limit_mib: null,
};

it.each([
  ["", "", true, true, null],
  ["16", "", true, true, null],
  ["17", "", false, true, null],
  ["33", "", false, null, null],
  ["16", "17", false, true, null],
  ["Preview", "", null, null, null],
  ["1", "Preview", null, null, null],
  ["", "", null, null, 'android:targetSdkVersion=""'],
  ["", "", null, null, 'android:minSdkVersion=""'],
  [
    "16",
    "",
    null,
    null,
    'android:minSdkVersion="16" android:targetSdkVersion=""',
  ],
] as const)(
  "derives export rules from minimum SDK %s and declared target %s",
  async (minimum, target, providerDefault, activityDefault, sourceSdk) => {
    const sdk =
      sourceSdk ??
      [
        minimum === "" ? "" : `android:minSdkVersion="${minimum}"`,
        target === "" ? "" : `android:targetSdkVersion="${target}"`,
      ]
        .filter(Boolean)
        .join(" ");
    const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example">${sdk === "" ? "" : `<uses-sdk ${sdk}/>`}<application><provider android:name=".Data"/><activity android:name=".Filtered"><intent-filter><action android:name="example.OPEN"/></intent-filter></activity></application></manifest>`;
    const tools: JadxToolPort = {
      json: (name) => {
        expect(name).toBe("get_app_info");
        return Promise.resolve({
          package: "com.example",
          version_name: "",
          version_code: "",
          min_sdk: minimum,
          target_sdk: target,
          permissions: [],
        });
      },
      text: (name) => {
        expect(name).toBe("get_android_manifest");
        return Promise.resolve(manifest);
      },
      listClasses: () => Promise.reject(new Error("Unexpected class query")),
    };
    const report = androidResultSchemas.inspect_android_package.parse(
      await analyzeJadxRequest(
        tools,
        {
          operation: "inspect_android_package",
          input: { path: "/fixture.apk" },
        },
        {
          loaded: {
            state: "LOADED",
            apk_path: "/snapshot.apk",
            class_count: 0,
            resource_count: 1,
            threads: 1,
            resources: "full",
          },
          engine,
        },
      ),
    );
    expect(report.target_sdk).toBe(target || null);
    expect(report.min_sdk).toBe(minimum || null);
    expect(report.components.status).toBe("complete");
    expect(report.components.items[0]?.exported_default).toBe(providerDefault);
    expect(report.components.items[1]?.exported_default).toBe(activityDefault);
    if (sourceSdk !== null || minimum === "Preview" || target === "Preview")
      expect(report.components.limitations.join(" ")).toContain(
        "target SDK is unknown",
      );
    else if (minimum === "33" && target === "")
      expect(report.components.limitations.join(" ")).toContain(
        "requires an explicit value",
      );
    else expect(report.components.limitations).toEqual([]);
  },
);

const nestedClassInput = {
  path: "/fixture.apk",
  class_name: "fixture.Outer$Worker",
};
const nestedClassRequests: AndroidRequest[] = [
  { operation: "inspect_android_class", input: nestedClassInput },
  {
    operation: "inspect_android_method",
    input: { ...nestedClassInput, method_name: "choose" },
  },
  { operation: "trace_android_references", input: nestedClassInput },
  {
    operation: "trace_android_references",
    input: { ...nestedClassInput, method_name: "choose" },
  },
];

it.each(nestedClassRequests)(
  "preserves the raw nested class selector for $operation and its followups: $input",
  async (request) => {
    const calls: Record<string, unknown>[] = [];
    const fullName = "fixture.Outer.Worker";
    const selected = summary.methods[1]!;
    const tools: JadxToolPort = {
      listClasses: () =>
        Promise.reject(new Error("unexpected class inventory call")),
      text: () => Promise.reject(new Error("unexpected text call")),
      json: (name, input) => {
        calls.push({ name, ...input });
        if (name === "get_class_summary")
          return Promise.resolve({
            ...summary,
            full_name: fullName,
            raw_name: nestedClassInput.class_name,
            method_count: 1,
            methods: [selected],
          });
        if (name === "get_method_body")
          return Promise.resolve({
            class_name: fullName,
            method_name: selected.name,
            full_name: `${fullName}.${selected.name}`,
            overload_index: 0,
            overload_count: 1,
            dex_descriptor: selected.dex_descriptor,
            mode: "java",
            fell_back: false,
            markers: [],
            body: "void choose(int value) {}",
          });
        return Promise.resolve({
          target:
            input.method_name === undefined
              ? fullName
              : `${fullName}.${selected.name}`,
          ...(input.method_name === undefined
            ? {}
            : {
                overload_index: 0,
                reported_signature: selected.signature,
              }),
          total: 0,
          count: 0,
          resolve_line: false,
          items: [],
        });
      },
    };
    const result = await analyzeJadxRequest(tools, request, {
      loaded: {} as never,
      engine,
    });
    expect(result).toMatchObject({ class_name: fullName });
    expect(calls.map((call) => call.class_name)).toEqual(
      Array.from({ length: calls.length }, () => nestedClassInput.class_name),
    );
    expect(calls).toHaveLength(
      request.operation === "inspect_android_class" ? 1 : 2,
    );
  },
);

it("rejects a nested class when neither producer identity matches the requested selector", async () => {
  await expect(
    analyzeJadxRequest(
      {
        listClasses: () =>
          Promise.reject(new Error("unexpected class inventory call")),
        text: () => Promise.reject(new Error("unexpected text call")),
        json: () =>
          Promise.resolve({
            ...summary,
            full_name: "fixture.Outer.Worker",
            raw_name: "fixture.Outer$Different",
          }),
      },
      { operation: "inspect_android_class", input: nestedClassInput },
      { loaded: {} as never, engine },
    ),
  ).rejects.toMatchObject({ _tag: "AnalysisInputError" });
});

it("pages filtered matches independently of the examined inventory and preserves cross-page duplicates", async () => {
  const names = Array.from({ length: 5000 }, (_, i) => `fixture.Target${i}`);
  names[0] = "fixture.TargetDuplicate";
  names[4096] = "fixture.TargetDuplicate";
  const calls: Record<string, unknown>[] = [];
  const tools: JadxToolPort = {
    json: () => Promise.reject(new Error("unexpected JSON call")),
    listClasses: (input) => {
      calls.push({ ...input });
      const offset = Number(input.offset);
      return Promise.resolve({
        scope: "top_level" as const,
        total_classes: 10000,
        next_offset: offset === 0 ? 8191 : 10000,
        offset,
        limit: 4096,
        items: offset === 0 ? names.slice(0, 4096) : names.slice(4096),
      });
    },
    text: () => Promise.reject(new Error("unexpected text call")),
  };
  const result = await analyzeJadxRequest(
    tools,
    {
      operation: "search_android_classes",
      input: { path: "/fixture.apk", query: "Target" },
    },
    {
      loaded: {
        state: "LOADED",
        apk_path: "/snapshot.apk",
        class_count: 10000,
        resource_count: 0,
        threads: 1,
        resources: "full",
      },
      engine,
    },
  );
  expect(calls).toEqual([
    { query: "Target", offset: 0, limit: 4096 },
    { query: "Target", offset: 8191, limit: 4096 },
  ]);
  expect(result).toMatchObject({
    total_classes: 10000,
    matches: names,
    duplicate_names: [{ name: "fixture.TargetDuplicate", occurrences: 2 }],
    coverage: "complete",
  });
});

it.each([
  { name: "inventory total", query: "Target", page: { total_classes: 9 } },
  { name: "out-of-range cursor", query: "Target", page: { next_offset: 11 } },
  {
    name: "impossible examined row count",
    query: "Target",
    page: { next_offset: 1, items: ["TargetA", "TargetB"] },
  },
  { name: "offset identity", query: "Target", page: { offset: 1 } },
  { name: "requested page size", query: "Target", page: { limit: 1 } },
  { name: "nonmatching row", query: "Target", page: { items: ["Other"] } },
  {
    name: "non-progressing page",
    query: "Target",
    page: { next_offset: 0, items: [] },
  },
  { name: "premature page end", query: "Target", page: { next_offset: 9 } },
  { name: "empty-query completeness", query: "", page: {} },
])(
  "refuses changed $name instead of reporting complete search coverage",
  async ({ query, page }) => {
    const tools: JadxToolPort = {
      json: () => Promise.reject(new Error("unexpected JSON call")),
      listClasses: () =>
        Promise.resolve({
          scope: "top_level" as const,
          total_classes: 10,
          next_offset: 10,
          offset: 0,
          limit: 4096,
          items: ["fixture.Target"],
          ...page,
        }),
      text: () => Promise.reject(new Error("unexpected text call")),
    };
    await expect(
      analyzeJadxRequest(
        tools,
        {
          operation: "search_android_classes",
          input: { path: "/fixture.apk", query },
        },
        {
          loaded: {
            state: "LOADED",
            apk_path: "/snapshot.apk",
            class_count: 10,
            resource_count: 0,
            threads: 1,
            resources: "full",
          },
          engine,
        },
      ),
    ).rejects.toThrow();
  },
);

it("accepts an examined empty inventory without requiring cursor progress", async () => {
  const tools: JadxToolPort = {
    json: () => Promise.reject(new Error("unexpected JSON call")),
    listClasses: () =>
      Promise.resolve({
        scope: "top_level" as const,
        total_classes: 0,
        offset: 0,
        next_offset: 0,
        limit: 4096,
        items: [],
      }),
    text: () => Promise.reject(new Error("unexpected text call")),
  };
  const result = await analyzeJadxRequest(
    tools,
    {
      operation: "search_android_classes",
      input: { path: "/fixture.apk", query: "Target" },
    },
    {
      loaded: {
        state: "LOADED",
        apk_path: "/snapshot.apk",
        class_count: 0,
        resource_count: 0,
        threads: 1,
        resources: "full",
      },
      engine,
    },
  );
  expect(result).toMatchObject({
    total_classes: 0,
    matches: [],
    duplicate_names: [],
    coverage: "complete",
  });
});

it("requires explicit direct invoke coverage state in result evidence", () => {
  const result = {
    engine,
    class_name: "fixture.Target",
    method_name: null,
    overload_index: null,
    reported_signature: null,
    dex_descriptor: null,
    total: 1,
    references: [
      {
        kind: "method",
        name: "caller",
        reported_full_name: "fixture.Other.caller",
        containing_class: "fixture.Other",
        top_class: "fixture.Other",
        source_line: null,
        dex_offset: null,
        direct_invokes: null,
      },
    ],
    coverage: "complete",
    reference_unit: "using_node",
  };
  expect(
    androidResultSchemas.trace_android_references.safeParse(result).success,
  ).toBe(false);
  expect(
    androidResultSchemas.trace_android_references.safeParse({
      ...result,
      references: [
        { ...result.references[0], direct_invokes_exhaustive: null },
      ],
    }).success,
  ).toBe(true);
});

it("publishes exact DEX prototypes instead of discarding bridge metadata", async () => {
  const tools: JadxToolPort = {
    listClasses: () =>
      Promise.reject(new Error("unexpected class inventory call")),
    json: () => Promise.resolve(summary),
    text: () => Promise.reject(new Error("unexpected text call")),
  };
  const result = await analyzeJadxRequest(
    tools,
    {
      operation: "inspect_android_class",
      input: androidInputSchemas.inspect_android_class.parse({
        path: "/fixture.apk",
        class_name: "fixture.Target",
      }),
    },
    { loaded: {} as never, engine },
  );
  expect(result).toMatchObject({
    methods: [
      { name: "choose", dex_descriptor: "(Ljava/lang/String;)V" },
      { name: "choose", dex_descriptor: "(I)V" },
    ],
  });
});

const constantFields = [
  {
    name: "MAX_SIZE",
    raw_name: "MAX_SIZE",
    type: "int",
    dex_type: "I",
    def_pos: 0,
    dex_static_value: { type: "int", value: 1024 },
  },
  {
    name: "PACKET_FLAG_CONFIG",
    raw_name: "PACKET_FLAG_CONFIG",
    type: "long",
    dex_type: "J",
    def_pos: 0,
    dex_static_value: { type: "long", value: "-9223372036854775808" },
  },
  {
    name: "TAG",
    raw_name: "TAG",
    type: "java.lang.String",
    dex_type: "Ljava/lang/String;",
    def_pos: 0,
    dex_static_value: { type: "string", value: "flags" },
  },
  {
    name: "INSTANCE",
    raw_name: "INSTANCE",
    type: "fixture.Target",
    dex_type: "Lfixture/Target;",
    def_pos: 0,
  },
];

const inspectClassWithFields = (fields: JsonValue[]) =>
  analyzeJadxRequest(
    {
      listClasses: () =>
        Promise.reject(new Error("unexpected class inventory call")),
      json: () =>
        Promise.resolve({ ...summary, field_count: fields.length, fields }),
      text: () => Promise.reject(new Error("unexpected text call")),
    },
    {
      operation: "inspect_android_class",
      input: androidInputSchemas.inspect_android_class.parse({
        path: "/fixture.apk",
        class_name: "fixture.Target",
      }),
    },
    { loaded: {} as never, engine },
  );

it("reports DEX static values of static final fields without a static initializer", async () => {
  const result = await inspectClassWithFields(constantFields);
  expect(result).toMatchObject({
    fields: [
      {
        name: "MAX_SIZE",
        reported_type: "int",
        dex_static_value: { type: "int", value: 1024 },
      },
      {
        name: "PACKET_FLAG_CONFIG",
        reported_type: "long",
        dex_static_value: { type: "long", value: "-9223372036854775808" },
      },
      {
        name: "TAG",
        reported_type: "java.lang.String",
        dex_static_value: { type: "string", value: "flags" },
      },
      {
        name: "INSTANCE",
        reported_type: "fixture.Target",
        dex_static_value: null,
      },
    ],
  });
});

it.each([
  { type: "long", value: -9223372036854775808 },
  { type: "int", value: "1024" },
  { type: "double", value: 0.5 },
  { type: "enum", value: "fixture.Mode.ON" },
])(
  "refuses a lossy or unsupported DEX static value $type",
  async (dex_static_value) => {
    await expect(
      inspectClassWithFields([
        {
          name: "VALUE",
          raw_name: "VALUE",
          type: "int",
          dex_type: "I",
          def_pos: 0,
          dex_static_value,
        },
      ]),
    ).rejects.toThrow("JADX class summary failed or was malformed");
  },
);

it.each([
  { type: "byte", value: -128 },
  { type: "byte", value: 127 },
  { type: "short", value: -32_768 },
  { type: "char", value: 65_535 },
  { type: "int", value: -2_147_483_648 },
  { type: "int", value: 2_147_483_647 },
  { type: "long", value: "-9223372036854775808" },
  { type: "long", value: "9223372036854775807" },
  { type: "float", value: "3.4028235E38" },
  { type: "float", value: "-3.4028235E38" },
  { type: "float", value: "1.4E-45" },
  { type: "float", value: "-0.0" },
  { type: "float", value: "NaN" },
  { type: "float", value: "-Infinity" },
  { type: "double", value: "1.7976931348623157E308" },
  { type: "double", value: "4.9E-324" },
  { type: "double", value: "0.0" },
  { type: "double", value: "Infinity" },
])(
  "accepts the boundary DEX static value $type $value",
  async (dex_static_value) => {
    await expect(
      inspectClassWithFields([
        {
          name: "VALUE",
          raw_name: "VALUE",
          type: "int",
          dex_type: "I",
          def_pos: 0,
          dex_static_value,
        },
      ]),
    ).resolves.toMatchObject({ fields: [{ dex_static_value }] });
  },
);

it.each([
  { type: "byte", value: 128 },
  { type: "short", value: -32_769 },
  { type: "char", value: -1 },
  { type: "int", value: 2_147_483_648 },
  { type: "long", value: "9223372036854775808" },
  { type: "long", value: "-9223372036854775809" },
  { type: "long", value: "-0" },
  { type: "float", value: "1.0E40" },
  { type: "float", value: "3.4028236E38" },
  { type: "float", value: "1.0E-50" },
  { type: "double", value: "1.8E308" },
  { type: "double", value: "1.0E-400" },
])(
  "refuses an out-of-range DEX static value $type $value",
  async (dex_static_value) => {
    await expect(
      inspectClassWithFields([
        {
          name: "VALUE",
          raw_name: "VALUE",
          type: "int",
          dex_type: "I",
          def_pos: 0,
          dex_static_value,
        },
      ]),
    ).rejects.toThrow("JADX class summary failed or was malformed");
  },
);

it.each([
  { operation: "inspect_android_class", input: {}, values: true },
  {
    operation: "inspect_android_method",
    input: { method_name: "choose", overload_index: 1 },
    values: false,
  },
  {
    operation: "trace_android_references",
    input: { method_name: "choose", overload_index: 1 },
    values: false,
  },
  { operation: "trace_android_references", input: {}, values: false },
] as const)(
  "requests DEX static values for $operation only when inspecting a class",
  async ({ operation, input, values }) => {
    const calls: Record<string, unknown>[] = [];
    const reply = (name: string): JsonValue => {
      if (name === "get_class_summary") return summary;
      if (name === "get_method_body")
        return {
          class_name: "fixture.Target",
          method_name: "choose",
          full_name: "fixture.Target.choose",
          overload_index: 1,
          overload_count: 2,
          dex_descriptor: "(I)V",
          mode: "java",
          fell_back: false,
          markers: [],
          body: "void choose(int value) {}",
        };
      return {
        target:
          name === "get_xrefs_to_class"
            ? "fixture.Target"
            : "fixture.Target.choose",
        ...(name === "get_xrefs_to_class"
          ? {}
          : { overload_index: 1, reported_signature: "choose(int): void" }),
        total: 0,
        count: 0,
        resolve_line: false,
        items: [],
      };
    };
    await analyzeJadxRequest(
      {
        listClasses: () =>
          Promise.reject(new Error("unexpected class inventory call")),
        json: (name, args) => {
          calls.push({ name, ...args });
          return Promise.resolve(reply(name));
        },
        text: () => Promise.reject(new Error("unexpected text call")),
      },
      {
        operation,
        input: { path: "/fixture.apk", class_name: "fixture.Target", ...input },
      } as never,
      { loaded: {} as never, engine },
    );
    expect(calls[0]).toEqual({
      name: "get_class_summary",
      class_name: "fixture.Target",
      ...(values ? { dex_static_values: true } : {}),
      ...(operation === "trace_android_references" && "method_name" in input
        ? { reference_target: true, method_name: input.method_name }
        : {}),
    });
  },
);

it("traces only the selected overloaded method and checks the producer identity", async () => {
  const calls: Record<string, unknown>[] = [];
  const tools: JadxToolPort = {
    listClasses: () =>
      Promise.reject(new Error("unexpected class inventory call")),
    json: (name, input) => {
      calls.push({ name, ...input });
      if (name === "get_class_summary") return Promise.resolve(summary);
      return Promise.resolve({
        target: "fixture.Target.choose",
        overload_index: 1,
        reported_signature: "choose(int): void",
        total: 1,
        count: 1,
        resolve_line: false,
        items: [
          {
            kind: "method",
            name: "caller",
            full_name: "fixture.Other.caller",
            containing_class: "fixture.Other",
            top_class: "fixture.Other",
            def_pos: 0,
            direct_invokes: [
              {
                dex_entry: "classes.dex",
                source_raw_method_id: "fixture.Other.caller()V",
                dex_code_unit_offset: 0,
                dex_method_index: 1,
                opcode: "INVOKE_STATIC",
              },
              {
                dex_entry: "classes.dex",
                source_raw_method_id: "fixture.Other.caller()V",
                dex_code_unit_offset: 3,
                dex_method_index: 1,
                opcode: "INVOKE_STATIC",
              },
            ],
          },
        ],
      });
    },
    text: () => Promise.reject(new Error("unexpected text call")),
  };
  const request = {
    operation: "trace_android_references",
    input: androidInputSchemas.trace_android_references.parse({
      path: "/fixture.apk",
      class_name: "fixture.Target",
      method_name: "choose",
      overload_index: 1,
    }),
  } as const;
  const result = await analyzeJadxRequest(tools, request, {
    loaded: {} as never,
    engine,
  });
  expect(result).toMatchObject({
    method_name: "choose",
    overload_index: 1,
    reported_signature: "choose(int): void",
    dex_descriptor: "(I)V",
    total: 1,
    reference_unit: "using_node",
    references: [
      {
        direct_invokes: [
          { dex_code_unit_offset: 0 },
          { dex_code_unit_offset: 3 },
        ],
      },
    ],
  });
  expect(calls[1]).toMatchObject({
    name: "get_xrefs_to_method",
    overload_index: 1,
  });
});

it("rejects an ambiguous method and a producer response for a different overload", async () => {
  const xrefs = {
    target: "fixture.Target.choose",
    overload_index: 0,
    reported_signature: "choose(String): void",
    total: 0,
    count: 0,
    resolve_line: false,
    items: [],
  };
  const tools: JadxToolPort = {
    listClasses: () =>
      Promise.reject(new Error("unexpected class inventory call")),
    json: (name) =>
      Promise.resolve(name === "get_class_summary" ? summary : xrefs),
    text: () => Promise.reject(new Error("unexpected text call")),
  };
  const input = {
    path: "/fixture.apk",
    class_name: "fixture.Target",
    method_name: "choose",
  };
  await expect(
    analyzeJadxRequest(
      tools,
      {
        operation: "trace_android_references",
        input,
      },
      { loaded: {} as never, engine },
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisInputError",
  });
  await expect(
    analyzeJadxRequest(
      tools,
      {
        operation: "trace_android_references",
        input: { ...input, overload_index: 1 },
      },
      { loaded: {} as never, engine },
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisOutputError",
  });
});

const invokeSite = {
  dex_entry: "classes.dex",
  source_raw_method_id: "fixture.Other.caller()V",
  dex_code_unit_offset: 0,
  dex_method_index: 1,
  opcode: "INVOKE_STATIC",
};
const traceWithReference = (fields: Record<string, unknown>) =>
  analyzeJadxRequest(
    {
      listClasses: () =>
        Promise.reject(new Error("unexpected class inventory call")),
      json: (name) =>
        Promise.resolve(
          name === "get_class_summary"
            ? summary
            : {
                target: "fixture.Target.choose",
                overload_index: 0,
                reported_signature: "choose(String): void",
                total: 1,
                count: 1,
                resolve_line: false,
                items: [
                  {
                    kind: "method",
                    name: "caller",
                    full_name: "fixture.Other.caller",
                    containing_class: "fixture.Other",
                    top_class: "fixture.Other",
                    def_pos: 0,
                    ...fields,
                  },
                ],
              },
        ),
      text: () => Promise.reject(new Error("unexpected text call")),
    },
    {
      operation: "trace_android_references",
      input: {
        path: "/fixture.apk",
        class_name: "fixture.Target",
        method_name: "choose",
        overload_index: 0,
      },
    },
    { loaded: {} as never, engine },
  );

it.each([
  [{}, null],
  [{ direct_invokes: [] }, []],
])(
  "preserves unavailable versus observed-empty invoke sites: %j",
  async (fields, expected) => {
    const result = await traceWithReference(fields as Record<string, unknown>);
    expect(result).toMatchObject({
      direct_invokes_coverage: {
        complete_using_nodes: 0,
        partial_using_nodes: 0,
        unknown_using_nodes: 1,
        recorded_sites: 0,
      },
      references: [
        { direct_invokes: expected, direct_invokes_exhaustive: null },
      ],
    });
  },
);

it.each([
  { ...invokeSite, dex_code_unit_offset: -1 },
  {
    dex_entry: "classes.dex",
    source_raw_method_id: "fixture.Other.caller()V",
    dex_code_unit_offset: 0,
    dex_method_index: 1,
  },
])("rejects malformed direct invoke producer evidence: %j", async (site) => {
  await expect(
    traceWithReference({ direct_invokes: [site] }),
  ).rejects.toThrow();
});

it("preserves bounded instruction coverage separately from using-node coverage", async () => {
  const result = await traceWithReference({
    direct_invokes: [invokeSite],
    direct_invokes_exhaustive: false,
  });
  expect(result).toMatchObject({
    coverage: "complete",
    reference_unit: "using_node",
    direct_invokes_coverage: {
      complete_using_nodes: 0,
      partial_using_nodes: 1,
      unknown_using_nodes: 0,
      recorded_sites: 1,
    },
    references: [
      { direct_invokes: [invokeSite], direct_invokes_exhaustive: false },
    ],
  });
});

it.each([
  "not-a-dex-descriptor",
  "(Lbad(name;)V",
  "(Lbad)name;)V",
  "()Lbad(name;",
  "()Lbad)name;",
])(
  "rejects malformed DEX prototype %s at the adapter boundary",
  async (descriptor) => {
    const invalidSummary = {
      ...summary,
      methods: summary.methods.map((method) => ({
        ...method,
        dex_descriptor: descriptor,
      })),
    };
    await expect(
      analyzeJadxRequest(
        {
          listClasses: () =>
            Promise.reject(new Error("unexpected class inventory call")),
          json: () => Promise.resolve(invalidSummary),
          text: () => Promise.reject(new Error("unexpected text call")),
        },
        {
          operation: "inspect_android_class",
          input: { path: "/fixture.apk", class_name: "fixture.Target" },
        },
        { loaded: {} as never, engine },
      ),
    ).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      cause: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["methods", 0, "dex_descriptor"],
          }),
        ]),
      },
    });
  },
);

const parsedMapping = parseProguardMapping(
  [
    "com.example.app.LoginActivity -> a.a:",
    "    com.example.app.Session session -> c",
    "    1:1:void submit(int):30:30 -> a",
    "    2:2:void submit(java.lang.String):40:40 -> a",
    "    void handle() -> do",
    "com.example.app.LoginActivity$Callback -> a.a$a:",
    "com.example.app.Session -> a.b:",
  ].join("\n"),
  ANDROID_MAPPING_LIMITS,
);
if (!parsedMapping.ok) throw new Error(JSON.stringify(parsedMapping.error));
const mapping: AndroidMappingSource = {
  file: { path: "/tmp/mapping.txt", sha256: "b".repeat(64), bytes: 256 },
  mapping: parsedMapping.value,
};
const obfuscatedSummary = {
  full_name: "a.a",
  raw_name: "a.a",
  name: "a",
  method_count: 3,
  field_count: 2,
  inner_class_count: 1,
  methods: [
    {
      name: "a",
      raw_name: "a",
      signature: "a(String): void",
      dex_descriptor: "(Ljava/lang/String;)V",
      is_constructor: false,
      def_pos: 0,
    },
    {
      name: "a",
      raw_name: "a",
      signature: "a(int): void",
      dex_descriptor: "(I)V",
      is_constructor: false,
      def_pos: 0,
    },
    {
      // JADX renames reserved words even with deobfuscation disabled.
      name: "m0do",
      raw_name: "do",
      signature: "m0do(): void",
      dex_descriptor: "()V",
      is_constructor: false,
      def_pos: 0,
    },
  ],
  fields: [
    { name: "c", raw_name: "c", type: "a.b", dex_type: "La/b;", def_pos: 0 },
    { name: "f0if", raw_name: "if", type: "int", dex_type: "I", def_pos: 0 },
  ],
  inner_classes: ["a.a.a"],
  inner_class_raw_names: ["a.a$a"],
};
const obfuscatedTools = (
  reply: JsonValue = obfuscatedSummary,
): JadxToolPort => ({
  listClasses: () =>
    Promise.reject(new Error("unexpected class inventory call")),
  text: () => Promise.reject(new Error("unexpected text call")),
  json: (name, input) =>
    Promise.resolve(
      name === "get_class_summary"
        ? reply
        : {
            class_name: "a.a",
            method_name: input.method_name ?? null,
            full_name: `a.a.${String(input.method_name)}`,
            overload_index: input.overload_index ?? null,
            overload_count: 2,
            dex_descriptor: "(I)V",
            mode: "java",
            fell_back: false,
            markers: [],
            body: "void a(int i) {}",
          },
    ),
});
const inspectObfuscated = (
  request: AndroidRequest,
  tools = obfuscatedTools(),
) =>
  analyzeJadxRequest(tools, request, { loaded: {} as never, engine, mapping });
const classRequest = {
  operation: "inspect_android_class",
  input: {
    path: "/fixture.apk",
    class_name: "a.a",
    mapping_path: "/tmp/mapping.txt",
  },
} as const;

it("annotates every observed class member through raw DEX identities", async () => {
  const result = androidResultSchemas.inspect_android_class.parse(
    await inspectObfuscated(classRequest),
  );
  expect(result.methods.map(({ name }) => name)).toEqual(["a", "a", "m0do"]);
  expect(result.mapping).toMatchObject({
    association: "caller-selected",
    file: { path: "/tmp/mapping.txt", sha256: "b".repeat(64), bytes: 256 },
    records: { classes: 3, fields: 1, methods: 3, malformed: 0 },
    coverage: { symbols: 7, mapped: 6, ambiguous: 0, unmapped: 1 },
  });
  expect(result.mapping?.symbols).toEqual([
    {
      kind: "class",
      name: "a.a",
      raw_name: "a.a",
      resolution: {
        status: "mapped",
        mapped: { name: "com.example.app.LoginActivity" },
        verified_by: "class",
      },
    },
    {
      kind: "class",
      name: "a.a.a",
      raw_name: "a.a$a",
      resolution: expect.objectContaining({
        mapped: { name: "com.example.app.LoginActivity$Callback" },
      }),
    },
    expect.objectContaining({
      kind: "method",
      overload_index: 0,
      resolution: expect.objectContaining({
        mapped: expect.objectContaining({
          name: "submit",
          parameter_types: ["java.lang.String"],
        }),
      }),
    }),
    expect.objectContaining({
      kind: "method",
      overload_index: 1,
      resolution: expect.objectContaining({
        mapped: expect.objectContaining({
          name: "submit",
          parameter_types: ["int"],
        }),
      }),
    }),
    {
      kind: "method",
      class_raw_name: "a.a",
      name: "m0do",
      overload_index: 0,
      raw_name: "do",
      dex_descriptor: "()V",
      resolution: {
        status: "mapped",
        mapped: {
          class: "com.example.app.LoginActivity",
          name: "handle",
          return_type: "void",
          parameter_types: [],
        },
        verified_by: "descriptor",
      },
    },
    expect.objectContaining({
      kind: "field",
      raw_name: "c",
      dex_type: "La/b;",
      resolution: expect.objectContaining({
        mapped: expect.objectContaining({ name: "session" }),
        verified_by: "type",
      }),
    }),
    expect.objectContaining({
      kind: "field",
      name: "f0if",
      raw_name: "if",
      resolution: { status: "unmapped" },
    }),
  ]);
});

it("maps only the class and the selected method overload", async () => {
  const result = androidResultSchemas.inspect_android_method.parse(
    await inspectObfuscated({
      operation: "inspect_android_method",
      input: { ...classRequest.input, method_name: "a", overload_index: 1 },
    }),
  );
  expect(result.method).toMatchObject({ name: "a", dex_descriptor: "(I)V" });
  expect(
    result.mapping?.symbols.map((symbol) =>
      symbol.resolution.status === "mapped" ? symbol.resolution.mapped : null,
    ),
  ).toEqual([
    { name: "com.example.app.LoginActivity" },
    {
      class: "com.example.app.LoginActivity",
      name: "submit",
      return_type: "void",
      parameter_types: ["int"],
    },
  ]);
});

it("omits the mapping block when no mapping was selected", async () => {
  const result = await analyzeJadxRequest(
    obfuscatedTools(),
    {
      operation: "inspect_android_class",
      input: { path: "/fixture.apk", class_name: "a.a" },
    },
    { loaded: {} as never, engine },
  );
  expect(result).not.toHaveProperty("mapping");
});

it("refuses inner class raw names that do not align with display names", async () => {
  await expect(
    inspectObfuscated(
      classRequest,
      obfuscatedTools({ ...obfuscatedSummary, inner_class_raw_names: [] }),
    ),
  ).rejects.toMatchObject({ _tag: "AnalysisOutputError" });
});
