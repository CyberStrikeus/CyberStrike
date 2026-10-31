import { analysisViewRequestSchema } from "../../src/domain/analysisView/analysisView.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { inspectAnalysisViewValidated } from "../../src/application/analysisView/AnalysisViewService.js";
import {
  loadEnvironmentSource,
  type EnvironmentSource,
} from "../../src/application/environment/environmentSource.js";
import {
  loadEnvironmentState,
  prepareServedState,
  type EnvironmentState,
  type PreparedState,
} from "../../src/application/environment/environmentState.js";
import type { Evidence } from "../../src/domain/evidence.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  environmentStateCaptureFixture,
} from "./analysisView.js";

/** Every opt-in rule, so the fixture yields `uid` and `plugin_id` parameters. */
export const ALL_TEMPLATE_RULES = [
  "after-uid-literal",
  "opaque-token",
  "sibling-variance",
] as const;

/** Manifest Evidence and the capture Evidence it was projected from. */
export interface EnvironmentServeFixture {
  readonly manifest: Evidence;
  readonly capture: Evidence;
}

/** Project the Grafana-shaped capture through the real view service. */
export const environmentServeFixture = (
  templateRules: readonly (typeof ALL_TEMPLATE_RULES)[number][] = ALL_TEMPLATE_RULES,
): EnvironmentServeFixture => {
  const capture = analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(),
  );
  const manifest = inspectAnalysisViewValidated({
    source: { kind: "inline", evidence: capture },
    view: analysisViewRequestSchema.parse({
      kind: "environment-manifest",
      template_rules: [...templateRules],
    }),
  });
  if (!manifest.ok) throw manifest.error;
  return { manifest: manifest.value, capture };
};

/** The fixture pair authenticated and cross-checked as the serve command loads it. */
export const environmentServeSource = (
  fixture: EnvironmentServeFixture = environmentServeFixture(),
): EnvironmentSource => {
  const source = loadEnvironmentSource(fixture.manifest, fixture.capture);
  if (!source.ok) throw source.error;
  return source.value;
};

/** The fixture source and the state its server prepares at startup, as serving and export prepare it. */
export const environmentServeServed = (
  fixture: EnvironmentServeFixture = environmentServeFixture(),
): { readonly source: EnvironmentSource; readonly served: PreparedState } => {
  const source = environmentServeSource(fixture);
  return { source, served: prepareServedState(source, fixture.capture) };
};

/** Paths of the two Evidence files the serve command reads. */
export interface EnvironmentServeFiles {
  readonly manifestPath: string;
  readonly capturePath: string;
}

/** Write the fixture pair into a caller-owned temporary directory. */
export const writeEnvironmentServeFiles = async (
  root: string,
  fixture: EnvironmentServeFixture = environmentServeFixture(),
): Promise<EnvironmentServeFiles> => {
  const manifestPath = join(root, "manifest.json");
  const capturePath = join(root, "capture.json");
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(fixture.manifest)),
    writeFile(capturePath, JSON.stringify(fixture.capture)),
  ]);
  return { manifestPath, capturePath };
};

/** A source whose only exchange carries the given body and content type. */
export const environmentServeSourceWithBody = (
  bodyText: string | null,
  contentType: string | null,
): EnvironmentSource => {
  const source = environmentServeSource();
  const users = source.manifest.tools.find(
    (tool) => tool.name === "get_users_by_id",
  );
  if (users === undefined) throw new Error("Missing users fixture");
  const ordinal = users.record_ordinals[0] ?? 0;
  const exchange = {
    ordinal,
    path: "/api/users/2",
    query: null,
    status: 200,
    contentType,
    bodyText,
  };
  return { ...source, exchanges: new Map([[ordinal, exchange]]) };
};

/** Manifest, capture and environment-state Evidence projected from one capture with the same rules. */
export interface EnvironmentStateServeFixture extends EnvironmentServeFixture {
  readonly state: Evidence;
}

/** Project a capture's manifest and state through the real view service; defaults to the timed Grafana-shaped capture. */
export const environmentStateServeFixture = (
  capture: Evidence = analysisViewCaptureEvidence(
    environmentStateCaptureFixture(),
  ),
): EnvironmentStateServeFixture => {
  const project = (kind: "environment-manifest" | "environment-state") => {
    const projected = inspectAnalysisViewValidated({
      source: { kind: "inline", evidence: capture },
      view: analysisViewRequestSchema.parse({
        kind,
        template_rules: [...ALL_TEMPLATE_RULES],
      }),
    });
    if (!projected.ok) throw projected.error;
    return projected.value;
  };
  return {
    manifest: project("environment-manifest"),
    capture,
    state: project("environment-state"),
  };
};

/** The served source and the state Evidence loaded for it, as derivation checks it. */
export const environmentStateServeInputs = (
  fixture: EnvironmentStateServeFixture = environmentStateServeFixture(),
): { readonly source: EnvironmentSource; readonly state: EnvironmentState } => {
  const source = environmentServeSource(fixture);
  const state = loadEnvironmentState(fixture.state, source);
  if (!state.ok) throw state.error;
  return { source, state: state.value };
};
