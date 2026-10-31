import { basename, dirname, isAbsolute, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { parseBinaryTarget } from "../../../dist/application/BinaryTargetResolver.js";
import { inspectManagedArtifactBytes } from "../../../dist/dotnet/ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "../../../dist/dotnet/ManagedMemberInspector.js";
import { projectManagedApplicationGraphEvidence } from "../../../dist/application/managed/ManagedApplicationGraphService.js";
import { traceApplicationFeatureEvidence } from "../../../dist/application/javascript/JavaScriptApplicationWorkflowService.js";
import { createEvidence } from "../../../dist/domain/evidence.js";
import { MANAGED_STATIC_PROVIDER } from "../../../dist/domain/investigationProviders.js";
import {
  ensure,
  methodTokenRow,
  parseManagedAppManifest,
} from "./manifest-parser.mjs";

export const createManagedManifestVerifier = (context) => ({
  verifyManagedAppManifest: (rawManifest, manifestPath) =>
    verifyManagedAppManifest(context, rawManifest, manifestPath),
});

async function verifyManagedAppManifest(context, rawManifest, manifestPath) {
  const { appManifestInspectionLimits } = context;
  const manifest = parseManagedAppManifest(rawManifest);
  const targetPath = isAbsolute(manifest.target.path)
    ? manifest.target.path
    : resolve(dirname(manifestPath), manifest.target.path);
  const parsedTarget = await parseBinaryTarget(targetPath);
  ensure(
    parsedTarget.ok,
    `target ${targetPath} could not be parsed as a binary target`,
  );
  const target = parsedTarget.value;
  ensure(
    target.sha256 === manifest.target.sha256,
    `target sha256 mismatch: expected ${manifest.target.sha256}, observed ${target.sha256}`,
  );
  const bytes = await readFile(targetPath);
  const artifact = inspectManagedArtifactBytes(
    bytes,
    target,
    appManifestInspectionLimits,
  );
  verifyManifestTarget(manifest, artifact);
  const methodVerification = verifyManifestMethods(
    context,
    manifest,
    bytes,
    target,
  );
  const { methods, inspectedMethods } = methodVerification;
  let assertions = 1 + methodVerification.assertions;
  const applicationGraph =
    manifest.application_graph === undefined
      ? undefined
      : verifyManagedAppManifestApplicationGraph({
          context,
          graphManifest: manifest.application_graph,
          bytes,
          target,
          artifact,
          manifestMethods: manifest.methods,
          inspectedMethods,
        });
  if (applicationGraph !== undefined) assertions += applicationGraph.assertions;
  return {
    label: manifest.label ?? null,
    assertions,
    target: {
      file_name: basename(targetPath),
      sha256: target.sha256,
      mvid: artifact.module?.mvid ?? null,
      assembly_name: artifact.assembly?.name ?? null,
      runtime_family: artifact.classification.runtime_family,
      managed_architecture: artifact.classification.managed_architecture,
    },
    methods,
    ...(applicationGraph === undefined
      ? {}
      : { application_graph: applicationGraph.summary }),
  };
}

function verifyManifestTarget(manifest, artifact) {
  ensure(
    artifact.classification.status === "managed",
    `target is ${artifact.classification.status}, expected managed`,
  );
  if (manifest.target.mvid !== undefined)
    ensure(
      artifact.module?.mvid === manifest.target.mvid,
      `target MVID mismatch: expected ${manifest.target.mvid}, observed ${artifact.module?.mvid ?? "null"}`,
    );
  if (manifest.target.assembly_name !== undefined)
    ensure(
      artifact.assembly?.name === manifest.target.assembly_name,
      `assembly name mismatch: expected ${manifest.target.assembly_name}, observed ${artifact.assembly?.name ?? "null"}`,
    );
  if (manifest.target.runtime_family !== undefined)
    ensure(
      artifact.classification.runtime_family === manifest.target.runtime_family,
      `runtime family mismatch: expected ${manifest.target.runtime_family}, observed ${artifact.classification.runtime_family}`,
    );
  if (manifest.target.managed_architecture !== undefined)
    ensure(
      artifact.classification.managed_architecture ===
        manifest.target.managed_architecture,
      `managed architecture mismatch: expected ${manifest.target.managed_architecture}, observed ${artifact.classification.managed_architecture}`,
    );
}

function verifyManifestMethods(context, manifest, bytes, target) {
  const methods = [];
  let assertions = 0;
  const inspectedMethods = new Map();
  for (const expectedMethod of manifest.methods) {
    const method = inspectManagedMethodByToken(
      context,
      bytes,
      target,
      expectedMethod,
    );
    ensure(
      method.signature.raw_sha256 === expectedMethod.signature_sha256,
      `method ${expectedMethod.token} signature sha256 mismatch: expected ${expectedMethod.signature_sha256}, observed ${method.signature.raw_sha256}`,
    );
    ensure(
      method.body.il_size === expectedMethod.il_size,
      `method ${expectedMethod.token} IL size mismatch: expected ${String(expectedMethod.il_size)}, observed ${String(method.body.il_size)}`,
    );
    if (expectedMethod.il_sha256 !== undefined)
      ensure(
        method.body.il_sha256 === expectedMethod.il_sha256,
        `method ${expectedMethod.token} IL sha256 mismatch: expected ${expectedMethod.il_sha256}, observed ${method.body.il_sha256 ?? "null"}`,
      );
    ensure(
      method.body.normalized_il_sha256 === expectedMethod.normalized_il_sha256,
      `method ${expectedMethod.token} normalized IL sha256 mismatch: expected ${expectedMethod.normalized_il_sha256}, observed ${method.body.normalized_il_sha256 ?? "null"}`,
    );
    assertions += expectedMethod.il_sha256 === undefined ? 4 : 5;
    inspectedMethods.set(expectedMethod.token, method);
    methods.push({
      label: expectedMethod.label ?? null,
      token: method.token,
      declaring_type: method.declaring_type,
      name: method.name,
      signature_sha256: method.signature.raw_sha256,
      il_size: method.body.il_size,
      il_sha256: method.body.il_sha256,
      normalized_il_sha256: method.body.normalized_il_sha256,
    });
  }
  return { methods, inspectedMethods, assertions };
}

function verifyManagedAppManifestApplicationGraph({
  context,
  graphManifest,
  bytes,
  target,
  artifact,
  manifestMethods,
  inspectedMethods,
}) {
  const graphByToken = new Map();
  const projectionState = {
    context,
    graphByToken,
    inspectedMethods,
    bytes,
    target,
    artifact,
  };
  const firstToken = manifestMethods[0]?.token;
  ensure(
    firstToken !== undefined,
    "application graph verification requires at least one manifest method",
  );
  const baseline = projectManifestMethod(projectionState, firstToken);
  let assertions = 1;
  for (const expectedKind of graphManifest.expected_node_kinds) {
    ensure(
      baseline.nodeKinds.includes(expectedKind),
      `application graph is missing expected node kind ${expectedKind}`,
    );
    assertions += 1;
  }

  const traces = [];
  for (const expectedTrace of graphManifest.feature_traces) {
    const projection = projectManifestMethod(
      projectionState,
      expectedTrace.method_token,
    );
    const traced = traceApplicationFeatureEvidence({
      application: projection.evidence,
      native_observations: [],
      seed: {
        kind: "string",
        value: expectedTrace.seed,
        match: expectedTrace.match,
        case_sensitive: expectedTrace.case_sensitive,
      },
      direction: "incoming",
    });
    ensure(
      traced.ok,
      `application graph trace failed for method ${expectedTrace.method_token}`,
    );
    const matched = traced.value.result.summary.matched_seeds;
    ensure(
      matched >= expectedTrace.min_matched_seeds,
      `application graph trace ${expectedTrace.seed} matched ${String(matched)} seeds, expected at least ${String(expectedTrace.min_matched_seeds)}`,
    );
    assertions += 1;
    traces.push({
      label: expectedTrace.label ?? null,
      method_token: expectedTrace.method_token,
      seed: expectedTrace.seed,
      matched_seeds: matched,
      trace_evidence_id: traced.value.evidence.evidence_id,
    });
  }

  return {
    assertions,
    summary: {
      projections: [...graphByToken.values()].map((projection) => ({
        method_token: projection.method.token,
        graph_evidence_id: projection.evidence.evidence_id,
        node_kinds: projection.nodeKinds,
        summary: projection.summary,
      })),
      expected_node_kinds: graphManifest.expected_node_kinds,
      feature_traces: traces,
    },
  };
}

const projectManifestMethod = (state, token) => {
  const { appManifestInspectionLimits, appManifestMemberLimits } =
    state.context;
  const existing = state.graphByToken.get(token);
  if (existing !== undefined) return existing;
  const method = state.inspectedMethods.get(token);
  ensure(
    method !== undefined,
    `application graph method ${token} must also be declared in manifest.methods`,
  );
  const members = inspectManagedMethodPageByToken(
    state.context,
    state.bytes,
    state.target,
    token,
  );
  const artifactEvidence = createEvidence(
    state.target,
    MANAGED_STATIC_PROVIDER,
    {
      operation: "inspect_managed_artifact",
      parameters: appManifestInspectionLimits,
      result: state.artifact,
      rawResult: null,
      limitations: state.artifact.limitations,
      locations: [{ kind: "artifact-path", path: state.target.path }],
    },
  );
  const memberEvidence = createEvidence(state.target, MANAGED_STATIC_PROVIDER, {
    operation: "inspect_managed_members",
    parameters: {
      ...appManifestMemberLimits,
      methodOffset: methodTokenRow(token) - 1,
    },
    result: members,
    rawResult: null,
    limitations: members.limitations,
    locations: [{ kind: "artifact-path", path: state.target.path }],
  });
  const projected = projectManagedApplicationGraphEvidence({
    managed_artifact: artifactEvidence,
    managed_members: memberEvidence,
  });
  ensure(
    projected.ok,
    `application graph projection failed for method ${token}`,
  );
  const projection = {
    method,
    evidence: projected.value,
    nodeKinds: [
      ...new Set(
        projected.value.normalized_result.graph.nodes.map(({ kind }) => kind),
      ),
    ].sort(),
    summary: projected.value.normalized_result.summary,
  };
  state.graphByToken.set(token, projection);
  return projection;
};

function inspectManagedMethodByToken(context, bytes, target, expectedMethod) {
  const members = inspectManagedMethodPageByToken(
    context,
    bytes,
    target,
    expectedMethod.token,
  );
  const method = members.methods.find(
    ({ token }) => token === expectedMethod.token,
  );
  ensure(
    method !== undefined,
    `method ${expectedMethod.token} was not returned by the member inspector`,
  );
  ensure(
    method.body.status === "present",
    `method ${expectedMethod.token} body status is ${method.body.status}, expected present`,
  );
  return method;
}

function inspectManagedMethodPageByToken(context, bytes, target, token) {
  const { appManifestMemberLimits } = context;
  const row = methodTokenRow(token);
  return inspectManagedMembersBytes(bytes, target, {
    ...appManifestMemberLimits,
    methodOffset: row - 1,
  });
}
