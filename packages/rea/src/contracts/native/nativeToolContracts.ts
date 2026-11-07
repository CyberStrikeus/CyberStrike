import { requireOutputSchema } from "../toolOutputSchemaPrimitives.js";
import { z } from "zod";
import { nativeCallObservationInputSchema } from "../../domain/native/nativeCallObservation.js";
import {
  nativeUiObservationInputSchema,
  nativeUiScenarioInputSchema,
} from "../../domain/native/nativeUiObservation.js";

import type { ToolContract } from "../toolContractTypes.js";
import { nativeOutputSchemas } from "../toolOutputSchemaGroups.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { localPathStringSchema } from "../../domain/localPath.js";
import { toolContractMetadata } from "../toolEffects.js";
import { analysisDetailSchema } from "../analysisDetail.js";
import { nativeCommandTimeoutField } from "../../domain/native/nativeDeadlines.js";

const examples: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  inspect_macho: {},
  inspect_signature: {},
  inspect_plist: {},
  list_architectures: {},
  observe_native_ui: { pid: 123, window_id: 456 },
  capture_native_ui_scenario: {
    pid: 123,
    window_id: 456,
    steps: [{ kind: "wait", milliseconds: 100 }],
  },
  demangle_swift: { symbols: ["$s4Test3fooyyF"] },
  observe_native_calls: {
    breakpoints: [
      {
        kind: "objc-method",
        class_name: "NSURLSession",
        selector: "dataTaskWithRequest:completionHandler:",
      },
      { kind: "function", name: "open", module: "libsystem_kernel.dylib" },
    ],
    arguments: ["--help"],
    duration_ms: 5000,
    backtrace_frames: 4,
  },
};

const native = <
  Name extends keyof typeof nativeOutputSchemas,
  Schema extends z.ZodObject,
>(
  name: Name,
  description: string,
  inputSchema: Schema,
  retainedSummary?: ToolContract["retainedSummary"],
) => {
  const outputSchema = requireOutputSchema(nativeOutputSchemas, name);
  const strictInputSchema = inputSchema.strict();
  return {
    name,
    ...toolContractMetadata(name),
    description,
    kind: "native-provider",
    requiresActiveTarget: true,
    ...(retainedSummary === undefined ? {} : { retainedSummary }),
    inputSchema: strictInputSchema,
    outputSchema,
    examples: [
      {
        title: `Example ${name.replaceAll("_", " ")} request`,
        input: z
          .record(z.string(), jsonValueSchema)
          .parse(examples[name] ?? {}),
      },
    ],
  } satisfies ToolContract<Name, typeof strictInputSchema, typeof outputSchema>;
};

/** Ordered single-line symbols; `swift-demangle` ends each result with LF. */
export const swiftSymbolsSchema = z.array(
  z
    .string()
    .min(1)
    .regex(/^[^\n]*$/u, "Each Swift symbol must be one line.")
    .regex(/^[^\x00]*$/u, "Swift symbols cannot contain NUL."),
);

