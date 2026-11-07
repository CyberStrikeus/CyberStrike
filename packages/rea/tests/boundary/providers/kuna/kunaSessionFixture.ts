import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { onTestFinished } from "vitest";

import type { AnalysisClient } from "../../../../src/application/AnalysisProvider.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import type { JsonValue } from "../../../../src/domain/jsonValue.js";
import type { KunaProcessLauncher } from "../../../../src/kuna/KunaCommand.js";
import { KunaProvider } from "../../../../src/kuna/KunaProvider.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { withKunaResourceScope } from "./kunaResourceScope.js";
import {
  fakeKunaCalls,
  writeFakeKuna,
  type FakeKunaBehavior,
} from "./fakeKuna.js";

export const FUNCTIONS = [
  { name: "main", addr: "0x1000" },
  { name: "parse", addr: "0x1040" },
  {
    name: "broken",
    addr: "0x1080",
    error: "Flow exceeded maximum instructions",
  },
] as const;

export const session = async (
  prefix: string,
  behavior: FakeKunaBehavior = {},
  environment: Readonly<Record<string, string>> = {},
  launcher?: KunaProcessLauncher,
  singleFunctionRuns?: number,
) => {
  const root = await createTestTempDirectory(prefix);
  const kuna = await writeFakeKuna(root, { functions: FUNCTIONS, ...behavior });
  const targetPath = join(root, "program");
  await writeFile(targetPath, "program bytes");
  const target: BinaryTarget = {
    path: targetPath,
    sha256: createHash("sha256").update("program bytes").digest("hex"),
    kind: "executable",
    format: "elf",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
  };
  const cacheRoot = join(root, "cache");
  const provider = new KunaProvider(
    { REA_KUNA_COMMAND: kuna, REA_KUNA_CACHE_DIR: cacheRoot, ...environment },
    {
      platform: process.platform,
      ...(launcher === undefined ? {} : { launcher }),
      ...(singleFunctionRuns === undefined ? {} : { singleFunctionRuns }),
    },
  );
  // Finished hooks run in reverse order: clients, shared cache, then root.
  onTestFinished(async () => {
    const closed = await provider.closeOwnedResources();
    if (!closed.ok) throw closed.error;
  });
  const profile = await withKunaResourceScope((resourceScope) =>
    provider.resolveAnalysisProfile(target, { resourceScope }),
  );
  if (!profile.ok || profile.value.profile === null)
    throw new Error("profile did not resolve");
  const resolved = profile.value.profile;
  const open = () => {
    const client = provider.createClient(target, resolved);
    onTestFinished(async () => {
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    });
    return client;
  };
  return { root, kuna, target, cacheRoot, provider, profile: resolved, open };
};

export const run = async (
  client: AnalysisClient,
  operation: Parameters<AnalysisClient["execute"]>[0],
  parameters: Readonly<Record<string, JsonValue>> = {},
  signal?: AbortSignal,
) => {
  const result = await client.execute(
    operation,
    parameters,
    signal === undefined ? {} : { signal },
  );
  if (!result.ok) throw result.error;
  return result.value;
};

export const exportsOf = async (kuna: string) =>
  (await fakeKunaCalls(kuna)).filter(
    ({ argv }) => argv[0] === "decompile-project",
  );

/**
 * Launch for real, but have cleanup of the selected subcommand report an
 * unproven stop until `release` is called, as a lost ownership proof would.
 */
export const unprovenCleanupLauncher = (subcommand: string) => {
  let proven = false;
  const launcher: KunaProcessLauncher = async (options) => {
    const spawned = await spawnOwnedProviderProcess(options);
    if (options.arguments[0] !== subcommand) return spawned;
    return {
      ...spawned,
      cleanup: async () => {
        const cleaned = await cleanupOwnedProcessGroup(spawned.ownership);
        return proven
          ? cleaned
          : { cleaned: false, reason: `${subcommand} stop unproven` };
      },
    };
  };
  return { launcher, release: () => (proven = true) };
};
