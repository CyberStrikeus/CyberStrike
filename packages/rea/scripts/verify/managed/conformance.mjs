import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

import { inspectManagedArtifactBytes } from "../../../dist/dotnet/ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "../../../dist/dotnet/ManagedMemberInspector.js";
import { inspectManagedNativeBoundariesBytes } from "../../../dist/dotnet/ManagedNativeBoundaryInspector.js";
import { compareManagedMemberPaths } from "../../../dist/application/managed/ManagedMemberComparisonService.js";
import { executeManagedNativeBoundaries } from "../../../dist/application/managed/ManagedNativeVerificationService.js";
import { importManagedReconstructionEvidence } from "../../../dist/application/managed/ManagedReconstructionService.js";
import { projectManagedApplicationGraphEvidence } from "../../../dist/application/managed/ManagedApplicationGraphService.js";
import { traceApplicationFeatureEvidence } from "../../../dist/application/javascript/JavaScriptApplicationWorkflowService.js";
import { MANAGED_STATIC_PROVIDER } from "../../../dist/domain/investigationProviders.js";
import { createEvidence } from "../../../dist/domain/evidence.js";
import { functionDossier } from "../../fixtures/managed/function-dossier.mjs";
import {
  alternateMvid,
  buildNativePeFixture,
} from "../../fixtures/managed/pe.mjs";
import { createManagedConformanceSupport } from "./support.mjs";
import {
  comparisonLimits,
  defaultIlBody,
  inspectionLimits,
  memberLimits,
  nativeBoundaryLimits,
} from "./config.mjs";
import { createManagedCompletionReport } from "./completion-report.mjs";
import {
  completeVerifierRun,
  createVerifierRun,
} from "../../lib/verifier-run.mjs";

const verifierRun = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-managed-conformance-"));
let completionReportInput;
let finalReport;
const {
  fixture,
  fixtureBytes,
  runManagedAppManifestSelfTest,
  runOptionalManagedAppManifest,
  runOptionalIlspyOracle,
  sha256,
} = createManagedConformanceSupport({
  workspace,
  inspectionLimits,
  memberLimits,
  defaultIlBody,
});

