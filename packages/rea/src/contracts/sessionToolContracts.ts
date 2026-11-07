import { requireOutputSchema } from "./toolOutputSchemaPrimitives.js";
import { matchNativeFunctionsInputSchema } from "./native/functionMatchingContracts.js";
import { z } from "zod";

import { absoluteLocalPathStringSchema } from "../domain/localPath.js";
import {
  callPathRequestSchema,
  staticRuntimeCorrelationRequestSchema,
} from "./investigationInputContracts.js";
import { changedBehaviorInputSchema } from "../domain/changedBehavior.js";
import { functionComparisonInputSchema } from "../domain/functionComparisonSchemas.js";
import { processScenarioSchema } from "../domain/process/processScenario.js";
import {
  recordUnknownInputSchema,
  updateUnknownInputSchema,
} from "../domain/residualUnknown.js";
import { reconstructionVerificationInputSchema } from "../domain/reconstructionVerificationSchemas.js";
import { sessionOutputSchemas } from "./toolOutputSchemaGroups.js";
import {
  closeBinaryInputSchema,
  openBundleResourcesInputSchema,
  openBinaryInputSchema,
} from "./sessionLifecycleInputs.js";
import { binarySessionInputSchema } from "./sessionStatusContract.js";
import { processComparisonInputSchema } from "./processComparisonContracts.js";
import { artifactComparisonInputSchema } from "./artifactComparisonContracts.js";
import {
  addressContextInputSchema,
  bundleComparisonMcpInputSchema,
  importEvidenceBundleInputSchema,
  listUnknownsInputSchema,
  navigationContextInputSchema,
  getEvidenceBundleInputSchema,
  verifyUnknownResolutionInputSchema,
} from "./sessionToolSchemas.js";
import { examplesFor } from "./toolContractHelpers.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";

const session = <
  Name extends keyof typeof sessionOutputSchemas,
  Schema extends z.ZodObject,
>(
  name: Name,
  description: string,
  inputSchema: Schema,
) =>
  ({
    name,
    ...toolContractMetadata(name),
    description,
    kind: "session",
    inputSchema,
    outputSchema: requireOutputSchema(sessionOutputSchemas, name),
    examples: examplesFor(name, inputSchema),
  }) satisfies ToolContract<Name, Schema>;

/** Session-owned Evidence bundle export options. */
export const exportEvidenceBundleInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute local filesystem path for the exported evidence bundle; relative paths are rejected.",
  ),
  overwrite: z.boolean().default(false),
});

