import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { createAnalysisExecutionEvidence } from "../../../src/domain/analysisObservation.js";
import {
  wasmArtifactFixture,
  wasmArtifactExecution,
} from "../../fixtures/wasm/artifact.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import type { ToolContract } from "../../../src/contracts/toolContractTypes.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { SUPPORTED_GHIDRA_VERSION } from "../../../src/ghidra/GhidraReleasePolicy.js";
import {
  createEvidenceBundle,
  type EvidenceBundle,
} from "../../../src/domain/evidenceBundle.js";
import { expect, it } from "vitest";

interface VerifierResults {
  readonly requireMcpOperationResult: (
    result: unknown,
    operation: string,
  ) => unknown;
  readonly requireMcpOutput: (
    result: unknown,
    operation: string,
    contract?: ToolContract,
  ) => unknown;
  readonly requireMcpToolError: (result: unknown) => unknown;
  readonly requireMcpEvidenceBundle: (result: unknown) => EvidenceBundle;
  readonly requireMcpLifecycleResult: (
    result: unknown,
    operation: string,
  ) => unknown;
  readonly expandMcpSessionStatus: (status: unknown) => {
    readonly analysis_provider_candidates: unknown;
  };
  readonly expandProviderOutput: (providers: unknown) => {
    readonly analysis_provider_candidates: unknown;
  };
}

// The verifier helper imports the compiled contracts, so this runs after build.
const verifierResults = (): Promise<VerifierResults> =>
  import(
    new URL("../../../scripts/lib/mcp-verifier-results.mjs", import.meta.url)
      .href
  ) as Promise<VerifierResults>;

const provider = { id: "alpha", name: "alpha provider", version: null };
const summaryCandidate = {
  provider,
  availability: { status: "available", code: null, reason: null },
  target_support: { status: "unknown", code: null, reason: "No target." },
  selected: false,
};
const emptyTools = {
  client_requirements: {
    required: [],
    optional: [],
    missing_required: [],
    missing_optional: [],
  },
  groups: [],
};

it("keeps summary candidates only for MCP summary status", async () => {
  const { expandMcpSessionStatus } = await verifierResults();
  expect(
    expandMcpSessionStatus({
      detail: "summary",
      capabilities: [],
      analysis_provider_candidates: [summaryCandidate],
      tool_availability: emptyTools,
    }).analysis_provider_candidates,
  ).toEqual([summaryCandidate]);
  expect(() =>
    expandMcpSessionStatus({
      detail: "complete",
      capabilities: [],
      analysis_provider_candidates: [summaryCandidate],
      tool_availability: emptyTools,
    }),
  ).toThrow();
});

it("requires candidate capabilities in CLI provider output", async () => {
  const { expandProviderOutput } = await verifierResults();
  expect(() =>
    expandProviderOutput({
      capabilities: [],
      analysis_provider_candidates: [summaryCandidate],
    }),
  ).toThrow();
  expect(
    expandProviderOutput({
      capabilities: [],
      analysis_provider_candidates: [{ ...summaryCandidate, capabilities: [] }],
    }).analysis_provider_candidates,
  ).toEqual([{ ...summaryCandidate, capabilities: [] }]);
});

const retainedBundle = (value = 7) =>
  createEvidenceBundle([
    createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: {},
        result: { value },
      },
    ),
  ]);
const bundleReply = (bundle: unknown) => ({
  content: [{ type: "text", text: JSON.stringify({ result: bundle }) }],
  structuredContent: { result: bundle },
});

it("authenticates complete retained bundles and preserves the text-only transport option", async () => {
  const { requireMcpEvidenceBundle } = await verifierResults();
  const bundle = retainedBundle();
  expect(requireMcpEvidenceBundle(bundleReply(bundle))).toEqual(bundle);
  const { structuredContent: _structured, ...textOnly } = bundleReply(bundle);
  expect(requireMcpEvidenceBundle(textOnly)).toEqual(bundle);
});

it("rejects duplicate retained record IDs instead of selecting the first matching record", async () => {
  const { requireMcpEvidenceBundle, requireMcpLifecycleResult } =
    await verifierResults();
  const bundle = retainedBundle();
  const duplicate = {
    ...bundle,
    records: [...bundle.records, ...bundle.records],
  };
  // The named wire contract admits this shape; authentication must reject it.
  expect(
    requireMcpLifecycleResult(bundleReply(duplicate), "get_evidence_bundle"),
  ).toEqual(duplicate);
  expect(() => requireMcpEvidenceBundle(bundleReply(duplicate))).toThrow(
    "duplicate record IDs",
  );
});

