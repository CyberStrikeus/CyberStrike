import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage } from "@electron/asar";

import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import type { ApplicationNode } from "../../../src/domain/javascript/javascriptApplicationGraphSchemas.js";
import { javaScriptExportShapeComparisonResultSchema } from "../../../src/domain/javascript/javascriptExportShapeComparisonSchemas.js";
import {
  applicationFeatureTraceResultSchema,
  featureSeedMatchMode,
} from "../../../src/domain/javascript/javascriptFeatureTraceSchemas.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import {
  managedArtifactInspectionSchema,
  managedMemberInspectionSchema,
} from "../../../src/domain/managed/managedArtifact.js";
import {
  managedTokenScopesMatch,
  readManagedInspectionEvidence,
} from "../../../src/domain/managed/managedInspectionEvidence.js";
import { compareUnicodeCodePoints } from "../../../src/domain/unicodeCodePointOrder.js";
import type {
  FixtureClaimContext,
  FixtureClaimExpectation,
} from "./KnownAnswerEvaluation.js";

/** Source-owned artifact paths used by the configured known-answer benchmarks. */
export interface AgentEvaluationFixtureTargets {
  readonly javascript: string;
  readonly javascriptSha256: string;
  readonly javascriptShapeLeft: string;
  readonly javascriptShapeRight: string;
  readonly notesElectron: string;
  readonly notesElectronSha256: string;
  readonly managed?: string;
  readonly managedSha256?: string;
}

const desktopFixtureFiles = {
  "package.json": `${JSON.stringify({ name: "desktop-fixture", version: "1.0.0", main: "main.js" }, null, 2)}\n`,
  "main.js":
    'const { BrowserWindow, ipcMain } = require("electron");\nnew BrowserWindow({ webPreferences: { preload: require("node:path").join(__dirname, "preload.js"), contextIsolation: true, sandbox: true } });\nipcMain.handle("profile:read", (_event, id) => ({ id }));\n',
  "preload.js":
    'const { contextBridge, ipcRenderer } = require("electron");\ncontextBridge.exposeInMainWorld("profileApi", { read: (id) => ipcRenderer.invoke("profile:read", id) });\n',
  "renderer/app.js": 'globalThis.profileApi.read("fixture");\n',
};

/** Materialize the exact packaged and source-owned parser targets used by the runner. */
export const createAgentEvaluationFixtures = async (
  root: string,
  repositoryRoot: string,
): Promise<AgentEvaluationFixtureTargets> => {
  const desktop = join(root, "desktop-app");
  const javascript = join(root, "desktop-app.asar");
  const javascriptShapeLeft = join(root, "parser-v1");
  const javascriptShapeRight = join(root, "parser-v2");
  const notesDirectory = join(root, "notes-electron");
  const notesElectron = join(root, "notes-electron.asar");
  await Promise.all([
    mkdir(join(desktop, "renderer"), { recursive: true }),
    mkdir(javascriptShapeLeft, { recursive: true }),
    mkdir(javascriptShapeRight, { recursive: true }),
  ]);
  await Promise.all([
    ...Object.entries(desktopFixtureFiles).map(([path, source]) =>
      writeFile(join(desktop, path), source),
    ),
    cp(
      join(repositoryRoot, "tests/fixtures/replay/parser.mjs"),
      join(javascriptShapeLeft, "parser.mjs"),
    ),
    cp(
      join(repositoryRoot, "tests/fixtures/replay/parser-v2.mjs"),
      join(javascriptShapeRight, "parser.mjs"),
    ),
    cp(
      join(repositoryRoot, "website/public/examples/notes-electron"),
      notesDirectory,
      { recursive: true },
    ),
  ]);
  await createPackage(desktop, javascript);
  await createPackage(notesDirectory, notesElectron);
  return {
    javascript,
    javascriptSha256: createHash("sha256")
      .update(await readFile(javascript))
      .digest("hex"),
    javascriptShapeLeft,
    javascriptShapeRight,
    notesElectron,
    notesElectronSha256: createHash("sha256")
      .update(await readFile(notesElectron))
      .digest("hex"),
  };
};

