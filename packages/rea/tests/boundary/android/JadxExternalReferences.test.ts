import { describe, expect, it } from "vitest";
import {
  analyzeJadxRequest,
  type JadxToolPort,
} from "../../../src/android/JadxAnalysis.js";
import { androidResultSchemas } from "../../../src/domain/android/androidAnalysis.js";

const engine = {
  name: "jadx",
  version: "0.7.1",
  artifact_sha256: "a".repeat(64),
  source_revision: null,
  worker_count: 1,
  heap_limit_mib: null,
};
const selector = {
  class_name: "fixture.Caller",
  method_name: "notify0",
  overload_index: 0,
};
const summary = {
  class_name: "android.app.NotificationManager",
  reference_target: "external",
  observed_method_count: 1,
  prototypes: [
    {
      name: "notify",
      raw_name: "notify",
      signature: "notify(int, android.app.Notification): void",
      dex_descriptor: "(ILandroid/app/Notification;)V",
      is_constructor: false,
      def_pos: 0,
    },
  ],
};
const xrefs = {
  target: "android.app.NotificationManager.notify",
  reference_target: "external",
  reference_scope: "direct_dex_invokes",
  overload_index: 0,
  reported_signature: summary.prototypes[0]!.signature,
  dex_descriptor: summary.prototypes[0]!.dex_descriptor,
  total: 1,
  count: 1,
  resolve_line: false,
  items: [
    {
      kind: "method",
      name: selector.method_name,
      full_name: "fixture.Caller.notify0",
      containing_class: selector.class_name,
      top_class: selector.class_name,
      def_pos: 0,
      source_selector: selector,
      direct_invokes_exhaustive: true,
      direct_invokes: [0, 3].map((offset) => ({
        dex_entry: "classes2.dex",
        source_raw_method_id:
          "fixture.Caller.notify0(Landroid/app/NotificationManager;Landroid/app/Notification;)V",
        dex_code_unit_offset: offset,
        dex_method_index: 5,
        opcode: "INVOKE_VIRTUAL",
      })),
    },
  ],
};

const analyze = (
  target = summary,
  references = xrefs,
  operation:
    | "trace_android_references"
    | "inspect_android_class" = "trace_android_references",
) => {
  const tools: JadxToolPort = {
    listClasses: () => Promise.reject(new Error("unexpected class inventory")),
    text: () => Promise.reject(new Error("unexpected source generation")),
    json: (name) =>
      Promise.resolve(name === "get_class_summary" ? target : references),
  };
  return analyzeJadxRequest(
    tools,
    {
      operation,
      input: {
        path: "/fixture.apk",
        class_name: summary.class_name,
        ...(operation === "trace_android_references"
          ? { method_name: "notify" }
          : {}),
      },
    },
    { loaded: {} as never, engine },
  );
};

describe("external DEX method-reference projection", () => {
  it("separates partial instruction positions from complete caller coverage", async () => {
    const bounded = structuredClone(xrefs);
    bounded.items[0]!.direct_invokes_exhaustive = false;
    bounded.items[0]!.direct_invokes = bounded.items[0]!.direct_invokes.slice(
      0,
      1,
    );
    expect(await analyze(summary, bounded)).toMatchObject({
      total: 1,
      coverage: "complete",
      reference_unit: "using_node",
      direct_invokes_coverage: {
        complete_using_nodes: 0,
        partial_using_nodes: 1,
        unknown_using_nodes: 0,
        recorded_sites: 1,
      },
    });
  });

  it("counts complete positions and preserves historical aggregate omission", async () => {
    const result = androidResultSchemas.trace_android_references.parse(
      await analyze(),
    );
    expect(result.direct_invokes_coverage).toEqual({
      complete_using_nodes: 1,
      partial_using_nodes: 0,
      unknown_using_nodes: 0,
      recorded_sites: 2,
    });
    const { direct_invokes_coverage: _coverage, ...historical } = result;
    expect(
      androidResultSchemas.trace_android_references.parse(historical),
    ).not.toHaveProperty("direct_invokes_coverage");
  });

  it("lists exact observed DEX descriptors when an external overload is ambiguous", async () => {
    const descriptors = [
      "(ILandroid/app/Notification;)V",
      "(Ljava/lang/String;ILandroid/app/Notification;)V",
    ];
    const ambiguous = {
      ...summary,
      observed_method_count: 2,
      prototypes: descriptors.map((dex_descriptor) => ({
        ...summary.prototypes[0]!,
        dex_descriptor,
      })),
    };
    const failure = analyze(ambiguous);
    await expect(failure).rejects.toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["overload_index"],
          reason: "invalid_value",
        },
      ],
    });
    for (const descriptor of descriptors)
      await expect(failure).rejects.toMatchObject({
        issues: [{ message: expect.stringContaining(descriptor) }],
      });
    for (const index of descriptors.keys())
      await expect(failure).rejects.toMatchObject({
        issues: [
          { message: expect.stringMatching(new RegExp(`\\b${index}\\b`, "u")) },
        ],
      });
    await expect(failure).rejects.toMatchObject({
      issues: [
        { message: expect.stringContaining(summary.prototypes[0]!.signature) },
      ],
    });
  });

  it("retains an external target, direct-only scope and an inspectable caller", async () => {
    const result = androidResultSchemas.trace_android_references.parse(
      await analyze(),
    );
    expect(result).toMatchObject({
      target_definition: "external",
      reference_scope: "direct_dex_invokes",
      class_name: summary.class_name,
      dex_descriptor: summary.prototypes[0]!.dex_descriptor,
      total: 1,
      reference_unit: "using_node",
      references: [{ source_selector: selector }],
    });
    expect(
      result.references[0]!.direct_invokes?.map(
        (site) => site.dex_code_unit_offset,
      ),
    ).toEqual([0, 3]);
  });

  it.each([
    { name: "prototype", changed: { dex_descriptor: "()V" } },
    { name: "definition", changed: { reference_target: undefined } },
    { name: "scope", changed: { reference_scope: undefined } },
    {
      name: "caller selector",
      changed: { items: [{ ...xrefs.items[0]!, source_selector: undefined }] },
    },
  ])(
    "refuses a changed external $name instead of reporting coverage",
    async ({ changed }) => {
      await expect(
        analyze(summary, { ...xrefs, ...changed } as typeof xrefs),
      ).rejects.toThrow();
    },
  );

  it("does not accept reference-only metadata as an APK class definition", async () => {
    await expect(
      analyze(summary, xrefs, "inspect_android_class"),
    ).rejects.toThrow();
  });
});
