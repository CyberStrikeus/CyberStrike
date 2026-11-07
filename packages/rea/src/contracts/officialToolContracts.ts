import { requireOutputSchema } from "./toolOutputSchemaPrimitives.js";
import { analysisDetailSchema } from "./analysisDetail.js";
import { z } from "zod";
import { jsonRecordSchema } from "../domain/jsonRecord.js";
import { nativeFunctionAnnotationsInputSchema } from "../domain/native/nativeFunctionAnnotations.js";

import { officialOutputSchemas } from "./toolOutputSchemaGroups.js";
import {
  address,
  document,
  examplesFor,
  optionalAddress,
  procedure,
} from "./toolContractHelpers.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import { nativeDataTypeInputSchema } from "../domain/native/nativeDataType.js";
import { nativeInstructionInputSchema } from "../domain/native/nativeInstruction.js";
import { functionInstructionInputSchema } from "./functionInstructionContract.js";
import { HOPPER_MEMORY_TOOL_DEFINITIONS } from "./hopperMemoryContracts.js";
import { nativeSearchInput } from "../domain/native/nativeSearch.js";

const hopperRegexDeadline =
  "Hopper regex mode uses ECMAScript Unicode syntax in a cancellable worker. The matching deadline is REA_REGEX_MATCHING_DEADLINE_MS (a positive decimal integer of milliseconds from 1 to 2147483647, default 5000). Unset keeps the default. A deadline failure names the effective milliseconds, source (default or setting), the default, and the maximum, and leaves the API usable. The worker old-generation request is REA_REGEX_WORKER_HEAP_REQUEST_MIB (a decimal integer of mebibytes from 7 to 16384, default 128). Unset keeps the default. A positive Node --max-old-space-size, including NODE_OPTIONS, overrides that request and is not limited by the setting's floor or maximum. A heap failure names the effective request, its source (default or setting), the default, the floor, and the maximum.";

const official = <
  Name extends keyof typeof officialOutputSchemas,
  Schema extends z.ZodObject,
>(
  name: Name,
  description: string,
  inputSchema: Schema,
  retainedSummary?: ToolContract["retainedSummary"],
) => {
  const strictInputSchema = inputSchema.strict();
  return {
    name,
    ...toolContractMetadata(name),
    description,
    kind: "official-proxy",
    requiresActiveTarget: true,
    ...(retainedSummary === undefined ? {} : { retainedSummary }),
    inputSchema: strictInputSchema,
    outputSchema: requireOutputSchema(officialOutputSchemas, name),
    examples: examplesFor(name, strictInputSchema),
  } satisfies ToolContract<Name, typeof strictInputSchema>;
};