type GraphObservation = ApplicationNode["observations"][number];

const singleObservation = (
  value: JsonValue,
  kind: ApplicationNode["kind"],
  include: (observation: GraphObservation) => boolean = () => true,
): GraphObservation | undefined => {
  const result = javascriptApplicationAnalysisResultSchema.safeParse(value);
  if (!result.success) return undefined;
  const candidates = result.data.graph.nodes
    .filter((node) => node.kind === kind)
    .flatMap((node) => node.observations)
    .filter(include);
  return candidates.length === 1 ? candidates[0] : undefined;
};

const observationSource = (
  observation: GraphObservation,
): string | undefined => {
  const location = observation.evidence.location;
  return location.available && location.value.kind === "source-range"
    ? location.value.source
    : undefined;
};

const rendererApi = (value: JsonValue): JsonValue | undefined => {
  const observation = singleObservation(value, "context-bridge-api");
  if (observation === undefined) return undefined;
  const { api_key: key, members, world } = observation.properties;
  const source = observationSource(observation);
  if (
    key === undefined ||
    members === undefined ||
    world === undefined ||
    source === undefined
  )
    return undefined;
  return { key, members, world, source };
};

const ipcOperation =
  (side: string) =>
  (value: JsonValue): JsonValue | undefined => {
    const observation = singleObservation(
      value,
      "ipc-channel",
      (candidate) => candidate.properties.side === side,
    );
    if (observation === undefined) return undefined;
    const { channel, operation } = observation.properties;
    const source = observationSource(observation);
    if (
      channel === undefined ||
      operation === undefined ||
      source === undefined
    )
      return undefined;
    return { channel, operation, source };
  };

const preload = (value: JsonValue): JsonValue | undefined => {
  const observation = singleObservation(
    value,
    "electron-preload",
    (candidate) =>
      candidate.properties.mechanism === "BrowserWindow:webPreferences.preload",
  );
  const path = observation?.properties.resolved_path;
  const resolutionStatus = observation?.properties.resolution_status;
  if (path === undefined || resolutionStatus === undefined) return undefined;
  return { path, resolution_status: resolutionStatus };
};

const headingChange = (value: JsonValue): JsonValue | undefined => {
  const result = javaScriptExportShapeComparisonResultSchema.safeParse(value);
  if (!result.success) return undefined;
  const changes = result.data.changes.filter(
    (change) => change.path === "/depth",
  );
  const change = changes.length === 1 ? changes[0] : undefined;
  if (change === undefined) return undefined;
  return {
    status: change.status,
    path: change.path,
    discriminant: change.discriminant,
    left: change.left,
    right: change.right,
  };
};

const comparisonCoverage = (value: JsonValue): JsonValue | undefined => {
  const result = javaScriptExportShapeComparisonResultSchema.safeParse(value);
  if (!result.success) return undefined;
  return {
    status: result.data.coverage.status,
    paired_variants: result.data.coverage.paired_variants,
    ...result.data.summary,
  };
};

const runtimeSemantics = (value: JsonValue): JsonValue | undefined => {
  const result = javaScriptExportShapeComparisonResultSchema.safeParse(value);
  return result.success &&
    result.data.limitations.includes(
      "Return shapes are inferred from inert syntax and do not prove runtime behavior.",
    )
    ? "not_established"
    : undefined;
};

const featureModules = (value: JsonValue): JsonValue | undefined => {
  const result = applicationFeatureTraceResultSchema.safeParse(value);
  if (!result.success || result.data.graph === null) return undefined;
  if (
    result.data.seed.kind !== "channel" ||
    result.data.seed.value !== "notes:export" ||
    featureSeedMatchMode(result.data.seed) !== "exact"
  )
    return undefined;
  const paths = result.data.graph.nodes
    .filter((node) => node.kind === "javascript-module")
    .flatMap((node) => node.observations)
    .filter(({ properties }) => properties.semantic_role === "source-module")
    .map(({ properties }) => properties.path);
  if (paths.length === 0 || !paths.every((path) => typeof path === "string"))
    return undefined;
  return {
    paths: [...new Set(paths)].sort(compareUnicodeCodePoints),
    coverage: result.data.coverage.status,
  };
};

