#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises";
import { parseArgs } from "node:util";

import { reconcileJavaScriptRuntimeEvidence } from "../../../dist/application/javascript/JavaScriptRuntimeReconciliationService.js";
import { analyzeJavaScriptApplicationWithOwnedScope } from "../../lib/javascript-application-analysis.mjs";
import {
  completeVerifierRun,
  createVerifierRun,
} from "../../lib/verifier-run.mjs";

const verifierRun = createVerifierRun();

const options = parseArgs({
  options: {
    application: { type: "string" },
    cache: { type: "string", multiple: true, default: [] },
    assets: { type: "string", multiple: true, default: [] },
    "runtime-evidence": { type: "string", multiple: true, default: [] },
    mapping: { type: "string", multiple: true, default: [] },
  },
  strict: true,
  allowPositionals: false,
}).values;

if (options.application === undefined)
  throw new Error("--application must name an operator-provided app/ASAR path");
if (options["runtime-evidence"].length === 0)
  throw new Error(
    "At least one --runtime-evidence path from inspect_web_page or inspect_electron_page is required",
  );

const requestedLayers = [
  { role: "application", path: options.application },
  ...options.cache.map((path) => ({ role: "cache", path })),
  ...options.assets.map((path) => ({ role: "assets", path })),
];
const staticLayers = [];
for (const layer of requestedLayers) {
  const analyzed = await analyzeJavaScriptApplicationWithOwnedScope({
    input_path: layer.path,
    format: "auto",
  });
  staticLayers.push({
    role: layer.role,
    analysis: analyzed,
    runtime_mappings: [],
  });
}
for (const encoded of options.mapping) {
  const mapping = parseMapping(encoded, staticLayers.length);
  staticLayers[mapping.layer].runtime_mappings.push(mapping.value);
}
const runtimeObservations = (
  await Promise.all(options["runtime-evidence"].map(readEvidenceFile))
).flat();
const reconciled = reconcileJavaScriptRuntimeEvidence({
  static_layers: staticLayers,
  runtime_observations: runtimeObservations,
});
if (!reconciled.ok) throw reconciled.error;
const result = reconciled.value.evidence.normalized_result;

process.stdout.write(
  `${JSON.stringify({
    verifier_run: await completeVerifierRun(verifierRun),
    reconciliation_id: result.reconciliation_id,
    evidence_id: reconciled.value.evidence.evidence_id,
    graph_id: result.graph.graph_id,
    layers: result.static_layers.map((layer) => ({
      role: layer.role,
      evidence_id: layer.evidence_id,
      graph_id: layer.graph_id,
      root_artifact_sha256: layer.root_artifact_sha256,
      input_path: layer.input_path,
    })),
    runtime_captures: result.runtime_captures.map((capture) => ({
      evidence_id: capture.evidence_id,
      capture_sha256: capture.capture_sha256,
      target_location: capture.target_location,
    })),
    summary: result.summary,
    coverage: result.coverage,
    unmatched_reasons: counted(
      result.reconciliations
        .filter(({ status }) => status !== "matched")
        .map(({ reason }) => reason),
    ),
    static_load_states: counted(
      result.static_load_states.map(({ status }) => status),
    ),
    verified: true,
  })}\n`,
);

async function readEvidenceFile(path) {
  const bytes = await readFile(await realpath(path));
  if (bytes.byteLength > 64 * 1024 * 1024)
    throw new Error(`Runtime Evidence exceeds 64 MiB: ${path}`);
  const value = JSON.parse(bytes.toString("utf8"));
  return Array.isArray(value) ? value : [value];
}

function parseMapping(encoded, layerCount) {
  const parsed = JSON.parse(encoded);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Number.isInteger(parsed.layer) ||
    parsed.layer < 0 ||
    parsed.layer >= layerCount ||
    (parsed.kind !== "file-root" && parsed.kind !== "url-prefix")
  )
    throw new Error(
      "--mapping must be JSON with a valid layer index and file-root or url-prefix kind",
    );
  const { layer, ...value } = parsed;
  return { layer, value };
}

function counted(values) {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [
        value,
        values.filter((candidate) => candidate === value).length,
      ]),
  );
}