try {
  const modern = await fixture("modern-anycpu.exe", {
    references: ["System.Runtime"],
    resourceData: Buffer.from("source-owned managed resource"),
  });
  const modernArtifact = inspectManagedArtifactBytes(
    modern.bytes,
    modern.target,
    inspectionLimits,
  );
  assert.equal(modernArtifact.classification.status, "managed");
  assert.equal(modernArtifact.classification.runtime_family, "modern-dotnet");
  assert.equal(modernArtifact.classification.managed_architecture, "anycpu");
  assert.deepEqual(modernArtifact.target_frameworks, [
    ".NETCoreApp,Version=v8.0",
  ]);
  assert.equal(
    modernArtifact.resources[0]?.data_sha256,
    sha256(Buffer.from("source-owned managed resource")),
  );

  const framework = await fixture("framework-x86-pinvoke.exe", {
    cliFlags: 0x0000_0003,
    targetFramework: ".NETFramework,Version=v4.8",
    pinvoke: {
      moduleName: "user32.dll",
      importName: "MessageBoxW",
      mappingFlags: 0x0345,
    },
  });
  const frameworkArtifact = inspectManagedArtifactBytes(
    framework.bytes,
    framework.target,
    inspectionLimits,
  );
  assert.equal(
    frameworkArtifact.classification.runtime_family,
    "dotnet-framework",
  );
  assert.equal(frameworkArtifact.classification.managed_architecture, "x86");
  const frameworkBoundaries = inspectManagedNativeBoundariesBytes(
    framework.bytes,
    framework.target,
    nativeBoundaryLimits,
  );
  assert.equal(frameworkBoundaries.pinvoke_imports.length, 1);
  assert.equal(
    frameworkBoundaries.pinvoke_imports[0]?.verification,
    "managed-declaration-only",
  );
  assert.equal(frameworkBoundaries.pinvoke_imports[0]?.char_set, "unicode");
  assert.equal(
    frameworkBoundaries.pinvoke_imports[0]?.call_convention,
    "stdcall",
  );
  const frameworkMembers = inspectManagedMembersBytes(
    framework.bytes,
    framework.target,
    memberLimits,
  );
  const frameworkArtifactEvidence = createEvidence(
    framework.target,
    MANAGED_STATIC_PROVIDER,
    {
      operation: "inspect_managed_artifact",
      parameters: inspectionLimits,
      result: frameworkArtifact,
      rawResult: null,
      limitations: frameworkArtifact.limitations,
      locations: [{ kind: "artifact-path", path: framework.target.path }],
    },
  );
  const frameworkMemberEvidence = createEvidence(
    framework.target,
    MANAGED_STATIC_PROVIDER,
    {
      operation: "inspect_managed_members",
      parameters: memberLimits,
      result: frameworkMembers,
      rawResult: null,
      limitations: frameworkMembers.limitations,
      locations: [{ kind: "artifact-path", path: framework.target.path }],
    },
  );
  const frameworkBoundaryEvidence = createEvidence(
    framework.target,
    MANAGED_STATIC_PROVIDER,
    {
      operation: "inspect_managed_native_boundaries",
      parameters: nativeBoundaryLimits,
      result: frameworkBoundaries,
      rawResult: null,
      limitations: frameworkBoundaries.limitations,
      locations: [{ kind: "artifact-path", path: framework.target.path }],
    },
  );
  const nativeFunctionTarget = {
    path: "/system/user32.dll",
    sha256: "9".repeat(64),
    format: "pe",
    architecture: "x86",
  };
  const nativeFunctionEvidence = createEvidence(
    nativeFunctionTarget,
    {
      id: "ghidra",
      name: "Ghidra",
      version: "12.1.4",
    },
    {
      operation: "analyze_function",
      parameters: { procedure: "MessageBoxW" },
      result: functionDossier("MessageBoxW"),
      rawResult: null,
      limitations: [],
      locations: [{ kind: "address", address: "0x401000" }],
    },
  );
  const nativeVerification = executeManagedNativeBoundaries({
    managed_boundaries: frameworkBoundaryEvidence,
    native_observations: [nativeFunctionEvidence],
  });
  assert.equal(nativeVerification.ok, true);
  assert.equal(
    nativeVerification.value.evidence.normalized_result.summary.verified,
    1,
  );
  const applicationGraph = projectManagedApplicationGraphEvidence({
    managed_artifact: frameworkArtifactEvidence,
    managed_members: frameworkMemberEvidence,
    managed_native_boundaries: frameworkBoundaryEvidence,
  });
  assert.equal(applicationGraph.ok, true);
  assert.equal(
    applicationGraph.value.normalized_result.summary.pinvoke_imports,
    1,
  );
  assert.equal(
    applicationGraph.value.normalized_result.graph.nodes.some(
      ({ kind }) => kind === "managed-pinvoke-import",
    ),
    true,
  );
  const applicationTrace = traceApplicationFeatureEvidence({
    application: applicationGraph.value,
    native_observations: [],
    seed: {
      kind: "string",
      value: "MessageBoxW",
      match: "exact",
      case_sensitive: true,
    },
    direction: "incoming",
  });
  assert.equal(applicationTrace.ok, true);
  assert.equal(applicationTrace.value.result.summary.matched_seeds, 1);

  const readyToRun = await fixture("r2r-x64.exe", {
    machine: 0x8664,
    readyToRun: true,
    methods: [
      {
        name: "NativeBody",
        implFlags: 0x0001,
        body: Buffer.from([0x2a]),
      },
    ],
  });
  const r2rArtifact = inspectManagedArtifactBytes(
    readyToRun.bytes,
    readyToRun.target,
    inspectionLimits,
  );
  assert.equal(r2rArtifact.pe.architecture, "x86_64");
  assert.equal(
    r2rArtifact.classification.implementation,
    "cil-and-ready-to-run",
  );
  const r2rBoundaries = inspectManagedNativeBoundariesBytes(
    readyToRun.bytes,
    readyToRun.target,
    nativeBoundaryLimits,
  );
  assert.equal(r2rBoundaries.summary.ready_to_run, true);
  assert.equal(r2rBoundaries.native_implementations[0]?.code_type, "native");
  assert.equal(
    r2rBoundaries.native_implementations[0]?.boundary_kind,
    "native-body",
  );

  const obfuscated = await fixture("obfuscated.exe", {
    typeName: "ꙮType",
    methodName: "λ⛧",
    fieldName: "字段",
  });
  const obfuscatedMembers = inspectManagedMembersBytes(
    obfuscated.bytes,
    obfuscated.target,
    memberLimits,
  );
  assert.equal(obfuscatedMembers.types[0]?.full_name, "Fixture.ꙮType");
  assert.equal(obfuscatedMembers.methods[0]?.name, "λ⛧");
  assert.equal(obfuscatedMembers.fields[0]?.name, "字段");
  const reconstructionMethod = obfuscatedMembers.methods[0];
  assert.ok(reconstructionMethod);
  const obfuscatedMembersEvidence = createEvidence(
    undefined,
    MANAGED_STATIC_PROVIDER,
    {
      operation: "inspect_managed_members",
      parameters: { path: obfuscated.path },
      result: obfuscatedMembers,
      rawResult: null,
      limitations: obfuscatedMembers.limitations,
    },
  );
  const reconstructionImport = importManagedReconstructionEvidence({
    static_members: obfuscatedMembersEvidence,
    decompiler: {
      name: "ilspycmd",
      version: "9.1.0.7988",
      family: "ilspy",
      executable_sha256: null,
      options: ["--type", "Fixture.ꙮType"],
    },
    methods: [
      {
        token: reconstructionMethod.token,
        signature_sha256: reconstructionMethod.signature.raw_sha256,
        normalized_il_sha256: reconstructionMethod.body.normalized_il_sha256,
        reconstruction: {
          kind: "decompiled-csharp",
          language: "csharp",
          text: "internal static void λ⛧() { /* synthetic fixture */ }",
        },
      },
    ],
    notes: ["source-owned synthetic decompiler reconstruction"],
  });
  assert.equal(reconstructionImport.ok, true);
  assert.equal(
    reconstructionImport.value.normalized_result.methods[0].validation
      .canonical_observation,
    false,
  );
  assert.equal(reconstructionImport.value.confidence, "inferred");
  const left = await fixture("token-drift-left.exe", {
    methodName: "StableSemanticSlice",
  });
  const right = await fixture("token-drift-right.exe", {
    mvid: alternateMvid,
    methods: [
      { name: "InsertedHelper", body: Buffer.from([0x2a]) },
      { name: "RenamedSemanticSlice", body: defaultIlBody },
    ],
  });
  const comparison = await compareManagedMemberPaths({
    leftPath: left.path,
    rightPath: right.path,
    memberLimits: {
      maxFileBytes: 1024 * 1024,
      ...memberLimits,
    },
    comparisonLimits,
  });
  assert.equal(comparison.ok, true);
  const comparisonResult = comparison.value.normalized_result;
  assert.equal(
    comparisonResult.algorithm.name_matching,
    "exact-signature-fallback",
  );
  assert.equal(comparisonResult.matching.exact_il_signature, 1);
  assert.equal(
    comparisonResult.methods.some(
      ({ left, right, match }) =>
        left.token === "0x06000001" &&
        right?.token === "0x06000002" &&
        match.basis === "exact-il-signature",
    ),
    true,
  );

  const unavailableBodyLeft = await fixture("partial-body-left.exe", {
    methods: [{ name: "PartialBodyTarget", body: Buffer.from([0xff]) }],
  });
  const unavailableBodyRight = await fixture("partial-body-right.exe", {
    methods: [{ name: "PartialBodyTarget", body: defaultIlBody }],
  });
  const partialBodyComparison = await compareManagedMemberPaths({
    leftPath: unavailableBodyLeft.path,
    rightPath: unavailableBodyRight.path,
    memberLimits: {
      maxFileBytes: 1024 * 1024,
      ...memberLimits,
    },
    comparisonLimits,
  });
  assert.equal(partialBodyComparison.ok, true);
  const partialBodyMethod =
    partialBodyComparison.value.normalized_result.methods.find(
      ({ left }) => left?.name === "PartialBodyTarget",
    );
  assert.equal(partialBodyMethod?.status, "unknown");
  assert.equal(partialBodyMethod?.match.basis, "exact-signature");
  assert.equal(partialBodyMethod?.dimensions.includes("body-coverage"), true);

  const nativeOnly = await fixtureBytes(
    "native-only.exe",
    buildNativePeFixture(),
  );
  const nativeResult = inspectManagedArtifactBytes(
    nativeOnly.bytes,
    nativeOnly.target,
    inspectionLimits,
  );
  assert.equal(nativeResult.classification.status, "not-managed");

  const malformed = await fixture("malformed-metadata.exe", {
    corruptMetadataSignature: true,
  });
  const malformedResult = inspectManagedArtifactBytes(
    malformed.bytes,
    malformed.target,
    inspectionLimits,
  );
  assert.equal(malformedResult.classification.status, "malformed");

  const manifestSelfTest = await runManagedAppManifestSelfTest();
  const operatorManifest = await runOptionalManagedAppManifest();
  const ilspyOracle = await runOptionalIlspyOracle();
  completionReportInput = {
    modern,
    framework,
    nativeFunctionTarget,
    readyToRun,
    obfuscated,
    left,
    right,
    nativeOnly,
    malformed,
    manifestSelfTest,
    operatorManifest,
    ilspyOracle,
  };
  finalReport = {
    verified:
      11 + (operatorManifest === null ? 0 : 1) + (ilspyOracle === null ? 0 : 1),
    managedSurfaces: [
      "inspect_managed_artifact",
      "inspect_managed_members",
      "inspect_managed_native_boundaries",
      "compare_managed_members",
      "verify_managed_native_boundaries",
      "import_managed_reconstruction",
      "project_managed_application_graph",
    ],
    coverage: [
      "modern-dotnet-anycpu",
      "dotnet-framework-x86-pinvoke",
      "x64-ready-to-run-native-body",
      "managed-native-verification",
      "managed-application-graph-projection",
      "unicode-obfuscated-identifiers",
      "decompiler-reconstruction-import",
      "mvid-and-token-drift",
      "not-managed",
      "malformed-metadata",
      "operator-local-managed-manifest",
      ...(ilspyOracle === null ? [] : ["ilspy-reconstruction-oracle"]),
    ],
    managedAppManifest: {
      env: "REA_MANAGED_APP_MANIFEST_PATH",
      selfTest: manifestSelfTest,
      operator: operatorManifest ?? { configured: false },
    },
    ilspyOracle: ilspyOracle ?? {
      env: "REA_ILSPY_CMD_PATH",
      configured: false,
    },
  };
} finally {
  await rm(workspace, { recursive: true, force: true });
}
finalReport.completionReport = createManagedCompletionReport(
  completionReportInput,
  await completeVerifierRun(verifierRun),
);
process.stdout.write(`${JSON.stringify(finalReport)}\n`);