it("rejects shape-valid retained Evidence whose semantic identifier was tampered", async () => {
  const { requireMcpEvidenceBundle, requireMcpLifecycleResult } =
    await verifierResults();
  const bundle = retainedBundle();
  const tampered = {
    ...bundle,
    records: bundle.records.map((record) => ({
      ...record,
      normalized_result: { value: 8 },
    })),
  };
  expect(
    requireMcpLifecycleResult(bundleReply(tampered), "get_evidence_bundle"),
  ).toEqual(tampered);
  expect(() => requireMcpEvidenceBundle(bundleReply(tampered))).toThrow(
    /semantic identifier/u,
  );
});

it("rejects noncanonical manifests even when a selected retained record is authentic", async () => {
  const { requireMcpEvidenceBundle, requireMcpLifecycleResult } =
    await verifierResults();
  const broken = { ...retainedBundle(), providers: [] };
  expect(
    requireMcpLifecycleResult(bundleReply(broken), "get_evidence_bundle"),
  ).toEqual(broken);
  expect(() => requireMcpEvidenceBundle(bundleReply(broken))).toThrow(
    /not canonical/u,
  );
});

it("rejects differing named text/structured bundle representations", async () => {
  const { requireMcpEvidenceBundle } = await verifierResults();
  const text = retainedBundle();
  const structured = retainedBundle(8);
  expect(() =>
    requireMcpEvidenceBundle({
      ...bundleReply(text),
      structuredContent: { result: structured },
    }),
  ).toThrow("text and structured results disagree");
});

it("retains summary discovery in the generic lifecycle reader but refuses it as complete Evidence", async () => {
  const { requireMcpEvidenceBundle, requireMcpLifecycleResult } =
    await verifierResults();
  const summary = {
    kind: "evidence-bundle-summary",
    filters: {},
    total_retained_records: 0,
    matching_records: 0,
    unknown_revisions: 0,
    records: [],
  };
  expect(
    requireMcpLifecycleResult(bundleReply(summary), "get_evidence_bundle"),
  ).toEqual(summary);
  expect(() => requireMcpEvidenceBundle(bundleReply(summary))).toThrow(
    "summary metadata instead of complete Evidence",
  );
});

const namedEvidence = () =>
  createEvidence(
    {
      path: "/fixture/image.bin",
      sha256: "a".repeat(64),
      format: "elf",
      architecture: "x86_64",
    },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "address_name",
      parameters: { address: "0x1000" },
      result: "entry",
      rawResult: { engine_name: "entry", source: "symbol table" },
    },
  );
const ghidraEvidence = () => {
  const provider = {
    id: "ghidra",
    name: "Ghidra",
    version: SUPPORTED_GHIDRA_VERSION,
  };
  return createEvidence(
    {
      path: "/fixture/ghidra-image.elf",
      sha256: "b".repeat(64),
      format: "elf",
      architecture: "x86_64",
    },
    provider,
    {
      operation: "address_name",
      parameters: { address: "0x401000" },
      result: "entry",
      rawResult: {
        address: "00401000",
        symbol: "entry",
        source: "Ghidra symbol table",
      },
      analysisProfile: createAnalysisProfile(provider, {
        loader: "ElfLoader",
        language_id: "x86:LE:64:default",
        compiler_spec_id: "gcc",
      }),
    },
  );
};
const textReply = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

it("returns complete named Evidence with its subject, provider and analysis provenance", async () => {
  const { requireMcpOutput } = await verifierResults();
  const evidence = namedEvidence();
  expect(requireMcpOutput(textReply(evidence), "address_name")).toEqual(
    evidence,
  );
});

it("admits matching complete text and structured Evidence and rejects either malformed shape", async () => {
  const { requireMcpOutput } = await verifierResults();
  const evidence = namedEvidence();
  expect(
    requireMcpOutput(
      { ...textReply(evidence), structuredContent: evidence },
      "address_name",
    ),
  ).toEqual(evidence);
  const malformed = { ...evidence, normalized_result: { name: "entry" } };
  for (const [text, structuredContent] of [
    [evidence, malformed],
    [malformed, evidence],
  ])
    expect(() =>
      requireMcpOutput(
        { ...textReply(text), structuredContent },
        "address_name",
      ),
    ).toThrow();
});

it.each([false, true])(
  "keeps Ghidra contract admission separate from Evidence authentication (structured=%s)",
  async (structured) => {
    const { requireMcpOutput } = await verifierResults();
    const evidence = ghidraEvidence();
    const reply = (value: unknown) => ({
      ...textReply(value),
      ...(structured ? { structuredContent: value } : {}),
    });
    const admitted = requireMcpOutput(reply(evidence), "address_name");
    expect(admitted).toEqual(evidence);
    const authenticated = parseEvidence(admitted);
    expect(authenticated).toEqual(evidence);
    expect(authenticated.analysis_profile?.provider).toEqual(evidence.provider);
    expect(authenticated.subject).toEqual(evidence.subject);
    const tampered = { ...evidence, normalized_result: "different_entry" };
    const shapeValid = requireMcpOutput(reply(tampered), "address_name");
    expect(shapeValid).toEqual(tampered);
    expect(() => parseEvidence(shapeValid)).toThrow(/semantic identifier/u);
  },
);