/** Bridge operations exposed without additional application composition. */
export const OFFICIAL_TOOL_CONTRACTS = [
  official(
    "annotate_native_function",
    "Atomically update one function name and/or entry comments, read them back, and return a refreshed complete function dossier. Ghidra changes its ephemeral session analysis database only; original executable bytes remain unchanged. Empty comment text clears that comment. Edits remain available to subsequent MCP calls until close; CLI returns the updated dossier before discarding its session. Invalid edits roll back the entire operation. Windows P0 and providers without this capability are unsupported.",
    nativeFunctionAnnotationsInputSchema,
  ),
  official(
    "inspect_native_load_image",
    "Inspect the provider's measured source digests, memory mappings, relocations, entry points and entry register context. Independent snapshot verification supports DOS MZ, explicitly selected COM, raw binaries and GameCube DOL; other formats retain their observations with unsupported verification. Overlay and uninitialized coverage remain explicit. Select detail summary for verification state and counts, retaining complete Evidence for inspect_analysis_view kind native-load-image: collection source_files, mappings, relocations, entry_points, entry_context, checks or sections, with indices, fields and offset/limit paging. Relocation bytes and check expected/observed payloads require explicit fields; defaults keep metadata. Null collections are unrecorded or inapplicable. Does not execute or modify the target.",
    z.strictObject({ detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "inspect_native_data_type",
    "Inspect one recovered type by exact database category path or defined typed data address. Returns observed size, alignment, packing, fields, bitfields, enum values, and child type identities; source-level authority and flexible-tail semantics remain unknown unless substantiated.",
    nativeDataTypeInputSchema,
  ),
  official(
    "inspect_native_instruction",
    "Inspect one exact code or data address: decoded bytes, mnemonic, ordered operand tokens, flow, outgoing instruction references and typed incoming references where available. Incoming references preserve source, access kind, operand index and analysis provenance even at data addresses; they do not prove runtime access. Memory addressing decomposition is unavailable when the provider supplies only tokens. Ghidra reports in-memory addresses without a listed instruction or defined data as not-in-listing, without attempting a decode.",
    nativeInstructionInputSchema,
  ),
  official(
    "resolve_native_call_targets",
    "Resolve one explicit static call site using typed provider call references. Preserves ambiguous targets as candidates and unresolved computed calls as unknown; does not execute code or traverse a call graph.",
    nativeInstructionInputSchema,
  ),
  official(
    "address_name",
    "Resolve the primary analyzed name at a code or data address. Headless providers require an explicit address; GUI providers may default to their current cursor. Null means the provider has no primary name at that address.",
    z.object({ document, address: optionalAddress }),
  ),
  official(
    "comment",
    "Read the regular analysis comment at an address, defaulting to the current cursor. This is read-only and returns null when no comment exists; use set_comment to persist a finding.",
    z.object({ document, address: optionalAddress }),
  ),
  official(
    "current_address",
    "Return Hopper's current cursor address for the selected document. Use only for interactive navigation state; prefer explicit addresses in reproducible investigations.",
    z.object({ document }),
  ),
  official(
    "current_procedure",
    "Return the analyzed procedure containing Hopper's current cursor. This uses GUI cursor state and is not a procedure-name lookup.",
    z.object({ document }),
  ),
  official(
    "current_document",
    "Return the document currently selected by REA's Hopper bridge.",
    z.object({}),
  ),
  official(
    "goto_address",
    "Move Hopper's GUI cursor to a mapped address and return the observed cursor address. Interior coordinates snap to the containing analyzed object's start. Unmapped destinations fail without moving the cursor. This changes navigation state but not analysis data; use explicit-address tools for headless workflows.",
    z.object({ address, document }),
  ),
  official(
    "inline_comment",
    "Read the inline instruction comment at an address, defaulting to the current cursor. Returns null when absent; use set_inline_comment to write one.",
    z.object({ document, address: optionalAddress }),
  ),
  official(
    "list_bookmarks",
    "List every bookmark in the selected Hopper document as address and name pairs; unnamed bookmarks retain a null name. Use bookmarks as analyst-authored navigation aids; this does not discover code references.",
    z.object({ document }),
  ),
  official(
    "list_documents",
    "List provider program or document identities. Hopper may expose several documents; a Ghidra headless session contains exactly its one imported Program.",
    z.object({}),
  ),
  official(
    "list_names",
    "List every analyzed memory and external symbol as address/value pairs. Provider metadata distinguishes Ghidra primary, dynamic, external, type, and source facts when available. Select detail summary for counts and retained native-inventory pages; complete remains the default.",
    z.object({
      document,
      address: optionalAddress,
      detail: analysisDetailSchema,
    }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "list_procedures",
    "List every analyzed procedure as address/value pairs after provider analysis. Ghidra metadata distinguishes thunks and external functions; use returned addresses in later function operations. Select detail summary for counts and retained native-inventory pages; complete remains the default.",
    z.object({ document, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "list_segments",
    "List segments or memory blocks using exclusive end addresses. Ghidra reports block permissions, address space, image base, initialization, and overlay facts; Hopper marks unavailable permissions explicitly.",
    z.object({ document }),
  ),
  official(
    "list_strings",
    "List every provider-reported string object or candidate, or filter to one address, as address/value pairs with encoding, terminator status, and byte length when available. Hopper reads complete typed objects and retains its original display text as provider_value; long literals may span adjacent unterminated objects. Kuna scans mapped printable sequences of at least five characters, including unterminated fragments; references are not computed. Select detail summary for counts and retained native-inventory pages; complete remains the default.",
    z.object({
      document,
      address: optionalAddress,
      detail: analysisDetailSchema,
    }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "next_address",
    "Return the next analyzed object address after an explicit address or current cursor. This is a navigation primitive, not instruction-flow or CFG analysis.",
    z.object({ document, address: optionalAddress }),
  ),
  official(
    "prev_address",
    "Return the previous analyzed object start before an explicit address or current cursor. This is a navigation primitive and may fail at document boundaries; data objects and instructions remain distinct from control flow.",
    z.object({ document, address: optionalAddress }),
  ),
  official(
    "procedure_address",
    "Resolve an unambiguous procedure symbol name or provider-normalized address to its canonical entry address. External address spaces remain explicit. Select detail summary for selected facts and a context digest; native-observation and native-context views retain complete source access.",
    z.object({ procedure, document, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "procedure_assembly",
    "Return assembly for one analyzed procedure identified by symbol or hexadecimal address. Use when pseudocode loses calling-convention or instruction-level detail; output is currently returned as one unpaginated string. Ghidra terminal-call assumptions that may cut the analyzed body are reported in Evidence limitations.",
    z.object({ procedure, document }),
  ),
  official(
    "procedure_callees",
    "Return the provider's resolved direct callees for one procedure identified by symbol or address. Unresolved indirect calls may be absent; use analyze_function and typed references to preserve available edge uncertainty. Ghidra terminal-call assumptions that may cut the analyzed body are reported in Evidence limitations. Select detail summary for selected facts and a context digest; native-observation and native-context views retain complete source access.",
    z.object({ procedure, document, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "procedure_callers",
    "Return the provider's resolved direct callers for one procedure identified by symbol or address. Results reflect completed static analysis and may omit unresolved indirect references. Ghidra terminal-call assumptions that may cut the analyzed body are reported in Evidence limitations. Select detail summary for selected facts and a context digest; native-observation and native-context views retain complete source access.",
    z.object({ procedure, document, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "procedure_info",
    "Return provider metadata for one procedure identified by symbol or address: entrypoint, signature, locals, size, block count, and complete inclusive body ranges when observed. Extents reflect the provider's analyzed body; Ghidra terminal-call assumptions that may cut it are reported in Evidence limitations. Hopper locals preserve observed names and signed stack displacements; source types remain unknown. Body byte count and enclosing span remain distinct; unavailable extent is explicit.",
    z.object({ procedure, document }),
  ),
  official(
    "read_function_instructions",
    "Return every raw instruction for one analyzed procedure. Instruction text and body extent are provider-specific. Ghidra terminal-call assumptions that may cut the analyzed body are reported in limitations.",
    functionInstructionInputSchema,
  ),
  ...HOPPER_MEMORY_TOOL_DEFINITIONS.map(({ name, description, inputSchema }) =>
    official(name, description, inputSchema),
  ),
  official(
    "procedure_references",
    "Return every raw incoming or outgoing reference edge for one procedure. Endpoint procedures are resolved only from provider containment. Ghidra preserves detailed reference flags. Hopper preserves native CallReference classifications and exact endpoints while leaving unavailable detailed flags explicit.",
    z.object({
      procedure,
      direction: z.enum(["incoming", "outgoing"]).default("outgoing"),
      document,
    }),
  ),
  official(
    "procedure_pseudo_code",
    "Decompile one analyzed procedure by symbol name or provider-normalized address. Ghidra also accepts file-offset:0x... selectors and falls back to a unique source-file mapping when a 0x-prefixed number resolves to no procedure; existing analysis addresses take precedence and ambiguous mappings fail explicitly. Returns provider-specific pseudocode, never original source or cross-provider text equivalence, and may return null; request procedure_assembly when instruction precision matters. Ghidra no-return assumptions may cut the analyzed body; Evidence limitations report observed terminal calls and available callee identities.",
    z.object({ procedure, document }),
  ),
  official(
    "resolve_containing_procedure",
    "Resolve an arbitrary address, including an interior instruction or exact external entry, to its provider-analyzed containing procedure. A negative result distinguishes outside segments from not in a procedure and is never guessed from nearby symbols. Select detail summary for selected facts and a context digest; native-observation and native-context views retain complete source access.",
    z.object({ address, document, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "search_procedures",
    `Search every analyzed procedure name using literal matching by default or regex when requested. Results are deterministic and complete. ${hopperRegexDeadline} Select detail summary for counts and retained native-inventory pages; complete remains the default.`,
    z.object({ ...nativeSearchInput, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "search_strings",
    `Search every provider-reported string object or candidate using literal matching by default or regex when requested. Results are deterministic and complete over that provider inventory, not every text sequence in artifact bytes. Kuna scans mapped sequences of at least five characters, including unterminated fragments, without computing references. Ghidra may omit packed or undefined literals, including Rust strings; an empty result does not prove text is absent. If an address is known, read_bytes and xrefs inspect its bytes and references. Hopper retains typed byte decoding, native display, and explicit decoding unknowns. Adjacent long-literal fragments match independently. ${hopperRegexDeadline} Select detail summary for counts and retained native-inventory pages; complete remains the default.`,
    z.object({ ...nativeSearchInput, detail: analysisDetailSchema }),
    { evidenceParameters: "omit-detail" },
  ),
  official(
    "set_address_name",
    "Assign an analyst name to one mapped hexadecimal address and report whether the native edit succeeded and exact readback matched. Hopper rejects symbol names exceeding 1024 UTF-16 code units before mutation, and rejects names owned by another address; use set_addresses_names to explicitly move or swap labels among selected addresses. This mutates analysis metadata.",
    z.object({ address, name: z.string(), document }),
  ),
  official(
    "set_addresses_names",
    "Assign analyst names to multiple mapped addresses in one call and return per-address edit/readback success booleans. Hopper validates mapped destinations, native string representations, its 1024 UTF-16 code-unit symbol-name limit, and unique destinations/names before applying edits; its labels may move or swap only among explicitly selected addresses, and unselected label owners remain unchanged. Ghidra rejects any address whose name another selected address also requests or holds in that namespace; others still apply, with reasons in raw_result.failures. This mutates analysis metadata; verify failures individually.",
    z.object({ names: jsonRecordSchema(z.string()), document }),
  ),
  official(
    "set_bookmark",
    "Create or update a bookmark at a mapped hexadecimal address and report readback success. Omit name to preserve an existing name or create an unnamed bookmark; an empty string clears the bookmark name. This mutates navigation metadata; bookmarks are analyst-authored navigation aids, not binary evidence.",
    z.object({ address, name: z.string().optional(), document }),
  ),
  official(
    "set_comment",
    "Write a regular analysis comment at a hexadecimal address and return whether readback matched. An empty comment clears it. This mutates the Hopper document; use comments to record evidence IDs or reasoning.",
    z.object({ address, comment: z.string(), document }),
  ),
  official(
    "set_inline_comment",
    "Write an inline instruction comment at a hexadecimal address and return whether readback matched. An empty comment clears it; Hopper may flatten newlines, producing false on exact readback. This mutates analysis metadata.",
    z.object({ address, comment: z.string(), document }),
  ),
  official(
    "unset_bookmark",
    "Remove the bookmark at a mapped hexadecimal address and return whether it is absent. Hopper also permits removing an existing legacy bookmark outside mapped memory. This mutates navigation metadata and does not alter binary bytes.",
    z.object({ address, document }),
  ),
  official(
    "xrefs",
    "Return analyzed references to a code or data address. Hopper may default to its current cursor; headless providers such as Ghidra require an explicit address. Use to connect strings, globals, selectors, and functions; bare addresses are untyped and indirect references may be incomplete. Use inspect_native_instruction at the target address for typed incoming references where supported.",
    z.object({ document, address: optionalAddress }),
  ),
] as const satisfies readonly ToolContract[];

/** Closed provider operation names exposed by direct analysis adapters. */
export type OfficialToolName = (typeof OFFICIAL_TOOL_CONTRACTS)[number]["name"];
