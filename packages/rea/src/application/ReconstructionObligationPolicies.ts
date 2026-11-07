import type { ReconstructionObligation } from "../domain/reconstructionObligationLedgerSchemas.js";

export interface ReconstructionObligationCandidatePolicy {
  readonly applicationLayer: ReconstructionObligation["application_layer"];
  readonly family: string;
  readonly fixtureAuthority: ReconstructionObligation["required_fixture_authority"];
  readonly verifierAuthority: ReconstructionObligation["required_verifier_authority"];
  readonly originalAuthority: ReconstructionObligation["required_original_authority"];
  readonly cases: ReconstructionObligation["required_case_kinds"];
  readonly requiresParserType: boolean;
}

const APPLICATION_NODE_POLICIES: Readonly<
  Partial<Record<string, ReconstructionObligationCandidatePolicy>>
> = {
  package: policy("packaging", "package-lifecycle", "packaged-process", [
    "positive",
    "negative",
    "teardown",
  ]),
  installer: policy("packaging", "installer", "packaged-process", [
    "positive",
    "negative",
    "teardown",
  ]),
  "context-bridge-api": policy("electron", "context-bridge", "renderer", [
    "positive",
    "negative",
    "malformed",
  ]),
  "ipc-channel": policy("electron", "ipc", "renderer", [
    "positive",
    "negative",
    "malformed",
  ]),
  "ipc-handler": policy("electron", "ipc", "renderer", [
    "positive",
    "negative",
    "malformed",
  ]),
  // Scheme links reach the running application through the OS or a session.
  "url-scheme": policy("electron", "url-scheme", "packaged-process", [
    "positive",
    "negative",
    "malformed",
  ]),
  endpoint: policy("protocol", "endpoint", "protocol", [
    "positive",
    "negative",
    "malformed",
  ]),
  storage: policy("persistence", "persistence", "integration", [
    "positive",
    "negative",
    "malformed",
  ]),
  worker: policy("process", "worker-lifecycle", "packaged-process", [
    "positive",
    "cancellation",
    "teardown",
  ]),
  "service-worker": policy("process", "worker-lifecycle", "packaged-process", [
    "positive",
    "cancellation",
    "teardown",
  ]),
  "native-addon": nativePolicy("native-addon"),
  "native-export": nativePolicy("native-export"),
  "managed-pinvoke-import": nativePolicy("managed-pinvoke"),
  "managed-native-implementation": nativePolicy("managed-native"),
};

const SEMANTIC_NODE_POLICIES: Readonly<
  Partial<Record<string, ReconstructionObligationCandidatePolicy>>
> = {
  "child-process": policy("process", "child-process", "packaged-process", [
    "positive",
    "negative",
    "cancellation",
    "teardown",
  ]),
  stdio: policy("process", "stdio", "packaged-process", [
    "positive",
    "negative",
    "teardown",
  ]),
  signal: policy("process", "signal", "packaged-process", [
    "positive",
    "cancellation",
    "teardown",
  ]),
  "config-source": parserPolicy("cli", "configuration", "integration"),
  request: parserPolicy("protocol", "request", "protocol"),
  response: parserPolicy("protocol", "response", "protocol"),
  boundary: parserPolicy("application", "parser-boundary", "integration"),
  resource: policy("persistence", "resource-lifecycle", "integration", [
    "positive",
    "negative",
    "teardown",
  ]),
  event: policy("runtime", "event", "packaged-process", [
    "positive",
    "negative",
    "cancellation",
  ]),
  timer: policy("runtime", "timer", "packaged-process", [
    "positive",
    "cancellation",
    "teardown",
  ]),
  promise: policy("runtime", "promise-ownership", "packaged-process", [
    "positive",
    "negative",
    "cancellation",
  ]),
  task: policy("runtime", "task-lifecycle", "packaged-process", [
    "positive",
    "cancellation",
    "teardown",
  ]),
};

export const applicationObligationPolicy = (
  nodeKind: string,
): ReconstructionObligationCandidatePolicy | undefined =>
  APPLICATION_NODE_POLICIES[nodeKind];

export const semanticObligationPolicy = (
  nodeKind: string,
): ReconstructionObligationCandidatePolicy | undefined =>
  SEMANTIC_NODE_POLICIES[nodeKind];

function policy(
  applicationLayer: ReconstructionObligationCandidatePolicy["applicationLayer"],
  family: string,
  authority: ReconstructionObligationCandidatePolicy["fixtureAuthority"],
  cases: ReconstructionObligationCandidatePolicy["cases"],
): ReconstructionObligationCandidatePolicy {
  return {
    applicationLayer,
    family,
    fixtureAuthority: authority,
    verifierAuthority: authority,
    originalAuthority: "runtime",
    cases,
    requiresParserType: false,
  };
}

function parserPolicy(
  applicationLayer: ReconstructionObligationCandidatePolicy["applicationLayer"],
  family: string,
  authority: ReconstructionObligationCandidatePolicy["fixtureAuthority"],
): ReconstructionObligationCandidatePolicy {
  return {
    ...policy(applicationLayer, family, authority, [
      "positive",
      "negative",
      "malformed",
    ]),
    requiresParserType: true,
  };
}

function nativePolicy(family: string): ReconstructionObligationCandidatePolicy {
  return {
    applicationLayer: "native-abi",
    family,
    fixtureAuthority: "native-abi",
    verifierAuthority: "native-abi",
    originalAuthority: "static",
    cases: ["positive", "negative"],
    requiresParserType: false,
  };
}