it("rejects malformed and disagreeing replies at the Ghidra address-context verifier call boundary", async () => {
  const source = await readFile(
    new URL(
      "../../../scripts/verify-real-ghidra-address-context.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const declaration = parse(source, { sourceType: "module" }).program.body.find(
    (node) => node.type === "FunctionDeclaration" && node.id?.name === "call",
  );
  if (declaration?.start == null || declaration.end == null)
    throw new Error("Ghidra verifier call boundary missing");
  const evidence = ghidraEvidence();
  let response: unknown;
  // Execute the script's actual call boundary without launching its compiler or provider.
  const call = runInNewContext(
    `(${source.slice(declaration.start, declaration.end)})`,
    {
      assert,
      client: { callTool: async () => response },
      ...(await verifierResults()),
    },
  ) as (name: string) => Promise<unknown>;
  response = { ...textReply(evidence), structuredContent: evidence };
  await expect(call("address_name")).resolves.toEqual(evidence);
  const malformed = { ...evidence, normalized_result: { name: "entry" } };
  response = { ...textReply(malformed), structuredContent: malformed };
  await expect(call("address_name")).rejects.toThrow();
  response = {
    ...textReply(evidence),
    structuredContent: { ...evidence, normalized_result: "different_entry" },
  };
  await expect(call("address_name")).rejects.toThrow(
    "text and structured results disagree",
  );
});

it("rejects disagreement in lifecycle envelope fields that the named schema would otherwise discard", async () => {
  const { requireMcpOutput } = await verifierResults();
  const result = retainedBundle();
  const text = { result, vendor_note: "text observation" };
  const structuredContent = { result, vendor_note: "different observation" };
  const contract = toolContract("get_evidence_bundle");
  expect(contract.outputSchema.parse(text)).toEqual(
    contract.outputSchema.parse(structuredContent),
  );
  expect(() =>
    requireMcpOutput(
      { ...textReply(text), structuredContent },
      "get_evidence_bundle",
    ),
  ).toThrow("text and structured results disagree");
});

it("rejects disagreement in complete Evidence provenance before downstream extraction", async () => {
  const { requireMcpOutput } = await verifierResults();
  const evidence = ghidraEvidence();
  expect(() =>
    requireMcpOutput(
      {
        ...textReply(evidence),
        structuredContent: {
          ...evidence,
          raw_result: { engine_name: "different" },
        },
      },
      "address_name",
    ),
  ).toThrow("text and structured results disagree");
});

it("rejects mismatched named contracts, error-marked success and malformed normalized results", async () => {
  const { requireMcpOutput } = await verifierResults();
  const evidence = namedEvidence();
  expect(() =>
    requireMcpOutput(
      textReply(evidence),
      "address_name",
      toolContract("set_address_name"),
    ),
  ).toThrow("received the set_address_name contract");
  expect(() =>
    requireMcpOutput({ ...textReply(evidence), isError: true }, "address_name"),
  ).toThrow("address_name failed");
  expect(() =>
    requireMcpOutput(
      textReply({ ...evidence, normalized_result: { name: "entry" } }),
      "address_name",
    ),
  ).toThrow();
});

it("requires canonical complete tool errors before inspecting their diagnostic fields", async () => {
  const { requireMcpToolError } = await verifierResults();
  const error = {
    code: "invalid_request",
    category: "invalid_input",
    message: "The address is invalid",
    retryable: false,
    remediation: { action: "Choose an observed address" },
    details: { operation: "address_name", address: "bad" },
  };
  expect(
    requireMcpToolError({ ...textReply({ error }), isError: true }),
  ).toEqual(error);
  for (const value of [
    { error: { category: "invalid_input" } },
    error,
    { error: { ...error, retryable: "false" } },
    { error: { ...error, code: "vendor_failure" } },
  ])
    expect(() =>
      requireMcpToolError({ ...textReply(value), isError: true }),
    ).toThrow();
  expect(() => requireMcpToolError(textReply({ error }))).toThrow(
    "Expected an MCP tool failure",
  );
});

it.each(["transport disagreement", "malformed normalized result"])(
  "admits complete Wasm Evidence at the interface verifier boundary: %s",
  async (scenario) => {
    const source = await readFile(
      new URL(
        "../../../scripts/verify-wasm-interface-comparison.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const declaration = parse(source, { sourceType: "module" })
      .program.body.filter((node) => node.type === "VariableDeclaration")
      .flatMap((node) => node.declarations)
      .find(
        (node) => node.id.type === "Identifier" && node.id.name === "inspect",
      )?.init;
    if (declaration?.start == null || declaration.end == null)
      throw new Error("Wasm interface verifier inspect boundary missing");
    const report = wasmArtifactFixture();
    const execution = wasmArtifactExecution(report);
    const evidence = createAnalysisExecutionEvidence(
      "inspect_wasm_artifact",
      { path: report.artifact.path },
      execution,
      "observed",
    );
    let response: unknown;
    const inspect = runInNewContext(
      `(${source.slice(declaration.start, declaration.end)})`,
      {
        assert,
        client: { callTool: async () => response },
        parseEvidence,
        ...(await verifierResults()),
      },
    ) as (path: string) => Promise<unknown>;
    response = { ...textReply(evidence), structuredContent: evidence };
    await expect(inspect(report.artifact.path)).resolves.toEqual(evidence);

    if (scenario === "transport disagreement") {
      const different = wasmArtifactFixture();
      different.limitations = ["Independent complete Wasm observation."];
      const structured = createAnalysisExecutionEvidence(
        "inspect_wasm_artifact",
        { path: different.artifact.path },
        wasmArtifactExecution(different),
        "observed",
      );
      expect(
        parseEvidence(
          toolContract("inspect_wasm_artifact").outputSchema.parse(structured),
        ),
      ).toEqual(structured);
      response = { ...textReply(evidence), structuredContent: structured };
      await expect(inspect(report.artifact.path)).rejects.toThrow(
        "text and structured results disagree",
      );
    } else {
      const malformed = createEvidence(
        execution.subject ?? undefined,
        execution.provider,
        {
          operation: "inspect_wasm_artifact",
          parameters: { path: report.artifact.path },
          result: "authentic Evidence with an invalid Wasm result shape",
        },
      );
      expect(parseEvidence(malformed)).toEqual(malformed);
      response = { ...textReply(malformed), structuredContent: malformed };
      await expect(inspect(report.artifact.path)).rejects.toThrow();
    }
    response = textReply(evidence);
    await expect(inspect(report.artifact.path)).rejects.toThrow();
  },
);

it("preserves raw extraction manifest extensions for separate Evidence authentication", async () => {
  const { requireMcpOutput } = await verifierResults();
  const inventoryEvidence = ARTIFACT_COMPARISON_EXAMPLE.left;
  const inventory = artifactInventoryResultSchema.parse(
    inventoryEvidence.normalized_result,
  );
  const extractionSemantic = {
    source_manifest_id: inventory.manifest.manifest_id,
    selected_occurrence_ids: [],
    files_sha256: digestCanonicalValue([], "Artifact"),
    output_root_alias: "$OUTPUT_ROOT",
  };
  const report = {
    manifest: inventory.manifest,
    extraction_manifest: {
      extraction_id: `aex_${digestCanonicalValue(extractionSemantic, "Artifact")}`,
      ...extractionSemantic,
    },
    output_root: "/owned/output",
    artifacts: [],
    containment_verified: true,
    cleanup: { attempted: true, verified: true, residual_paths: [] },
    coverage: inventory.coverage,
    provenance: inventory.provenance,
    integrity_contradictions: inventory.integrity_contradictions,
    limitations: [],
  };
  const evidenceFor = (result: unknown) =>
    createEvidence(undefined, inventoryEvidence.provider, {
      operation: "extract_artifact",
      parameters: {},
      result,
    });
  const evidence = evidenceFor(report);
  const extendedResult = {
    ...report,
    manifest: { ...report.manifest, vendor_note: "retained source extension" },
  };
  const tampered = { ...evidence, normalized_result: extendedResult };
  const reply = (value: unknown) => ({
    ...textReply(value),
    structuredContent: value,
  });
  // Shape projection discards the extension; it cannot authenticate its source ID.
  expect(toolContract("extract_artifact").outputSchema.parse(tampered)).toEqual(
    evidence,
  );
  const admittedTampered = requireMcpOutput(
    reply(tampered),
    "extract_artifact",
  );
  expect(admittedTampered).toEqual(tampered);
  expect(() => parseEvidence(admittedTampered)).toThrow(/semantic identifier/u);

  const authentic = evidenceFor(extendedResult);
  const projected =
    toolContract("extract_artifact").outputSchema.parse(authentic);
  expect(projected).toEqual({ ...authentic, normalized_result: report });
  const admittedAuthentic = requireMcpOutput(
    reply(authentic),
    "extract_artifact",
  );
  expect(admittedAuthentic).toEqual(authentic);
  expect(parseEvidence(admittedAuthentic)).toEqual(authentic);
});