const semanticBoundary = (value: JsonValue): JsonValue | undefined => {
  const result = javaScriptSemanticTraceResultSchema.safeParse(value);
  if (!result.success) return undefined;
  return {
    status: result.data.status,
    coverage: result.data.coverage.status,
    relevant_unknowns: result.data.summary.relevant_unknowns,
  };
};

const notesClaims = (
  targets: AgentEvaluationFixtureTargets,
): readonly FixtureClaimExpectation[] => {
  const subject = {
    path: targets.notesElectron,
    sha256: targets.notesElectronSha256,
  };
  const derived = {
    authority: "analyst-inference",
    confidence: "inferred",
    linkedSubjects: [
      { operation: "analyze_javascript_application", ...subject },
    ],
  } satisfies Pick<
    FixtureClaimExpectation["source"],
    "authority" | "confidence" | "linkedSubjects"
  >;
  // Fixture source establishes bridge/module facts; the semantic claim checks
  // the bounded static-query contract, not execution or CSV formatter behavior.
  return [
    ...bridgeClaims(subject, "notes", ["exportCsv"], "notes:export"),
    {
      id: "feature_modules",
      expectedValue: {
        paths: ["csv.js", "main.js", "preload.js", "renderer.js"],
        // The renderer's exportNotes().catch(...) leaves a Promise member
        // unresolved in static analysis, so the graph reports partial coverage.
        coverage: "partial",
      },
      source: {
        ...derived,
        operation: "trace_application_feature",
        parameters: {
          direction: "both",
        },
        select: featureModules,
      },
    },
    {
      id: "semantic_boundary",
      expectedValue: {
        status: "ambiguous",
        coverage: "partial",
        relevant_unknowns: 1,
      },
      source: {
        ...derived,
        operation: "trace_javascript_semantics",
        parameters: {
          query: {
            seed: { kind: "property", name: "invoke" },
            direction: "forward-influence",
            include_ambiguous_dynamic_edges: false,
            expected: null,
          },
        },
        select: semanticBoundary,
      },
    },
  ];
};

const bridgeClaims = (
  subject: { readonly path: string; readonly sha256: string },
  key: string,
  members: readonly string[],
  channel: string,
): readonly FixtureClaimExpectation[] => {
  const source = {
    operation: "analyze_javascript_application",
    authority: "shipped-artifact",
    confidence: "derived",
    subject,
  } satisfies Omit<FixtureClaimExpectation["source"], "select">;
  return [
    {
      id: "renderer_api",
      expectedValue: {
        key,
        members: [...members],
        world: "main",
        source: "preload.js",
      },
      source: { ...source, select: rendererApi },
    },
    {
      id: "renderer_ipc",
      expectedValue: {
        channel,
        operation: "invoke",
        source: "preload.js",
      },
      source: { ...source, select: ipcOperation("renderer") },
    },
    {
      id: "main_ipc",
      expectedValue: {
        channel,
        operation: "handle",
        source: "main.js",
      },
      source: { ...source, select: ipcOperation("main") },
    },
    {
      id: "preload",
      expectedValue: { path: "preload.js", resolution_status: "resolved" },
      source: { ...source, select: preload },
    },
  ];
};

const asarClaims = (
  targets: AgentEvaluationFixtureTargets,
): readonly FixtureClaimExpectation[] =>
  bridgeClaims(
    { path: targets.javascript, sha256: targets.javascriptSha256 },
    "profileApi",
    ["read"],
    "profile:read",
  );