/** Target lifecycle tools available only on the long-lived MCP adapter. */
export const SESSION_TOOL_CONTRACTS = [
  session(
    "open_binary",
    "Open a local executable, application bundle, archive, JavaScript, source map, plist, or analysis database after validation. format=dos-com explicitly interprets 1..65280 headerless bytes as a DOS COM analysis image. format=raw-binary interprets headerless bytes with a required architecture and entry_point; file offset 0 maps at that address. Omission preserves header-based detection. provider_id selects one deep provider or deterministic auto selection; the binding remains stable until close or an explicit switch, with no failure fallback. Reopening the same target and profile retains its active database and metadata edits. An optional analysis snapshot is imported atomically and must match the binary identity, concrete provider, and canonical analysis profile exactly; importing into a session with metadata mutations requires closing and reopening it first. Call close_binary when the investigation is finished.",
    openBinaryInputSchema,
  ),
  session(
    "open_bundle_resources",
    "Open a local app bundle for read-only plist, Interface Builder, asset catalog, and keyed archive inspection without resolving or inventing its executable identity. This switches the shared session to a resource-only lane; executable analysis is unavailable until another target is opened.",
    openBundleResourcesInputSchema,
  ),
  session(
    "close_binary",
    "When the investigation is finished, drain earlier provider requests, optionally write a provider-neutral analysis snapshot atomically to the caller-supplied path, then close the active analysis session and every provider resource started for it. Resource-only app sessions have no binary snapshot binding, so close them without snapshot_path. Later provider requests wait until this lifecycle operation finishes. Existing files require explicit overwrite; a failed save leaves the session open so cached analysis is not lost. Metadata edits prevent immutable snapshot saves until the session is recreated; export_evidence_bundle preserves mutable observations before closing without a snapshot.",
    closeBinaryInputSchema,
  ),
  session(
    "binary_session",
    'Report the active binary target or resource-only app root, provider and capability availability when applicable, client-feature, analysis, and server-identity status without starting analysis. The default summary lists omitted_fields; detail: "complete" adds provider diagnostics, candidate capabilities and static tool flags.',
    binarySessionInputSchema,
  ),
  session(
    "export_evidence_bundle",
    "Atomically write the session's deterministic Evidence bundle to the requested local path. Existing files require overwrite: true; records and manifests use canonical byte-stable ordering.",
    exportEvidenceBundleInputSchema,
  ),
  session(
    "import_evidence_bundle",
    "Read the JSON bundle at the supplied local path, validate every Evidence ID and canonical manifest, then atomically merge it. Imported content is data only and is never executed.",
    importEvidenceBundleInputSchema,
  ),
  session(
    "capture_process_scenario",
    "Run one caller-selected command under a PTY and return process capture Evidence with residual unknowns. The renderer admits at most 1,000,000 combined terminal cells, computed as columns × (rows + scrollback); every resize uses the selected scrollback and must fit the same budget. Supply a smaller terminal shape when that product is too large; dimensions are never clamped. This release has no runtime override for that cell budget. A command name resolves through the inherited PATH; the working directory defaults to the caller's current directory; host environment variables are inherited with scenario overrides. Environment keys cannot contain '=' or NUL, and REA_PROCESS_RUN_ID is reserved for process ownership. Filesystem snapshots are opt-in through filesystem_observation_paths. A positive finalization_ms makes a timeout or idle deadline send SIGTERM to the captured root through its start identity, keep observing, and send SIGKILL once after the interval; exit.finalization records each attempt with its delivery result and the observed exit, and cancellation still ends the run at once. The target runs with the current user's permissions; this is not a security sandbox.",
    processScenarioSchema,
  ),
  session(
    "compare_process_captures",
    "Compare two compatible process capture observations across terminal, interaction, lifecycle, process, filesystem, command-shim, HTTP, and WebSocket evidence. Optional trace_spec validates exact events against an explicit partial order or finite trace language; concurrency is never inferred from timestamps or broad sorting. Missing, journal-free, or truncated observations are never treated as equivalent.",
    processComparisonInputSchema,
  ),
  session(
    "compare_artifacts",
    'Compare complete artifact inventories by logical occurrence path, content identity, metadata, and graph relations. Name each side once without resending Evidence: {kind: "retained-evidence", evidence_id} selects an inspect_artifact result, its nested inventory, or its inspect_analysis_view summary retained in this session; {kind: "evidence-file", path, evidence_id?} reads one record from a local Evidence file or bundle at an absolute path. Complete inline Evidence is also accepted. Summary facts are not treated as a complete inventory; comparison resolves the exact complete parent from the same source bundle or the retained session. Every delta cites both complete inputs, and gaps yield truncated or unknown, never equivalence. Returns every change inline.',
    artifactComparisonInputSchema,
  ),
  session(
    "match_native_functions",
    "Match two retained list_procedures inventories by unique exact reported symbols, then unique identical observed function bytes. Optional same-context list_names/procedure_info/read_bytes/analyze_function Evidence supplies symbol origin, exact bodies, bytes and dossier links as supplied static facts. Optional compatible CFG/call/string fingerprints from supplied dossiers propose unresolved groups only. Duplicate candidates remain unresolved groups; only_left/right mean unpaired within supplied observations, never proof of addition/removal. Default summary retains complete Evidence for filtered, selected-column, paged function-matches views. Complete detail returns every group. Existing dossier pairs provide direct retained-reference compare_functions inputs.",
    matchNativeFunctionsInputSchema,
  ),
  session(
    "compare_functions",
    "Compare two explicit analyze_function Evidence records or exact retained session references across identity, exact provider text, calls, references, strings, and address-normalized CFG topology. Authenticated same-artifact entry coordinates establish correspondence independently of renamed labels; metadata and text changes remain separate. Missing or provider-incompatible facets remain truncated or unknown; every conclusion cites both Evidence sets.",
    functionComparisonInputSchema,
  ),
  session(
    "compare_bundles",
    "Compare two canonical Evidence bundles by exact record membership, explicit one-to-one observation pairs, and complete residual-unknown revision histories. Supply absolute local filesystem paths; relative paths are rejected. Missing bundle members describe omission only, never behavioral equivalence; output is digest-anchored and returns every change inline.",
    bundleComparisonMcpInputSchema,
  ),
  session(
    "find_changed_behavior",
    "Aggregate validated process, artifact, and function comparison Evidence, supplied inline or by exact retained-evidence references from this session. Original records and their complete source closure remain authenticated; summaries do not substitute for comparisons. Runtime observations remain distinct from static behavior candidates; missing or incomplete comparisons produce unresolved findings, never causal claims. Returns every finding inline.",
    changedBehaviorInputSchema,
  ),
  session(
    "build_call_path",
    "Build every shortest direct-callee path from complete analyze_function Evidence supplied inline or by exact retained-evidence references. References reuse the complete parent of an analyze_function summary without resending dossiers. Uses exact canonical addresses; missing dossiers and provider mixing remain unknown, and every node and edge cites source Evidence.",
    callPathRequestSchema,
  ),
  session(
    "correlate_static_and_runtime",
    "Evaluate every explicit caller-declared hypothesis between static and runtime comparison Evidence supplied inline or by exact retained-evidence references. Similar names or paths are never auto-matched, consistent cochange never proves causality, and unknown or truncated inputs remain unresolved. Returns all correlations and their complete Evidence closure inline.",
    staticRuntimeCorrelationRequestSchema,
  ),
  session(
    "verify_reconstruction",
    "Verify a finite typed behavioral and structural specification against a canonical Evidence bundle. Pass means every declared claim has complete comparable authority—not global source equivalence; changed claims fail and missing, limited, or unresolved evidence stays unknown.",
    reconstructionVerificationInputSchema,
  ),
  session(
    "list_unknowns",
    "List current residual-unknown heads in deterministic ID order, with optional exact status, severity, and domain filters. Results are complete inline by default; supply offset and limit to page the filtered order. total is the matching-head count and next_offset is null when the page exhausts the result. This is read-only; unresolved, contradicted, and non-truth dispositions remain distinct.",
    listUnknownsInputSchema,
  ),
  session(
    "record_unknown",
    "Create one deterministic residual unknown and immutable mutation evidence. Validates all evidence and relationship references, and rejects duplicate stable identity.",
    recordUnknownInputSchema,
  ),
  session(
    "update_unknown",
    "Append one immutable full-state revision and mutation evidence. Requires exact expected_revision; stale concurrent writers fail instead of overwriting newer analysis.",
    updateUnknownInputSchema,
  ),
  session(
    "verify_unknown_resolution",
    "Revalidate the current residual-unknown head against live bundled evidence, exact authority/confidence/environment requirements, and revision integrity. Withdrawn and out-of-scope dispositions are not truth claims.",
    verifyUnknownResolutionInputSchema,
  ),
  session(
    "get_evidence_bundle",
    "Return every retained Evidence record and residual unknown as a complete canonical bundle by default. detail=summary discovers retained records without copying or transferring their payloads; optionally filter by exact Evidence ID, operation, target SHA-256, analysis-profile digest or canonical native procedure address. Metadata distinguishes complete record retention from native value-flow truncation or unavailable/unknown coverage. Use a discovered evidence_id with inspect_analysis_view without restarting a provider. Filters apply only to summary delivery.",
    getEvidenceBundleInputSchema,
  ),
  {
    ...session(
      "get_navigation_context",
      "Return the selected document, current address, and containing/current procedure in one provider-neutral result. The result reflects sequential provider observations, not an atomic cursor snapshot; a cursor outside any procedure returns procedure: null.",
      navigationContextInputSchema,
    ),
    requiresActiveTarget: true,
  },
  session(
    "inspect_address_context",
    "Inspect one explicit reproducible address for its analyzed name, containing procedure, regular and inline comments, and matching bookmarks. Each unsupported facet returns a typed unavailable outcome; use xrefs, assembly, or pseudocode for those deeper views.",
    addressContextInputSchema,
  ),
] as const satisfies readonly ToolContract[];