/** Provider-neutral semantic operations backed initially by macOS utilities. */
export const NATIVE_TOOL_CONTRACTS = [
  native(
    "observe_native_ui",
    "Observe an already-running native app by PID and window ID, bound to the active Mach-O target. Captures a bounded accessibility tree and selected-window screenshot; OS permission denial fails without broad capture or target launch. native_ui_deadline_ms is the observation deadline (omitted means 180000 ms, range 1..2147483647, next call). It does not raise the fixed 67108864-byte output allowance or the 180000 ms wait-step cap.",
    nativeUiObservationInputSchema,
  ),
  native(
    "capture_native_ui_scenario",
    "Run selected-element press, increment/decrement scroll, AXValue text entry and bounded wait steps in one exact native app window. Returns ordered before/after captures and action/capture failures. Actions can change app data, network activity and persistent state; application state is left as-is and restoration is not attempted. native_ui_deadline_ms is the scenario deadline (omitted means 180000 ms, range 1..2147483647, next call). It does not raise the fixed 67108864-byte output allowance or the 180000 ms wait-step cap.",
    nativeUiScenarioInputSchema,
  ),
  native(
    "observe_native_calls",
    "Launch the active Mach-O as an owned process under LLDB and record each entry into caller-selected functions or Objective-C methods: thread, module, symbol, load and file address, raw argument registers, selector, receiver class and optional caller frames. Every hit auto-continues. No expression is evaluated and no other process is attached. The process is killed when max_events or duration_ms is reached; exit status, captured stdout/stderr, unresolved breakpoints and limitations are returned inline. The process runs with the current user's permissions and may change files, show UI or use the network. A hardened-runtime target needs the get-task-allow entitlement.",
    nativeCallObservationInputSchema,
  ),
  native(
    "inspect_macho",
    "Inspect Mach-O slices, load commands, imports, exports, dependencies, build metadata, segments, sections, permissions, and exact command provenance without launching Hopper. Large frameworks return megabytes of symbols; detail summary retains the complete Evidence and returns slice identity with per-collection counts, then page rows with inspect_analysis_view kind macho. native_command_timeout_ms is each Xcode command's wall clock (omitted means 60000 ms, range 1..2147483647, next call) and is distinct from objdump/rizin command_timeout_ms. It does not raise the fixed 67108864-byte output allowance.",
    z.object({
      detail: analysisDetailSchema
        .unwrap()
        .optional()
        .describe(
          "Omitted or complete returns the complete inspection Evidence. summary retains that complete Evidence in this session and returns its inspect_analysis_view summary; use normalized_result.parent_evidence_id for macho pages.",
        ),
      native_command_timeout_ms: nativeCommandTimeoutField,
    }),
    { evidenceParameters: "omit-detail" },
  ),
  native(
    "inspect_signature",
    "Inspect the selected Mach-O architecture's code-signing identity, hashes, authorities, designated requirement, entitlements and hardened-runtime state from a temporary digest-verified byte snapshot. Other slices are checked for unsigned state, with their metadata coverage stated separately. Exact command provenance is retained. native_command_timeout_ms is each codesign command's wall clock (omitted means 60000 ms). It does not raise the fixed 67108864-byte output allowance.",
    z.object({
      native_command_timeout_ms: nativeCommandTimeoutField,
    }),
  ),
  native(
    "inspect_plist",
    "Requires an open binary or bundle-resource session; use open_binary or open_bundle_resources first. Parse its Info.plist by default, or select a local plist with path within that session. Supplying path does not open a session. Returns normalized JSON rather than plutil text. native_command_timeout_ms is each file or plutil command's wall clock (omitted means 60000 ms). The 67108864-byte plist input and decode allowances and the 998-level nesting allowance have no runtime override. XML sources also require native plutil validation, which can refuse shallower inputs with its own diagnostics. The 4096-byte markup probe is a probe window, not a document cap, and has no runtime override.",
    z.object({
      path: localPathStringSchema
        .optional()
        .describe(
          "Optional plist selection for an already open binary or bundle-resource session; this does not open a session.",
        ),
      native_command_timeout_ms: nativeCommandTimeoutField,
    }),
  ),
  native(
    "list_architectures",
    "List thin or universal Mach-O slices with offsets, sizes, alignment, explicit coverage, and native-tool provenance. native_command_timeout_ms is the lipo wall clock (omitted means 60000 ms). It does not raise the fixed 67108864-byte output allowance.",
    z.object({
      native_command_timeout_ms: nativeCommandTimeoutField,
    }),
  ),
  native(
    "demangle_swift",
    "Demangle an ordered list of single-line Swift symbols without requiring Hopper. Each input returns demangled, unchanged, or invalid status. An exact underscore input skipped by swift-demangle is invalid with empty output; it does not discard valid companion results. native_command_timeout_ms is the swift-demangle wall clock (omitted means 60000 ms) and does not raise the fixed 67108864-byte output allowance.",
    z.object({
      symbols: swiftSymbolsSchema,
      native_command_timeout_ms: nativeCommandTimeoutField,
    }),
  ),
] as const satisfies readonly ToolContract[];

export type NativeToolName = (typeof NATIVE_TOOL_CONTRACTS)[number]["name"];