const parserClaims = (
  targets: AgentEvaluationFixtureTargets,
): readonly FixtureClaimExpectation[] => {
  const source = {
    operation: "compare_javascript_export_shapes",
    authority: "analyst-inference",
    confidence: "inferred",
    parameters: {
      left_module_path: "parser.mjs",
      left_export_name: "default",
      right_module_path: "parser.mjs",
      right_export_name: "default",
    },
    linkedSubjects: [
      {
        operation: "analyze_javascript_application",
        path: targets.javascriptShapeLeft,
      },
      {
        operation: "analyze_javascript_application",
        path: targets.javascriptShapeRight,
      },
    ],
  } satisfies Omit<FixtureClaimExpectation["source"], "select">;
  return [
    {
      id: "heading_change",
      expectedValue: {
        status: "added",
        path: "/depth",
        discriminant: { path: "/type", value: "heading" },
        left: { availability: "absent" },
        right: { availability: "literal", value: 1 },
      },
      source: { ...source, select: headingChange },
    },
    {
      id: "comparison_coverage",
      expectedValue: {
        status: "complete-within-inputs",
        paired_variants: 3,
        added: 1,
        removed: 0,
        changed: 0,
        unknown: 0,
      },
      source: { ...source, select: comparisonCoverage },
    },
    {
      id: "runtime_semantics",
      expectedValue: "not_established",
      source: { ...source, select: runtimeSemantics },
    },
  ];
};

const managedMembers = ({ evidence }: FixtureClaimContext) => {
  const parsed = readManagedInspectionEvidence(
    evidence,
    "inspect_managed_members",
    managedMemberInspectionSchema,
    { operation: "agent_evaluation", path: ["evidence"] },
  );
  if (!parsed.ok) throw parsed.error;
  const { result } = parsed.value;
  if (
    result.coverage.state !== "complete" ||
    result.metadata.status !== "complete" ||
    !managedTokenScopesMatch(
      result.identity_scope.requires_mvid,
      result.module?.mvid ?? null,
    )
  )
    return undefined;
  return result;
};

const managedClaims = (
  targets: AgentEvaluationFixtureTargets,
): readonly FixtureClaimExpectation[] => {
  if (targets.managed === undefined || targets.managedSha256 === undefined)
    throw new TypeError(
      "Managed fixture grading requires the built DLL path and SHA-256",
    );
  const source = {
    operation: "inspect_managed_members",
    authority: "shipped-artifact",
    confidence: "observed",
    subject: { path: targets.managed, sha256: targets.managedSha256 },
  } satisfies Omit<FixtureClaimExpectation["source"], "select">;
  return [
    {
      id: "public_types",
      expectedValue: ["AgentEval.Profile", "AgentEval.Program"],
      source: {
        ...source,
        select: (_value, context) => {
          const members = managedMembers(context);
          if (
            members === undefined ||
            members.selection !== null ||
            Object.hasOwn(context.evidence.parameters, "type_names")
          )
            return undefined;
          return members.types
            .filter((type) => (type.flags & 7) === 1)
            .map((type) => type.full_name)
            .sort(compareUnicodeCodePoints);
        },
      },
    },
    {
      id: "entry_point",
      expectedValue: { declaring_type: "AgentEval.Program", name: "Main" },
      source: {
        ...source,
        select: (_value, context) => {
          const members = managedMembers(context);
          if (members === undefined) return undefined;
          const artifacts = context.deliveredEvidence.filter(
            (evidence) =>
              evidence.operation === "inspect_managed_artifact" &&
              evidence.authority === source.authority &&
              evidence.confidence === source.confidence &&
              evidence.subject?.local_path === source.subject.path &&
              evidence.subject.digest.sha256 === source.subject.sha256,
          );
          if (artifacts.length !== 1) return undefined;
          const parsedArtifact = readManagedInspectionEvidence(
            artifacts[0],
            "inspect_managed_artifact",
            managedArtifactInspectionSchema,
            { operation: "agent_evaluation", path: ["deliveredEvidence"] },
          );
          if (!parsedArtifact.ok) throw parsedArtifact.error;
          const { result: artifact } = parsedArtifact.value;
          if (
            artifact.coverage.state !== "complete" ||
            artifact.metadata.status !== "complete" ||
            !managedTokenScopesMatch(
              artifact.module?.mvid ?? null,
              members.module?.mvid ?? null,
            ) ||
            artifact.pe.cli?.entry_point.kind !== "metadata-token"
          )
            return undefined;
          const methods = members.methods.filter(
            (method) => method.token === artifact.pe.cli?.entry_point.value,
          );
          const method = methods.length === 1 ? methods[0] : undefined;
          return method === undefined
            ? undefined
            : {
                declaring_type: method.declaring_type,
                name: method.name,
              };
        },
      },
    },
  ];
};

