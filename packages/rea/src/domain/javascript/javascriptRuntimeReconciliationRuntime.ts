import type { JsonValue } from "../jsonValue.js";
import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationNode,
} from "./javascriptApplicationGraph.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "./javascriptApplicationGraphSchemas.js";
import type { ApplicationGraphEvidence } from "./javascriptApplicationEvidenceSchemas.js";
import type { ParsedRuntimeCapture } from "./javascriptRuntimeReconciliationCaptureParsing.js";

export interface RuntimeReconciliationEntity {
  readonly kind: "target" | "frame" | "script" | "worker";
  readonly section: "target" | "frames" | "scripts" | "workers";
  readonly node: ApplicationNode;
  readonly capture: ParsedRuntimeCapture;
  readonly runtimeKey: string;
  readonly location: {
    readonly kind: "file" | "url" | "unresolved";
    readonly value: string;
  };
  readonly frameKey: string | null;
  readonly sourceSha256: string | null;
  readonly staticKind: "renderer" | "javascript" | "worker" | "service-worker";
}

export interface RuntimeProjection {
  readonly entities: readonly RuntimeReconciliationEntity[];
  readonly nodes: readonly ApplicationNode[];
  readonly edges: readonly ApplicationEdge[];
  readonly targetNodeByEvidenceId: ReadonlyMap<string, ApplicationNode>;
  readonly omittedEntities: number;
}

/** Project authorized passive capture metadata into capture-scoped JAG nodes. */
export const projectRuntimeCaptures = (
  captures: readonly ParsedRuntimeCapture[],
): RuntimeProjection => {
  const all = captures.flatMap(projectCapture);
  const retained = all;
  const retainedIds = new Set(retained.map(({ node }) => node.node_id));
  const nodes = retained.map(({ node }) => node);
  const edges = captures
    .flatMap((capture) => runtimeEdges(capture, all))
    .filter(
      ({ source_node_id: source, target_node_id: target }) =>
        retainedIds.has(source) && retainedIds.has(target),
    );
  const targetNodeByEvidenceId = new Map(
    retained
      .filter(({ kind }) => kind === "target")
      .map(({ capture, node }) => [capture.evidence.evidence_id, node]),
  );
  return {
    entities: retained,
    nodes,
    edges,
    targetNodeByEvidenceId,
    omittedEntities: 0,
  };
};

const projectCapture = (
  capture: ParsedRuntimeCapture,
): RuntimeReconciliationEntity[] => {
  const target = targetEntity(capture);
  return [
    target,
    ...frameEntities(capture),
    ...scriptEntities(capture),
    ...workerEntities(capture),
  ];
};

const targetEntity = (
  capture: ParsedRuntimeCapture,
): RuntimeReconciliationEntity => {
  const target = capture.inspection.target;
  const location =
    "unresolved_location" in target
      ? ({
          kind: "unresolved",
          value: target.unresolved_location.reported_url,
        } as const)
      : "url" in target
        ? ({ kind: "url", value: target.url } as const)
        : ({ kind: "file", value: target.file_path } as const);
  return runtimeEntity(capture, {
    kind: "target",
    nodeKind: "target",
    runtimeKey: target.target_id,
    targetKey: target.target_id,
    frameKey: null,
    scriptKey: null,
    location,
    staticKind: "renderer",
    sourceSha256: null,
    label: target.title,
    properties: {
      runtime_type: target.type,
      ...(location.kind === "unresolved"
        ? {
            reported_url: location.value,
            location_kind: "unresolved",
            location_reason: "unverifiable-file-location",
          }
        : { location: location.value }),
      attached: target.attached,
    },
    section: "target",
  });
};

const frameEntities = (
  capture: ParsedRuntimeCapture,
): RuntimeReconciliationEntity[] =>
  capture.inspection.frames.map((frame) => {
    const location =
      "url" in frame
        ? ({ kind: "url", value: frame.url } as const)
        : ({ kind: "file", value: frame.file_path } as const);
    return runtimeEntity(capture, {
      kind: "frame",
      nodeKind: "frame",
      runtimeKey: frame.frame_id,
      targetKey: capture.inspection.target.target_id,
      frameKey: frame.frame_id,
      scriptKey: null,
      location,
      staticKind: "renderer",
      sourceSha256: null,
      label: location.value,
      properties: {
        parent_frame_id: frame.parent_frame_id,
        location: location.value,
      },
      section: "frames",
    });
  });

