import type { JsonValue } from "../../src/domain/jsonValue.js";
import {
  apiSurfaceHar,
  environmentManifestHar,
  environmentStateHar,
} from "./historicalHar.js";
import { webNetworkCaptureSchema } from "../../src/domain/webNetworkCapture.js";
import {
  BINARY_LAYOUT_TEST_PROVIDER,
  binaryLayoutFixture,
} from "./binaryDiagnostics/layout.js";
import { JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE } from "../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import { createEvidence, type Evidence } from "../../src/domain/evidence.js";
import type { JavaScriptApplicationAnalysisResult } from "../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javascriptApplicationAnalysisResultSchema } from "../../src/domain/javascript/javascriptApplicationAnalysis.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../../src/domain/javascript/javascriptApplicationGraph.js";
import { createJavaScriptSemanticGraph } from "../../src/domain/javascript/javascriptSemanticGraph.js";
import type { BinaryLayout } from "../../src/domain/native/binaryLayout.js";
import { binaryLayoutSchema } from "../../src/domain/native/binaryLayout.js";
import { ghidraFunctionDossier } from "../../src/domain/ghidraValues.fixture.js";
import { functionDossierSchema } from "../../src/domain/native/functionDossier.js";
import type { RelationshipCoverage } from "../../src/domain/relationshipCoverage.js";

/** Canonical portable Evidence; no native provider is started by this fixture. */
export const analysisViewNativeEvidence = (
  relationshipCoverage?: RelationshipCoverage,
): Evidence =>
  createEvidence(
    { path: "/fixtures/native.exe", format: "pe", sha256: "a".repeat(64) },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "analyze_function",
      parameters: { address: "0x401000" },
      result: {
        ...functionDossierSchema.parse(ghidraFunctionDossier()),
        limitations: ["Fixture dossier caveat"],
      },
      ...(relationshipCoverage === undefined ? {} : { relationshipCoverage }),
    },
  );

const hex = (value: number): string =>
  value === 0 ? "0x0" : `0x${value.toString(16)}`;

const layoutName = (display: string, offset: number) => ({
  display,
  bytes_base64: Buffer.from(display, "utf8").toString("base64"),
  location: { offset: hex(offset), bytes: hex(display.length + 1) },
  unknown_reason: null,
});

const layoutSection = (
  index: number,
  display: string,
  nameOffset: number,
): BinaryLayout["sections"][number] => ({
  index,
  name: layoutName(display, nameOffset),
  name_offset: hex(nameOffset),
  type: 1,
  header_location: { offset: hex(index * 16), bytes: "0x10" },
  address: "0x0",
  offset: hex(64 + index * 16),
  size: "0x10",
  alignment: "0x1",
  flags: "0x6",
  link: 0,
  info: 0,
  entry_size: "0x0",
  file_backing: "file",
});

const layoutSymbol = (
  entryIndex: number,
  display: string,
  nameOffset: number,
): BinaryLayout["symbols"][number] => ({
  table_index: 0,
  entry_index: entryIndex,
  name: layoutName(display, nameOffset),
  name_offset: hex(nameOffset),
  location: { offset: hex(nameOffset), bytes: hex(display.length + 1) },
  value: "0x0",
  value_meaning: "no-address",
  size: "0x0",
  binding: 1,
  type: 2,
  visibility: 0,
  section_index: 1,
});

/** Layout fixture with duplicate section/symbol names for selected-view tests. */
export const analysisViewLayoutFixture = (): BinaryLayout =>
  binaryLayoutSchema.parse({
    ...binaryLayoutFixture("/artifacts/view-source.elf"),
    artifact: {
      path: "/artifacts/view-source.elf",
      sha256: "b".repeat(64),
      bytes: 512,
    },
    sections: [
      layoutSection(0, ".text", 256),
      layoutSection(1, ".text", 262),
      layoutSection(2, ".data", 268),
    ],
    symbols: [
      layoutSymbol(0, "main", 280),
      layoutSymbol(1, "main", 285),
      layoutSymbol(2, "start", 290),
    ],
  });

