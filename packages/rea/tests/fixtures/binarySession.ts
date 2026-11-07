import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createAnalysisProfile } from "../../src/domain/analysisProfile.js";
import type { BinaryTarget } from "../../src/domain/binaryTargetTypes.js";
import type { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import { HopperStartError } from "../../src/domain/hopperErrors.js";
import type { Result } from "../../src/domain/result.js";
import type {
  AnalysisClient,
  AnalysisOperation,
  AnalysisProviderCandidate,
  CapabilityDescriptor,
  AnalysisProfileResolution,
  AnalysisProfileResolutionOptions,
  AnalysisProvider,
} from "../../src/application/AnalysisProvider.js";
import { BinarySession } from "../../src/application/binary/BinarySession.js";
import { SessionProviderRouter } from "../../src/application/binary/SessionProviderRouter.js";
import { AnalysisProviderRegistry } from "../../src/application/binary/AnalysisProviderRegistry.js";
import { OFFICIAL_TOOL_CONTRACTS } from "../../src/contracts/officialToolContracts.js";
import { ENHANCED_TOOL_CONTRACTS } from "../../src/contracts/enhancedToolContracts.js";
import { NATIVE_TOOL_CONTRACTS } from "../../src/contracts/native/nativeToolContracts.js";
import { MANAGED_TOOL_CONTRACTS } from "../../src/contracts/managed/managedToolContracts.js";
import { ARTIFACT_TOOL_CONTRACTS } from "../../src/contracts/artifactToolContracts.js";

import { err, ok as resultOk } from "../../src/domain/result.js";
import { observed } from "./analysisExecution.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

type TestBinarySessionOptions = {
  readonly auxiliaryProviders?: readonly AnalysisProvider[];
  readonly resolveAnalysisProfile?: (
    target: BinaryTarget,
    options?: AnalysisProfileResolutionOptions,
  ) => Promise<Result<AnalysisProfileResolution, AnalysisError>>;
};

type FixtureClientFactory = AnalysisProvider["createClient"];

const FIXTURE_IDENTITY = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
} as const;

const FIXTURE_OPERATIONS: readonly Exclude<AnalysisOperation, "health">[] = [
  ...OFFICIAL_TOOL_CONTRACTS,
  ...ENHANCED_TOOL_CONTRACTS,
  ...NATIVE_TOOL_CONTRACTS,
  ...MANAGED_TOOL_CONTRACTS,
  ...ARTIFACT_TOOL_CONTRACTS,
].map(({ name }) => name);

/** Declare fixture client operations before composing the production registry route. */
export const createTestProviderRouter = (
  provider: AnalysisProvider | FixtureClientFactory,
  options: TestBinarySessionOptions = {},
): SessionProviderRouter => {
  const declared: AnalysisProvider =
    typeof provider === "function"
      ? {
          identity: () => FIXTURE_IDENTITY,
          capabilities: () =>
            FIXTURE_OPERATIONS.map((operation) => ({
              provider: FIXTURE_IDENTITY,
              operation,
              available: true,
              reason: null,
              cachePolicy: "live",
              effects: {
                mutatesArtifact: false,
                launchesProcess: false,
                mayShowUi: false,
                mayAccessNetwork: false,
                mayWriteFilesystem: false,
                changesPermissions: false,
                requiresRoot: false,
              },
              limitations: [],
            })),
          createClient: provider,
        }
      : provider;
  const resolve =
    options.resolveAnalysisProfile ??
    declared.resolveAnalysisProfile?.bind(declared);
  if (resolve === undefined)
    return SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), [
      declared,
      ...(options.auxiliaryProviders ?? []),
    ]);
  const candidate: AnalysisProviderCandidate = {
    identity: () => declared.identity(),
    capabilities: () => declared.capabilities(),
    createClient: (target, profile, context) =>
      declared.createClient(target, profile, context),
    resolveAnalysisProfile: resolve,
    inspectAvailability: () => ({
      status: "available",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    inspectTargetSupport: () => ({
      status: "supported",
      code: null,
      reason: null,
      diagnostics: {},
    }),
  };
  return SessionProviderRouter.selectable(
    new AnalysisProviderRegistry([candidate]),
    options.auxiliaryProviders ?? [],
  );
};

/** Create a focused session with production registry and auxiliary routing. */
export const createTestBinarySession = (
  provider: AnalysisProvider | FixtureClientFactory,
  options: TestBinarySessionOptions = {},
): BinarySession =>
  new BinarySession(createTestProviderRouter(provider, options));

/** Materialize two distinct targets for session lifecycle tests. */
export const createBinarySessionTargets = async (): Promise<
  readonly [string, string]
> => {
  const directory = await createTestTempDirectory("rea-binary-session-");
  const first = join(directory, "first.hop");
  const second = join(directory, "second.hop");
  await Promise.all([writeFile(first, "one"), writeFile(second, "two")]);
  return [first, second];
};

/** Create a provider whose calls and declared effects are observable by tests. */
export const createCacheProvider = (
  calls: string[],
  mayWriteFilesystem = false,
): AnalysisProvider => {
  const identity = {
    id: "fixture",
    name: "Fixture analysis provider",
    version: "1",
  } as const;
  return {
    identity: () => identity,
    resolveAnalysisProfile: () =>
      Promise.resolve(
        resultOk({
          profile: createAnalysisProfile(identity, { fixture: true }),
        }),
      ),
    capabilities: () => [
      cacheCapability(identity, "address_name", false, mayWriteFilesystem),
      cacheCapability(identity, "set_address_name", true),
    ],
    createClient: () => ({
      execute: (operation) => {
        calls.push(operation);
        return Promise.resolve(observed(operation));
      },
      close: () => Promise.resolve(resultOk(null)),
    }),
  };
};

/** Controllable client used to observe session replacement and cancellation. */
export class ControllableAnalysisClient implements AnalysisClient {
  closed = 0;

  constructor(
    readonly pendingHealth?: Promise<ReturnType<typeof observed>>,
    readonly failHealth = false,
    readonly pendingCall?: Promise<ReturnType<typeof observed>>,
  ) {}

  execute(name: string) {
    if (name === "health")
      return this.failHealth
        ? Promise.resolve(err(new HopperStartError()))
        : (this.pendingHealth ?? Promise.resolve(observed(null)));
    return this.pendingCall ?? Promise.resolve(observed(null));
  }

  close(): Promise<Result<null, AnalysisError>> {
    this.closed += 1;
    return Promise.resolve(resultOk(null));
  }
}

/** Create an explicitly resolved promise for lifecycle interleaving tests. */
export const createDeferred = <T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
};

const cacheCapability = (
  provider: CapabilityDescriptor["provider"],
  operation: "address_name" | "set_address_name",
  mutatesArtifact: boolean,
  mayWriteFilesystem = false,
): CapabilityDescriptor => ({
  provider,
  operation,
  available: true,
  reason: null,
  effects: {
    mutatesArtifact,
    launchesProcess: false,
    mayShowUi: false,
    mayAccessNetwork: false,
    mayWriteFilesystem,
    changesPermissions: false,
    requiresRoot: false,
  },
  limitations: [],
});