const scriptEntities = (
  capture: ParsedRuntimeCapture,
): RuntimeReconciliationEntity[] =>
  capture.inspection.scripts.items.map((script) => {
    const location =
      "unresolved_location" in script
        ? ({
            kind: "unresolved",
            value: script.unresolved_location.reported_url,
          } as const)
        : "url" in script
          ? ({ kind: "url", value: script.url } as const)
          : ({ kind: "file", value: script.file_path } as const);
    return runtimeEntity(capture, {
      kind: "script",
      nodeKind: "runtime-script-instance",
      runtimeKey: script.script_key,
      targetKey: capture.inspection.target.target_id,
      frameKey:
        "frame_scope" in script && script.frame_scope === "unknown"
          ? null
          : script.frame_id,
      scriptKey: script.script_key,
      location,
      staticKind: "javascript",
      sourceSha256: script.source.included
        ? script.source.artifact.sha256
        : null,
      label: location.value,
      properties: {
        ...("unresolved_location" in script
          ? {
              location_kind: "unresolved",
              reported_url: script.unresolved_location.reported_url,
              location_reason: script.unresolved_location.reason,
            }
          : { location: location.value }),
        ...("reported_url" in script && script.reported_url !== undefined
          ? { reported_url: script.reported_url }
          : {}),
        ...("frame_scope" in script && script.frame_scope !== undefined
          ? {
              frame_scope: script.frame_scope,
              reported_frame_id: script.frame_id,
            }
          : {}),
        ...("has_source_url" in script && script.has_source_url !== undefined
          ? { has_source_url: script.has_source_url }
          : {}),
        ...("frame_claims" in script && script.frame_claims !== undefined
          ? { frame_claims: script.frame_claims }
          : {}),
        cdp_hash: script.cdp_hash,
        length: script.length,
        is_module: script.is_module,
        language: script.language,
        source_sha256: script.source.included
          ? script.source.artifact.sha256
          : null,
        ...("source_map_url" in script
          ? { source_map_url: script.source_map_url }
          : {}),
      },
      section: "scripts",
      ...(script.source.included
        ? { artifactSha256: script.source.artifact.sha256 }
        : {}),
    });
  });

const workerEntities = (
  capture: ParsedRuntimeCapture,
): RuntimeReconciliationEntity[] =>
  capture.inspection.workers.map((worker) => {
    const location =
      "url" in worker
        ? ({ kind: "url", value: worker.url } as const)
        : ({ kind: "file", value: worker.file_path } as const);
    const serviceWorker = worker.type.includes("service");
    return runtimeEntity(capture, {
      kind: "worker",
      nodeKind: serviceWorker ? "service-worker" : "worker",
      runtimeKey: worker.target_id,
      targetKey: worker.target_id,
      frameKey: worker.parent_frame_id,
      scriptKey: null,
      location,
      staticKind: serviceWorker ? "service-worker" : "worker",
      sourceSha256: null,
      label: location.value,
      properties: {
        runtime_type: worker.type,
        location: location.value,
        attached: worker.attached,
        opener_target_id: worker.opener_target_id,
        parent_frame_id: worker.parent_frame_id,
      },
      section: "workers",
    });
  });

interface RuntimeEntityInput {
  readonly kind: RuntimeReconciliationEntity["kind"];
  readonly nodeKind: ApplicationNode["kind"];
  readonly runtimeKey: string;
  readonly targetKey: string;
  readonly frameKey: string | null;
  readonly scriptKey: string | null;
  readonly location: RuntimeReconciliationEntity["location"];
  readonly staticKind: RuntimeReconciliationEntity["staticKind"];
  readonly sourceSha256: string | null;
  readonly label: string;
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly section: "target" | "frames" | "scripts" | "workers";
  readonly artifactSha256?: string;
}

const runtimeEntity = (
  capture: ParsedRuntimeCapture,
  input: RuntimeEntityInput,
): RuntimeReconciliationEntity => ({
  kind: input.kind,
  section: input.section,
  capture,
  runtimeKey: input.runtimeKey,
  location: input.location,
  frameKey: input.frameKey,
  sourceSha256: input.sourceSha256,
  staticKind: input.staticKind,
  node: createJavaScriptApplicationNode({
    kind: input.nodeKind,
    identity: {
      strategy: "runtime-instance",
      stability: "capture-only",
      capture_sha256: capture.captureSha256,
      runtime_key: input.runtimeKey,
    },
    observations: [
      {
        label: input.label || null,
        properties: input.properties,
        evidence: runtimeEvidence(capture, input),
      },
    ],
  }),
});