/** Wrap a layout observation as inspect_binary_layout Evidence. */
export const analysisViewLayoutEvidence = (
  layout: BinaryLayout = analysisViewLayoutFixture(),
): Evidence =>
  createEvidence(
    {
      path: layout.artifact.path,
      format: "elf",
      architecture: "x86_64",
      sha256: layout.artifact.sha256,
    },
    BINARY_LAYOUT_TEST_PROVIDER,
    {
      operation: "inspect_binary_layout",
      parameters: { path: layout.artifact.path },
      result: layout,
      rawResult: null,
      confidence: "observed",
      limitations: layout.limitations,
      locations: [{ kind: "artifact-path", path: layout.artifact.path }],
    },
  );

/** Minimal authenticated JavaScript application analysis used by view tests. */
export const analysisViewJavaScriptAnalysis =
  (): JavaScriptApplicationAnalysisResult =>
    javascriptApplicationAnalysisResultSchema.parse(
      JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.normalized_result,
    );

/** Application analysis whose module observations include source text. */
export const analysisViewJavaScriptAnalysisWithSource =
  (): JavaScriptApplicationAnalysisResult => {
    const analysis = analysisViewJavaScriptAnalysis();
    const original = analysis.graph.nodes[0];
    if (original === undefined)
      throw new Error("JavaScript application example is missing its module");
    const withSource = createJavaScriptApplicationNode({
      kind: original.kind,
      identity: original.identity,
      observations: original.observations.map((observation) => ({
        label: observation.label,
        properties: {
          ...observation.properties,
          source: "export const secret = 1;\n",
          text: "should not leak",
        },
        evidence: observation.evidence,
      })),
    });
    const graph = createJavaScriptApplicationGraph({
      schema: "JavaScriptApplicationGraph",
      root_node_ids: [withSource.node_id],
      nodes: [withSource],
      edges: [],
      coverage: analysis.graph.coverage,
      limitations: analysis.graph.limitations,
    });
    const { graph_id: _graphId, ...semantic } = analysis.semantic_graph;
    return javascriptApplicationAnalysisResultSchema.parse({
      ...analysis,
      graph,
      semantic_graph: createJavaScriptSemanticGraph({
        ...semantic,
        application_graph_id: graph.graph_id,
      }),
    });
  };

/** Rebind a companion semantic graph after replacing the application graph. */
export const analysisViewBindJavaScriptGraphs = (
  analysis: JavaScriptApplicationAnalysisResult,
  graph: ReturnType<typeof createJavaScriptApplicationGraph>,
): JavaScriptApplicationAnalysisResult => {
  const { graph_id: _graphId, ...semantic } = analysis.semantic_graph;
  return javascriptApplicationAnalysisResultSchema.parse({
    ...analysis,
    graph,
    semantic_graph: createJavaScriptSemanticGraph({
      ...semantic,
      application_graph_id: graph.graph_id,
    }),
  });
};

/** Wrap JavaScript application analysis as producer Evidence. */
export const analysisViewJavaScriptEvidence = (
  analysis: JavaScriptApplicationAnalysisResult = analysisViewJavaScriptAnalysis(),
): Evidence =>
  createEvidence(
    {
      path: analysis.input_path,
      format: analysis.format,
      sha256: analysis.root_artifact_sha256,
    },
    {
      id: "rea-javascript-application",
      name: "REA JavaScript application analyzer",
      version: "1",
    },
    {
      predicateType: "rea.javascript-application-analysis",
      operation: "analyze_javascript_application",
      parameters: { input_path: analysis.input_path, format: analysis.format },
      result: analysis,
      confidence: "derived",
      authority: "shipped-artifact",
      limitations: analysis.limitations,
    },
  );

