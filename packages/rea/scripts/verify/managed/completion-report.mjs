import { createEvidence } from "../../../dist/domain/evidence.js";

const COMPLETION_PROVIDER = {
  id: "rea-managed-conformance",
  name: "REA managed conformance verifier",
  version: "1",
};

const completionClaim = ({
  claimId,
  scenarioId,
  targets = [],
  status = "pass",
  limitations = [],
}) => {
  const artifactSha256s = [
    ...new Set(targets.map(({ sha256: digest }) => digest)),
  ].sort();
  const evidence = createEvidence(targets[0], COMPLETION_PROVIDER, {
    predicateType: "rea.verification",
    operation: "verify_managed_conformance",
    parameters: {
      scenario_id: scenarioId,
      scenario_version: 1,
      artifact_sha256s: artifactSha256s,
    },
    result: { status },
    rawResult: null,
    limitations,
  });
  return {
    claim_id: claimId,
    scenario: { id: scenarioId, version: 1 },
    artifact_sha256s: artifactSha256s,
    provider: {
      id: COMPLETION_PROVIDER.id,
      version: COMPLETION_PROVIDER.version,
    },
    status,
    evidence_ids: [evidence.evidence_id],
  };
};

const optionalTarget = (target) =>
  target === undefined
    ? []
    : [{ path: target.file_name, sha256: target.sha256, format: "pe" }];

const sourceOwnedClaims = ({
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
}) => [
  completionClaim({
    claimId: "managed.modern-dotnet-anycpu",
    scenarioId: "modern-dotnet-anycpu",
    targets: [modern.target],
  }),
  completionClaim({
    claimId: "managed.dotnet-framework-x86-pinvoke",
    scenarioId: "dotnet-framework-x86-pinvoke",
    targets: [framework.target],
  }),
  completionClaim({
    claimId: "managed.x64-ready-to-run-native-body",
    scenarioId: "x64-ready-to-run-native-body",
    targets: [readyToRun.target],
  }),
  completionClaim({
    claimId: "managed.managed-native-verification",
    scenarioId: "managed-native-verification",
    targets: [framework.target, nativeFunctionTarget],
  }),
  completionClaim({
    claimId: "managed.application-graph-projection",
    scenarioId: "managed-application-graph-projection",
    targets: [framework.target],
  }),
  completionClaim({
    claimId: "managed.unicode-obfuscated-identifiers",
    scenarioId: "unicode-obfuscated-identifiers",
    targets: [obfuscated.target],
  }),
  completionClaim({
    claimId: "managed.decompiler-reconstruction-import",
    scenarioId: "decompiler-reconstruction-import",
    targets: [obfuscated.target],
  }),
  completionClaim({
    claimId: "managed.mvid-and-token-drift",
    scenarioId: "mvid-and-token-drift",
    targets: [left.target, right.target],
  }),
  completionClaim({
    claimId: "managed.not-managed",
    scenarioId: "not-managed",
    targets: [nativeOnly.target],
  }),
  completionClaim({
    claimId: "managed.malformed-metadata",
    scenarioId: "malformed-metadata",
    targets: [malformed.target],
  }),
  completionClaim({
    claimId: "managed.operator-manifest-self-test",
    scenarioId: "operator-manifest-self-test",
    targets: [
      {
        path: manifestSelfTest.target.file_name,
        sha256: manifestSelfTest.target.sha256,
        format: "pe",
      },
    ],
  }),
];

const optionalClaims = ({ operatorManifest, ilspyOracle }) => [
  completionClaim({
    claimId: "managed.operator-local-manifest",
    scenarioId: "operator-local-manifest",
    targets: optionalTarget(operatorManifest?.target),
    status: operatorManifest === null ? "unsupported" : "pass",
    limitations:
      operatorManifest === null
        ? ["REA_MANAGED_APP_MANIFEST_PATH is not configured."]
        : [],
  }),
  completionClaim({
    claimId: "managed.ilspy-reconstruction-oracle",
    scenarioId: "ilspy-reconstruction-oracle",
    targets: optionalTarget(ilspyOracle?.fixture),
    status: ilspyOracle === null ? "unsupported" : "pass",
    limitations:
      ilspyOracle === null ? ["REA_ILSPY_CMD_PATH is not configured."] : [],
  }),
];

/** Project completed managed assertions into the standard verifier report. */
export const createManagedCompletionReport = (input, verifierRun) => ({
  verifier: {
    id: COMPLETION_PROVIDER.id,
    version: COMPLETION_PROVIDER.version,
  },
  verifier_run: verifierRun,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    runtime: "node",
    runtime_version: process.versions.node.split(".")[0],
  },
  claims: [...sourceOwnedClaims(input), ...optionalClaims(input)],
});