const runtimeEvidence = (
  capture: ParsedRuntimeCapture,
  input: RuntimeEntityInput,
): ApplicationGraphEvidence => ({
  authority: "passive-cdp-runtime",
  state: "observed",
  confidence: "exact",
  artifact:
    input.artifactSha256 === undefined
      ? {
          available: false,
          reason:
            input.section === "scripts" ? "not-observed" : "not-applicable",
          detail:
            input.section === "scripts"
              ? "Script source bytes were not included in this passive capture."
              : "This runtime entity has no standalone artifact bytes.",
        }
      : {
          available: true,
          artifact_id: `art_${input.artifactSha256}`,
          sha256: input.artifactSha256,
        },
  location: {
    available: true,
    value: {
      kind: "runtime",
      capture_sha256: capture.captureSha256,
      target_key: input.targetKey,
      frame_key: input.frameKey,
      script_key: input.scriptKey,
    },
  },
  extractor: {
    name: capture.evidence.provider.id,
    version:
      capture.evidence.provider.version ??
      (capture.kind === "browser" ? "2" : "1"),
    operation: capture.evidence.operation,
    executable_sha256: null,
  },
  coverage: runtimeSectionCoverage(capture, input.section),
  limitations: [
    "The entity was observed only within one bounded passive CDP capture.",
    ...(runtimeSectionComplete(capture, input.section)
      ? []
      : [
          `The runtime ${input.section} inventory was incomplete within this capture.`,
        ]),
  ],
  evidence_ids: [capture.evidence.evidence_id],
});

const runtimeEdges = (
  capture: ParsedRuntimeCapture,
  entities: readonly RuntimeReconciliationEntity[],
): ApplicationEdge[] => {
  const local = entities.filter(
    ({ capture: candidate }) =>
      candidate.evidence.evidence_id === capture.evidence.evidence_id,
  );
  const target = local.find(({ kind }) => kind === "target");
  if (target === undefined) return [];
  const frames = new Map(
    local
      .filter(({ kind }) => kind === "frame")
      .map((entity) => [entity.runtimeKey, entity]),
  );
  return local.flatMap((entity) => {
    if (entity === target) return [];
    const parent =
      (entity.kind === "script" || entity.kind === "worker") &&
      entity.frameKey !== null
        ? (frames.get(entity.frameKey) ?? target)
        : target;
    return [
      createJavaScriptApplicationEdge({
        source_node_id: parent.node.node_id,
        target_node_id: entity.node.node_id,
        relation: entity.kind === "script" ? "loads" : "contains",
        properties: { basis: "passive-cdp-observation" },
        evidence: runtimeRelationshipEvidence(capture, entity),
      }),
    ];
  });
};

const runtimeRelationshipEvidence = (
  capture: ParsedRuntimeCapture,
  entity: RuntimeReconciliationEntity,
): ApplicationGraphEvidence => ({
  authority: "passive-cdp-runtime",
  state: "observed",
  confidence: "exact",
  artifact: {
    available: false,
    reason: "not-applicable",
    detail: "The relationship is runtime metadata, not standalone bytes.",
  },
  location: {
    available: true,
    value: {
      kind: "runtime",
      capture_sha256: capture.captureSha256,
      target_key: capture.inspection.target.target_id,
      frame_key: entity.frameKey,
      script_key: entity.kind === "script" ? entity.runtimeKey : null,
    },
  },
  extractor: {
    name: capture.evidence.provider.id,
    version:
      capture.evidence.provider.version ??
      (capture.kind === "browser" ? "2" : "1"),
    operation: capture.evidence.operation,
    executable_sha256: null,
  },
  coverage: runtimeSectionCoverage(capture, entity.section),
  limitations: [
    "The relationship was observed only within one bounded passive CDP capture.",
  ],
  evidence_ids: [capture.evidence.evidence_id],
});

const runtimeSectionComplete = (
  capture: ParsedRuntimeCapture,
  section: RuntimeEntityInput["section"],
): boolean => {
  if (section === "target") return true;
  if (section === "scripts") return capture.scriptsCompleteWithinScope;
  return (
    !capture.inspection.completeness.truncated_sections.includes(section) &&
    !capture.inspection.completeness.unavailable_sections.includes(section)
  );
};

const runtimeSectionCoverage = (
  capture: ParsedRuntimeCapture,
  section: RuntimeEntityInput["section"],
): ApplicationGraphEvidence["coverage"] => {
  if (runtimeSectionComplete(capture, section))
    return {
      status: "complete",
      truncated: false,
      omitted_count: 0,
      limits: [],
    };
  const truncated =
    section !== "target" &&
    capture.inspection.completeness.truncated_sections.includes(section);
  return {
    status: "partial",
    truncated,
    omitted_count: null,
    limits: truncated
      ? [
          {
            name: `passive-cdp-${section}-limit`,
            value: runtimeSectionCount(capture, section),
            unit: "items",
          },
        ]
      : [],
  };
};

const runtimeSectionCount = (
  capture: ParsedRuntimeCapture,
  section: RuntimeEntityInput["section"],
): number => {
  switch (section) {
    case "target":
      return 1;
    case "frames":
      return capture.inspection.frames.length;
    case "scripts":
      return capture.inspection.scripts.items.length;
    case "workers":
      return capture.inspection.workers.length;
  }
};
