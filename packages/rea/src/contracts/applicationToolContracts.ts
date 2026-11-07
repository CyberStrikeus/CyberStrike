import { applicationInventoryProjectionInputSchema } from "../domain/mobileApplicationGraphProjection.js";
import { z } from "zod";
import {
  sourceToBundleSummaryViewResultSchema,
  sourceToBundlePageViewResultSchema,
} from "../domain/analysisView/analysisView.js";
import { applicationVersionComparisonResultSchema } from "../domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { applicationFeatureTraceResultSchema } from "../domain/javascript/javascriptFeatureTraceSchemas.js";
import { javaScriptSemanticTraceResultSchema } from "../domain/javascript/javascriptSemanticTraceSchemas.js";
import { javaScriptExportShapeComparisonResultSchema } from "../domain/javascript/javascriptExportShapeComparisonSchemas.js";
import { sourceToBundleComparisonResultSchema } from "../domain/javascript/sourceToBundleComparisonSchemas.js";
import {
  compareApplicationVersionsRequestSchema,
  compareJavaScriptExportShapesRequestSchema,
  compareSourceToBundleRequestSchema,
  traceApplicationFeatureRequestSchema,
  traceJavaScriptSemanticsRequestSchema,
} from "./javascript/applicationWorkflowInputContracts.js";
import { reconstructionCoverageEvaluationInputSchema } from "../domain/reconstructionCoverageInput.js";
import { reconstructionClosureResultSchema } from "../domain/reconstructionCoverage.js";
import {
  reconstructionObligationLedgerInputSchema,
  reconstructionObligationLedgerSchema,
} from "../domain/reconstructionObligationLedgerSchemas.js";
import { androidApplicationProjectionResultSchema } from "../domain/android/androidApplication.js";
import { appleApplicationProjectionResultSchema } from "../domain/apple/appleApplication.js";
import { harmonyApplicationProjectionResultSchema } from "../domain/harmony/harmonyApplication.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import {
  readGuidanceSectionInputSchema,
  readGuidanceSectionOutputSchema,
  searchGuidanceInputSchema,
  searchGuidanceOutputSchema,
} from "./guidanceContracts.js";
import {
  guidedWorkflowsInputSchema,
  guidedWorkflowsOutputSchema,
} from "./guidedWorkflowSchemas.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import {
  JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
  JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
  SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
} from "./javascript/javascriptApplicationWorkflowExamples.js";
import { JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE } from "./javascript/javascriptExportShapeComparisonExample.js";
import {
  ANDROID_APPLICATION_GRAPH_EXAMPLE,
  APPLE_APPLICATION_GRAPH_EXAMPLE,
  HARMONY_APPLICATION_GRAPH_EXAMPLE,
  MACOS_APPLICATION_GRAPH_EXAMPLE,
} from "./mobileApplicationGraphExamples.js";

const traceOutputSchema = evidenceResultOf(applicationFeatureTraceResultSchema);
const semanticTraceOutputSchema = evidenceResultOf(
  javaScriptSemanticTraceResultSchema,
);
const comparisonOutputSchema = evidenceResultOf(
  applicationVersionComparisonResultSchema,
);
const sourceToBundleOutputSchema = evidenceResultOf(
  z.union([
    sourceToBundleComparisonResultSchema,
    sourceToBundleSummaryViewResultSchema,
    sourceToBundlePageViewResultSchema,
  ]),
);
const exportShapeComparisonOutputSchema = evidenceResultOf(
  javaScriptExportShapeComparisonResultSchema,
);
const reconstructionObligationLedgerOutputSchema = evidenceResultOf(
  reconstructionObligationLedgerSchema,
);
const HASH = "0".repeat(64);
const retained = (evidence_id: string) => ({
  kind: "retained-evidence" as const,
  evidence_id,
});