/** Return the closed known-answer rubric, or undefined for routing-only scenarios. */
export const agentFixtureClaims = (
  scenarioId: string,
  targets: AgentEvaluationFixtureTargets,
): readonly FixtureClaimExpectation[] | undefined => {
  if (scenarioId === "asar") return asarClaims(targets);
  if (scenarioId === "managed") return managedClaims(targets);
  if (scenarioId === "javascript-export-shape") return parserClaims(targets);
  if (scenarioId === "notes-export") return notesClaims(targets);
  return undefined;
};

const bridgeAnswerDescriptions = [
  'renderer_api: {"key": string, "members": string[], "world": string, "source": string}, describing the exposed bridge API, its members, world, and source file.',
  'renderer_ipc: {"channel": string, "operation": string, "source": string}, describing the renderer-side IPC operation and its source file.',
  'main_ipc: {"channel": string, "operation": string, "source": string}, describing the main-side IPC operation and its source file.',
  'preload: {"path": string, "resolution_status": string}, describing the BrowserWindow-declared preload resolved within the shipped artifact.',
];

const answerValueDescriptions: Readonly<Record<string, readonly string[]>> = {
  managed: [
    "public_types: string[], listing the exact public top-level type full names in Unicode code-point order from unfiltered member Evidence (omit type_names).",
    'entry_point: {"declaring_type": string, "name": string}, resolving the CLI metadata entry-point token against the member inventory from the same artifact SHA-256 and module MVID. Cite member Evidence; both artifact and member Evidence must be delivered.',
  ],
  asar: bridgeAnswerDescriptions,
  "javascript-export-shape": [
    'heading_change: {"status": string, "path": string, "discriminant": object or null, "left": object, "right": object}, copying the exact heading-change fields from the comparison result.',
    'comparison_coverage: {"status": string, "paired_variants": number, "added": number, "removed": number, "changed": number, "unknown": number}, copying comparison coverage and summary counts.',
    'runtime_semantics: "established" or "not_established", stating whether the cited comparison establishes runtime behavior.',
  ],
  "notes-export": [
    ...bridgeAnswerDescriptions,
    'feature_modules: {"paths": string[], "coverage": string}, listing the unique source-module observation paths in the feature trace in Unicode code-point order, and its coverage status.',
    'semantic_boundary: {"status": string, "coverage": string, "relevant_unknowns": number}, copying the semantic trace status, coverage status, and summary.relevant_unknowns. Static traces do not establish runtime execution.',
  ],
};

/** Describe the strict answer contract without revealing any golden fixture values. */
export const agentFixtureAnswerInstructions = (scenarioId: string): string => {
  const descriptions = answerValueDescriptions[scenarioId];
  if (descriptions === undefined) return "";
  return [
    "For this benchmark, return only one JSON object, without Markdown fences or surrounding prose.",
    'The exact shape is {"claims": [{"id": string, "value": JSON value, "evidence_id": string, "confidence": string, "authority": string}]}.',
    "Include exactly one claim per ID below, without additional fields or claims. Infer values only from REA tool results; do not read target files directly.",
    "Each evidence_id must identify the successful REA result that supports its claim. Copy confidence and authority from that result's Evidence envelope.",
    ...descriptions,
  ].join("\n");
};
