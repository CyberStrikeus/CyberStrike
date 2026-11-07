import { z } from "zod";
import {
  androidInputSchemas,
  androidPackageInspectionInputSchema,
  androidSymbolInspectionInputSchemas,
  androidResultSchemas,
  androidJniInspectionInputSchema,
} from "../../domain/android/androidAnalysis.js";
import {
  androidPackageSummaryViewResultSchema,
  androidManifestViewResultSchema,
  androidComponentsViewResultSchema,
  androidComponentSummaryViewResultSchema,
  androidClassSummaryViewResultSchema,
  androidMethodSummaryViewResultSchema,
  androidJniSummaryViewResultSchema,
  androidJniPageViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import type { ToolContract } from "../toolContractTypes.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "../toolEffects.js";

/** Static APK operations backed by a separately supplied headless engine. */
export const ANDROID_TOOL_CONTRACTS = [
  {
    name: "inspect_android_jni_bindings",
    ...toolContractMetadata("inspect_android_jni_bindings"),
    description:
      'Link raw APK DEX ACC_NATIVE declarations to observed Java_* function exports and relocated static JNINativeMethod table candidates, per ABI and exact library occurrence. Optional class_name/method_names/descriptors narrow bindings; abis/library_paths narrow parsed libraries. RegisterNatives class attribution always uses the global native declaration inventory before these filters. Matched records establish observed candidate presence; partial coverage does not establish uniqueness, and empty partial scans remain unknown. Includes APK/library digests, stable relation IDs and table slot/relocation provenance. No target execution, library load or runtime registration claim. Omitted detail defaults to summary: a bounded relation preview retaining complete Evidence. Optional view:{kind:"android-jni",collection:"bindings"|"declarations"|"candidates"|"libraries",offset:0,limit:64,fields:[...]} selects exact columns/pages; [] matches none. Read later pages with inspect_analysis_view and the returned parent_evidence_id without reopening files or rerunning analysis. Explicit complete detail returns full retained facts inline. Requires caller-supplied JADX MCP JAR and JDK.',
    kind: "android-provider",
    inputSchema: androidJniInspectionInputSchema,
    outputSchema: evidenceResultOf(
      z.union([
        androidResultSchemas.inspect_android_jni_bindings,
        androidJniSummaryViewResultSchema,
        androidJniPageViewResultSchema,
      ]),
    ),
    examples: [
      {
        title: "Find one Conscrypt native implementation",
        input: {
          path: "/tmp/Example.apk",
          class_name: "org.conscrypt.NativeCrypto",
          method_names: ["EVP_PKEY_new_RSA"],
          abis: ["arm64-v8a"],
          detail: "summary",
        },
      },
    ],
  },
  {
    name: "inspect_android_package",
    ...toolContractMetadata("inspect_android_package"),
    description:
      'Inspect a local APK\'s package, SDK and permission declarations, decoded manifest and class/resource counts, with a bounded static component projection. Omitted or complete detail preserves the complete result. Select detail: "summary" for all declarations, engine identity and counts without decoded manifest text or duplicate raw calls; retains the complete source and returns a distinct linked inspect_analysis_view summary. With summary detail, optionally select view kind android: facet components supports offset/limit, fields and exact kinds/names/actions/exported filters; source_index preserves the retained parent array ordinal and declaration_coverage preserves historical unknowns. Facet component-summary counts selected kinds and exported declarations separately from defaults. Facet manifest pages exact UTF-16 text. Reuse the same views with inspect_analysis_view and normalized_result.parent_evidence_id; complete detail rejects view selection. Does not execute the APK or verify signatures. Requires a caller-supplied JADX MCP JAR and JDK; uses one worker in an isolated temporary workspace.',
    kind: "android-provider",
    inputSchema: androidPackageInspectionInputSchema,
    outputSchema: evidenceResultOf(
      z.union([
        androidResultSchemas.inspect_android_package,
        androidPackageSummaryViewResultSchema,
        androidManifestViewResultSchema,
        androidComponentsViewResultSchema,
        androidComponentSummaryViewResultSchema,
      ]),
    ),
    examples: [
      { title: "Inspect an APK", input: { path: "/tmp/Example.apk" } },
      {
        title: "Inspect APK declarations with retained manifest",
        input: { path: "/tmp/Example.apk", detail: "summary" },
      },
      {
        title: "Read selected VIEW handlers with retained complete Evidence",
        input: {
          path: "/tmp/Example.apk",
          detail: "summary",
          view: {
            kind: "android",
            facet: "components",
            offset: 0,
            limit: 20,
            actions: ["android.intent.action.VIEW"],
            fields: [
              "kind",
              "name",
              "enabled",
              "process",
              "intent_filters",
              "location",
            ],
          },
        },
      },
    ],
  },
  {
    name: "search_android_classes",
    ...toolContractMetadata("search_android_classes"),
    description:
      "Search complete top-level decompiler class-name rows in an explicit local APK by case-sensitive substring. Empty query inventories all rows. Repeated names remain repeated and appear in duplicate_names; the provider accepts only class names for lookup, so these rows do not identify which same-name class node a later lookup selects. Retains artifact and engine identity; no APK execution.",
    kind: "android-provider",
    inputSchema: androidInputSchemas.search_android_classes,
    outputSchema: evidenceResultOf(androidResultSchemas.search_android_classes),
    examples: [
      {
        title: "Find activity classes",
        input: { path: "/tmp/Example.apk", query: "Activity" },
      },
    ],
  },
  {
    name: "inspect_android_class",
    ...toolContractMetadata("inspect_android_class"),
    description:
      "Inspect one exact Android class's parsed methods, fields and inner classes, including synthetic members. Returns display signatures, exact DEX prototypes and encoded static final field values without generating source. A prototype is not a complete raw method ID; overload indices remain consistent within the artifact and engine session. Optional mapping_path annotates observed raw DEX names with R8/ProGuard mapped names in a separate mapping block, verified by DEX type or prototype; observed names stay primary. Select detail summary to retain complete Evidence and return these normalized symbols without duplicate raw provider calls; omitted or complete detail preserves the complete inline response.",
    kind: "android-provider",
    inputSchema: androidSymbolInspectionInputSchemas.inspect_android_class,
    outputSchema: evidenceResultOf(
      z.union([
        androidResultSchemas.inspect_android_class,
        androidClassSummaryViewResultSchema,
      ]),
    ),
    examples: [
      {
        title: "Inspect a class",
        input: { path: "/tmp/Example.apk", class_name: "example.MainActivity" },
      },
      {
        title: "Annotate an obfuscated class with its R8 mapping",
        input: {
          path: "/tmp/Example.apk",
          class_name: "a.b",
          mapping_path: "/tmp/mapping.txt",
          detail: "summary",
        },
      },
    ],
  },
  {
    name: "inspect_android_method",
    ...toolContractMetadata("inspect_android_method"),
    description:
      "Decompile one Android method with smali fallback. Requires explicit overload_index when multiple methods share a name. Reports its DEX prototype, representation, fallback markers and source truncation; display signatures may be aliases. Optional mapping_path adds R8/ProGuard mapped names for the class and selected method without replacing observed names. Prefer detail summary to retain complete Evidence and return the selected body and annotations without repeating raw class metadata. Omitted or complete detail preserves complete inline Evidence.",
    kind: "android-provider",
    inputSchema: androidSymbolInspectionInputSchemas.inspect_android_method,
    outputSchema: evidenceResultOf(
      z.union([
        androidResultSchemas.inspect_android_method,
        androidMethodSummaryViewResultSchema,
      ]),
    ),
    examples: [
      {
        title: "Decompile a method",
        input: {
          path: "/tmp/Example.apk",
          class_name: "example.MainActivity",
          method_name: "onCreate",
        },
      },
    ],
  },
  {
    name: "trace_android_references",
    ...toolContractMetadata("trace_android_references"),
    description:
      "Trace incoming static using nodes to an exact Android class or selected method overload. A method target may be an external class directly named by DEX invokes: target_definition external and reference_scope direct_dex_invokes identify this narrower inventory, without inventing a class definition or body. Ambiguous external requests list observed DEX prototypes; select overload_index explicitly. For APK-defined targets use inspect_android_class. The total counts containing nodes, not individual invokes. External callers include source_selector for inspect_android_method. Source lines and the containing node dex_offset remain unknown. direct_invokes carries exact DEX code-unit offsets when available; direct_invokes_exhaustive false marks byte-bounded partial instruction evidence, and null means unknown. No reflection, JNI or runtime dispatch is inferred.",
    kind: "android-provider",
    inputSchema: androidInputSchemas.trace_android_references,
    outputSchema: evidenceResultOf(
      androidResultSchemas.trace_android_references,
    ),
    examples: [
      {
        title: "Find references to a class",
        input: { path: "/tmp/Example.apk", class_name: "example.MainActivity" },
      },
      {
        title: "Find APK callers of an observed external API prototype",
        input: {
          path: "/tmp/Example.apk",
          class_name: "android.app.NotificationManager",
          method_name: "notify",
          overload_index: 0,
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