/** Provider-neutral graph workflow contracts shared by MCP and CLI adapters. */
export const APPLICATION_TOOL_CONTRACTS = [
  {
    name: "search_guidance",
    ...toolContractMetadata("search_guidance"),
    description:
      "Search only the installed REA workflow guidance. Every non-generic query word must occur in a section. Returns ranked sections, bounded pages, and locators for read_guidance_section. No target or provider is accessed.",
    kind: "application",
    inputSchema: searchGuidanceInputSchema,
    outputSchema: searchGuidanceOutputSchema,
    examples: [
      {
        title: "Find exact JavaScript module guidance",
        input: { query: "exact JavaScript module" },
      },
    ],
  },
  {
    name: "guided_workflows",
    ...toolContractMetadata("guided_workflows"),
    description:
      "List or render REA's existing guided workflows. Rendering returns guidance only; it does not inspect targets, start analysis, or change session state.",
    kind: "application",
    inputSchema: guidedWorkflowsInputSchema,
    outputSchema: guidedWorkflowsOutputSchema,
    examples: [
      {
        title: "List the available guided workflows",
        input: { action: "list" },
      },
      {
        title: "Render feature investigation guidance",
        input: {
          action: "render",
          workflow_id: "investigate_feature",
          arguments: { feature: "offline search" },
        },
      },
    ],
  },
  {
    name: "read_guidance_section",
    ...toolContractMetadata("read_guidance_section"),
    description:
      "Retrieve a section selected by search_guidance from the installed REA guidance bundle. Reports stale locators and unavailable bundles explicitly. Returns documentation, not target observations or Evidence.",
    kind: "application",
    inputSchema: readGuidanceSectionInputSchema,
    outputSchema: readGuidanceSectionOutputSchema,
    examples: [],
  },
  {
    name: "trace_application_feature",
    ...toolContractMetadata("trace_application_feature"),
    description:
      "Trace a typed literal seed through every reachable part of an authenticated JavaScript Application Graph supplied as inline Evidence or exact same-session retained references. Original static, native, passive-runtime, inferred, and unknown authorities remain distinct; native addon handoffs never open a provider or execute the application.",
    kind: "application",
    inputSchema: traceApplicationFeatureRequestSchema,
    outputSchema: traceOutputSchema,
    examples: [
      {
        title: "Trace one module seed through a retained application graph",
        input: JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
      },
      {
        title: "Use exact Evidence already retained in this session",
        input: {
          ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
          application: retained(
            JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application.evidence_id,
          ),
        },
      },
    ],
  },
  {
    name: "trace_javascript_semantics",
    ...toolContractMetadata("trace_javascript_semantics"),
    description:
      "Trace static JavaScript data-flow, direct call/return, and closure relations from inline application Evidence or an exact same-session retained reference. Dynamic or unsupported semantics remain explicit unknowns; static reachability never claims runtime execution.",
    kind: "application",
    inputSchema: traceJavaScriptSemanticsRequestSchema,
    outputSchema: semanticTraceOutputSchema,
    examples: [
      {
        title: "Trace backward provenance from one semantic node",
        input: {
          application: JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application,
          query: {
            seed: { kind: "semantic-node", node_id: `jsrg_node_${HASH}` },
            direction: "backward-provenance",
          },
        },
      },
    ],
  },
  {
    name: "compare_application_versions",
    ...toolContractMetadata("compare_application_versions"),
    description:
      "Compare two authenticated JavaScript Application Graph versions supplied as inline Evidence or exact same-session retained references. Uses unique-only exact digest, module source digest, source-map identity, structural fingerprint, and non-module semantic-key tiers. Reports added, removed, changed, ambiguous, and unknown entities plus the complete matching changed_from graph without fuzzy or module-ordinal pairing.",
    kind: "application",
    inputSchema: compareApplicationVersionsRequestSchema,
    outputSchema: comparisonOutputSchema,
    examples: [
      {
        title: "Compare authenticated static and reconciled application graphs",
        input: JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
      },
      {
        title: "Use exact Evidence already retained in this session",
        input: {
          ...JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
          left: retained(
            JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE.left.evidence_id,
          ),
          right: retained(
            JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE.right.evidence_id,
          ),
        },
      },
    ],
  },
  {
    name: "compare_source_to_bundle",
    ...toolContractMetadata("compare_source_to_bundle"),
    description:
      "Compare a cryptographically committed HistoricalSourceGraph supplied inline or as reference {kind:file,path:absolute-local-JSON-path} with authenticated JavaScript Application Graph Evidence supplied inline or by exact same-session retained reference. Omitted view preserves the full report. Optional view {kind:summary} or {kind:source-to-bundle,collection:mappings|candidates,source_paths?,mapping_ids?,statuses?,fields?,offset?,limit?} retains the full parent and returns selected facts. Query it again using inspect_analysis_view. Empty filters select none; identity fields always remain. Candidate signals are opt-in; classifications use the full comparison. Page coverage never upgrades source coverage. Uses explicit exact-digest, source-map path, current-path, suffix, and basename signals with stable weights. Classifies unchanged, modified, removed, split, merged, duplicated, and unknown; incomplete coverage and ambiguous weak signals never become absence or forced matches.",
    kind: "application",
    inputSchema: compareSourceToBundleRequestSchema,
    outputSchema: sourceToBundleOutputSchema,
    examples: [
      {
        title:
          "Compare committed historical source with a shipped bundle graph",
        input: SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
      },
    ],
  },
  {
    name: "compare_javascript_export_shapes",
    ...toolContractMetadata("compare_javascript_export_shapes"),
    description:
      "Compare static return shapes for one exact module/export selector on each authenticated JavaScript Application Graph supplied as inline Evidence or exact same-session retained references. Variants pair only by reciprocal unique literal discriminants. Each retained variant lists observed return-property names even when values stay unknown. Presence (present, absent, or unknown-coverage) is separate from value resolution: a name present on only one paired shape is added or removed when parent-property coverage is complete on both sides, including when the static value is unresolved. Dynamic values, incomplete parent coverage, and unpaired variants remain unknown. Reports JSON Pointer changes without executing JavaScript; runtime behavior requires a separate agent-run probe.",
    kind: "application",
    inputSchema: compareJavaScriptExportShapesRequestSchema,
    outputSchema: exportShapeComparisonOutputSchema,
    examples: [
      {
        title:
          "Report observed return-property presence when static values stay unknown",
        input: JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE,
      },
      {
        title: "Use exact Evidence already retained in this session",
        input: {
          ...JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE,
          left: retained(
            JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE.left.evidence_id,
          ),
          right: retained(
            JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE.right.evidence_id,
          ),
        },
      },
    ],
  },
  {
    name: "build_reconstruction_obligation_ledger",
    ...toolContractMetadata("build_reconstruction_obligation_ledger"),
    description:
      "Generate the complete deterministic ReconstructionObligationLedger from an authenticated Evidence bundle, reviewed obligations, and an explicit reconstruction manifest. Static candidates remain candidates; duplicate ownership, missing original or reconstruction cases, missing parser/type, weak verifier authority, unenumerated claims, contradictions, dependencies, and residual unknowns fail closed. The inline result carries the full-ledger closure digest and typed per-obligation diagnostics.",
    kind: "application",
    inputSchema: reconstructionObligationLedgerInputSchema,
    outputSchema: reconstructionObligationLedgerOutputSchema,
    examples: [
      {
        title: "Generate the complete obligation ledger",
        input: {
          evidence_bundle: {
            artifacts: [],
            providers: [],
            environments: [],
            scenarios: [],
            captures: [],
            unknowns: [],
            records: [],
          },
          reviewed_obligations: [],
          manifest: {
            bindings: [],
            contradictions: [],
          },
        },
      },
    ],
  },
  {
    name: "evaluate_reconstruction_coverage",
    ...toolContractMetadata("evaluate_reconstruction_coverage"),
    description:
      "Evaluate inline evidence-backed reconstruction coverage against one named boundary. Missing ownership or inventory is partial; stale, weak, truncated, skipped, unresolved, or conflicting tied verifier proof is unknown; contradictions, failed proof, missing owners, and authority routing fail closed.",
    kind: "application",
    inputSchema: reconstructionCoverageEvaluationInputSchema,
    outputSchema: reconstructionClosureResultSchema,
    examples: [
      {
        title: "Evaluate one replacement boundary",
        input: {
          coverage: {
            evidence_bundle: {
              artifacts: [],
              providers: [],
              environments: [],
              scenarios: [],
              captures: [],
              unknowns: [],
              records: [],
            },
            artifacts: [],
            surfaces: [],
            owners: [],
            claims: [],
            verifier_contracts: [],
            verifier_results: [],
            residual_unknown_ids: [],
            contradictions: [],
            package_proofs: [],
            boundaries: [
              {
                boundary_id: "replacement.cli",
                title: "CLI replacement",
                required_surface_ids: ["cli.help"],
                required_claim_ids: ["claim.cli.help"],
                required_package_proof_kinds: [
                  "clean-install",
                  "authority-independence",
                ],
                allowed_dispositions: [],
                allowed_unknown_ids: [],
              },
            ],
          },
          boundary_id: "replacement.cli",
        },
      },
    ],
  },
  {
    name: "project_android_application_graph",
    ...toolContractMetadata("project_android_application_graph"),
    description:
      "Project authenticated APK inventory_artifact Evidence into an execution-free Android application inventory. Reports exact component paths and hashes, runtime-family hints, and path-based bridge hypotheses without decoding DEX, executing the APK, or claiming observed runtime calls.",
    kind: "application",
    inputSchema: applicationInventoryProjectionInputSchema,
    outputSchema: evidenceResultOf(androidApplicationProjectionResultSchema),
    examples: [
      {
        title:
          "Project APK inventory Evidence into an Android application graph",
        input: ANDROID_APPLICATION_GRAPH_EXAMPLE,
      },
    ],
  },
  {
    name: "project_apple_application_graph",
    ...toolContractMetadata("project_apple_application_graph"),
    description:
      "Project authenticated IPA, macOS .app directory, ZIP, or DMG inventory Evidence into an execution-free Apple application inventory. Reports application roots, nested bundles with path-convention roles (app extensions, XPC services, login items, privileged helpers, system extensions, frameworks), launchd plists, exact component paths and hashes, runtime-family hints, and path-based bridge hypotheses without parsing plist/CMS semantics or claiming observed runtime calls.",
    kind: "application",
    inputSchema: applicationInventoryProjectionInputSchema,
    outputSchema: evidenceResultOf(appleApplicationProjectionResultSchema),
    examples: [
      {
        title: "Project IPA inventory Evidence into an Apple application graph",
        input: APPLE_APPLICATION_GRAPH_EXAMPLE,
      },
      {
        title:
          "Project a macOS .app directory inventory into its bundle anatomy",
        input: MACOS_APPLICATION_GRAPH_EXAMPLE,
      },
    ],
  },
  {
    name: "project_harmony_application_graph",
    ...toolContractMetadata("project_harmony_application_graph"),
    description:
      "Project authenticated HarmonyOS HAP, HSP, or App Pack inventory Evidence into an execution-free application inventory. Reports packaging-model hints (Stage module.json versus FA config.json), exact component paths and hashes (manifests, Ark bytecode, resources, native libraries, JavaScript, signing), App Pack child packages, runtime-family hints, and path-based N-API bridge hypotheses without decoding Ark bytecode, parsing manifest semantics, or claiming observed runtime calls.",
    kind: "application",
    inputSchema: applicationInventoryProjectionInputSchema,
    outputSchema: evidenceResultOf(harmonyApplicationProjectionResultSchema),
    examples: [
      {
        title:
          "Project HAP inventory Evidence into a HarmonyOS application graph",
        input: HARMONY_APPLICATION_GRAPH_EXAMPLE,
      },
    ],
  },
] as const satisfies readonly ToolContract[];