/** Capture parent with explicit producer ordinals, including excluded URL values. */
export const analysisViewCaptureFixture = () =>
  webNetworkCaptureSchema.parse({
    artifact: {
      path: "/fixtures/surface.har",
      sha256: "c".repeat(64),
      bytes: 1024,
    },
    format: "har",
    decoder: { id: "fixture", name: "fixture", version: "1" },
    container: {
      reported: {},
      numeric_literals: [],
      redactions: [],
      records_pointer: "/log/entries",
    },
    total_records: 15,
    records: [
      ...apiSurfaceHar().log.entries,
      { request: { method: "GET", url: null } },
      { request: { method: "GET", url: "invalid URL" } },
    ].map((reported, ordinal) => ({
      ordinal,
      location: { kind: "json-pointer", pointer: `/log/entries/${ordinal}` },
      reported,
      binary_fields: [],
      numeric_literals: [],
      redactions: [],
      limitations: [],
    })),
    runtime_attribution: "unknown",
    limitations: [],
  });

export const analysisViewCaptureEvidence = (
  capture = analysisViewCaptureFixture(),
): Evidence =>
  createEvidence(
    capture.artifact.sha256 === null
      ? undefined
      : {
          path: capture.artifact.path,
          sha256: capture.artifact.sha256,
          format: "file",
        },
    { id: "fixture", name: "fixture", version: "1" },
    {
      operation: "inspect_web_network_capture",
      parameters: { sensitive_value_count: 0 },
      result: capture,
      confidence: "observed",
    },
  );

/** A small encoded capture whose many short objects expand during validation. */
export const analysisViewObjectDenseCapture = (headerCount = 100_000) => {
  const capture = analysisViewCaptureFixture();
  capture.records = capture.records.slice(0, 1);
  capture.total_records = 1;
  capture.records[0]!.reported = {
    request: {
      method: "GET",
      url: "https://api.test/items/1",
      headers: Array.from({ length: headerCount }, () => ({
        name: "x",
        value: "y",
      })),
    },
  };
  return capture;
};

/** Capture parent decoded from the Grafana-shaped HAR with producer ordinals intact. */
export const environmentManifestCaptureFixture = (
  entries: readonly JsonValue[] = environmentManifestHar().log.entries,
) => {
  const capture = analysisViewCaptureFixture();
  capture.artifact.path = "/fixtures/environment-manifest.har";
  capture.total_records = entries.length;
  capture.records = entries.map((reported, ordinal) => ({
    ...capture.records[0]!,
    ordinal,
    location: { kind: "json-pointer", pointer: `/log/entries/${ordinal}` },
    reported,
  }));
  return capture;
};

/** The same capture with distinct start times, as the environment-state view orders it. */
export const environmentStateCaptureFixture = () =>
  environmentManifestCaptureFixture(environmentStateHar().log.entries);

/** One synthetic exchange: method, path, JSON response body (a string is recorded as written), status, JSON request body and duration in milliseconds. */
export type TimedCaptureRow = readonly [
  method: string,
  path: string,
  body?: JsonValue,
  status?: number,
  request?: JsonValue | undefined,
  time?: number,
];

/** Capture Evidence of HAR entries one second apart on one origin, as the environment-state view orders them. */
export const timedCaptureEvidence = (
  rows: readonly TimedCaptureRow[],
): Evidence =>
  analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(
      rows.map(
        ([method, path, body = null, status = 200, sent, time = 5], index) => ({
          startedDateTime: new Date(
            Date.parse("2026-10-17T18:00:00.000Z") + index * 1000,
          ).toISOString(),
          time,
          request: {
            method,
            url: `http://app.example${path}`,
            bodySize:
              sent === undefined ? 0 : Buffer.byteLength(JSON.stringify(sent)),
            ...(sent === undefined
              ? {}
              : {
                  postData: {
                    mimeType: "application/json",
                    text: JSON.stringify(sent),
                  },
                }),
          },
          response: {
            status,
            content: {
              mimeType: "application/json",
              text: typeof body === "string" ? body : JSON.stringify(body),
            },
          },
        }),
      ),
    ),
  );
