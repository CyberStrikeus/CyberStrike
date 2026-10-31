import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it as test } from "vitest";

import type { RetainedResourceScope } from "../../../../src/application/AnalysisProvider.js";
import { runKunaCommand } from "../../../../src/kuna/KunaCommand.js";
import type { KunaInstallation } from "../../../../src/kuna/KunaInstallation.js";
import { KunaProjectCache } from "../../../../src/kuna/KunaProjectCache.js";
import { KunaProvider } from "../../../../src/kuna/KunaProvider.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { writeFakeKuna } from "./fakeKuna.js";
import {
  inspectKunaInstallationOwned as inspectKunaInstallation,
  withKunaResourceScope,
} from "./kunaResourceScope.js";

const it = test.skipIf(process.platform === "win32");
const shellArgument = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const wrapperSource = `#!/bin/sh\nexec ${shellArgument(process.execPath)} "$(/usr/bin/dirname "$0")/producer.cjs" "$@"\n`;

const selectWrapper = async (
  root: string,
  name: string,
  implementation: string,
) => {
  const directory = join(root, name);
  await mkdir(directory);
  const command = join(directory, "kuna");
  await symlink(implementation, command);
  return { directory, command };
};

const runInstallation = (
  installation: KunaInstallation,
  workspace: string,
  resources: RetainedResourceScope,
) =>
  runKunaCommand({
    installation,
    arguments: ["authored-observation"],
    workspace,
    operation: "kuna:selection-fixture",
    timeoutMs: 5_000,
    deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 5_000 },
    outputBytes: 4096,
    signal: new AbortController().signal,
    retainFailedFileClose: (owner, path) => resources.retain(owner, path),
  });

it("uses the selected Kuna launcher and its sibling producer for readiness and commands", async () => {
  const root = await createTestTempDirectory("rea-kuna-command-selection-");
  const implementation = join(root, "implementation");
  await writeFile(implementation, wrapperSource, { mode: 0o755 });
  const selected = await selectWrapper(root, "selected", implementation);
  await writeFile(
    join(selected.directory, "producer.cjs"),
    `if (process.argv[2] === '--version') console.log('kuna 1.833');
else console.log(JSON.stringify({producer: __filename, arguments: process.argv.slice(2)}));\n`,
  );
  const installed = await inspectKunaInstallation({
    REA_KUNA_COMMAND: selected.command,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  });
  if (!installed.ok) throw new Error(installed.error.reason);
  expect(installed.value).toMatchObject({
    executable: implementation,
    configuration: { command: selected.command },
    sha256: createHash("sha256").update(wrapperSource).digest("hex"),
  });
  const outcome = await withKunaResourceScope((resources) =>
    runInstallation(installed.value, root, resources),
  );
  if (outcome.kind !== "ok") throw outcome.error;
  expect(JSON.parse(outcome.snapshot.stdout.text)).toEqual({
    producer: join(selected.directory, "producer.cjs"),
    arguments: ["authored-observation"],
  });
});

it.each(["different bytes", "identical bytes"] as const)(
  "refuses a selected launcher retargeted after discovery to %s before executing it",
  async (mode) => {
    const root = await createTestTempDirectory("rea-kuna-command-retarget-");
    const implementation = join(root, "implementation");
    await writeFile(implementation, wrapperSource, { mode: 0o755 });
    const selected = await selectWrapper(root, "selected", implementation);
    const marker = join(root, "ran-after-retarget");
    await writeFile(
      join(selected.directory, "producer.cjs"),
      `if (process.argv[2] === '--version') console.log('kuna 1.833');
else require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
    );
    const installed = await inspectKunaInstallation({
      REA_KUNA_COMMAND: selected.command,
      REA_KUNA_CACHE_DIR: join(root, "cache"),
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const replacement = join(root, "replacement");
    await writeFile(
      replacement,
      mode === "identical bytes"
        ? wrapperSource
        : `${wrapperSource}# replacement\n`,
      { mode: 0o755 },
    );
    await unlink(selected.command);
    await symlink(replacement, selected.command);
    const outcome = await withKunaResourceScope((resources) =>
      runInstallation(installed.value, root, resources),
    );
    expect(outcome).toMatchObject({
      kind: "failed",
      error: { _tag: "AnalysisArtifactChangedError", path: selected.command },
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("refuses an identical-byte launcher retargeted between profile creation and session acquisition", async () => {
  const root = await createTestTempDirectory("rea-kuna-profile-retarget-");
  const implementation = join(root, "implementation");
  await writeFile(implementation, wrapperSource, { mode: 0o755 });
  const selected = await selectWrapper(root, "selected", implementation);
  await writeFile(
    join(selected.directory, "producer.cjs"),
    "console.log('kuna 1.833');\n",
  );
  const provider = new KunaProvider({
    REA_KUNA_COMMAND: selected.command,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  });
  const target = {
    path: join(root, "target"),
    sha256: createHash("sha256").update("inert input").digest("hex"),
    kind: "executable" as const,
    format: "elf" as const,
    architecture: "x86_64" as const,
    availableArchitectures: ["x86_64" as const],
  };
  await writeFile(target.path, "inert input");
  const resolved = await withKunaResourceScope((resourceScope) =>
    provider.resolveAnalysisProfile(target, { resourceScope }),
  );
  if (!resolved.ok || resolved.value.profile === null)
    throw new Error("Expected an admitted Kuna profile");
  const replacement = join(root, "replacement");
  await writeFile(replacement, wrapperSource, { mode: 0o755 });
  await unlink(selected.command);
  await symlink(replacement, selected.command);
  const client = provider.createClient(target, resolved.value.profile);
  try {
    expect(await client.execute("health", {})).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        diagnostics: {
          committed_executable: implementation,
          observed_executable: replacement,
        },
      },
    });
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("keeps shared-cache exports separate for equal wrapper bytes selected beside different producers", async () => {
  const root = await createTestTempDirectory("rea-kuna-command-cache-");
  const implementation = join(root, "implementation");
  await writeFile(implementation, wrapperSource, { mode: 0o755 });
  const cacheRoot = join(root, "cache");
  const targetPath = join(root, "target");
  await writeFile(targetPath, "inert fixture input");
  const targetSha256 = createHash("sha256")
    .update(await readFile(targetPath))
    .digest("hex");
  const installations: KunaInstallation[] = [];
  for (const name of ["alpha", "beta"]) {
    const selected = await selectWrapper(root, name, implementation);
    const producerRoot = join(root, `producer-${name}`);
    await mkdir(producerRoot);
    const producer = await writeFakeKuna(producerRoot, {
      functions: [{ name, addr: "0x1000" }],
    });
    await symlink(producer, join(selected.directory, "producer.cjs"));
    const installed = await inspectKunaInstallation({
      REA_KUNA_COMMAND: selected.command,
      REA_KUNA_CACHE_DIR: cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    installations.push(installed.value);
  }
  expect(installations[0]?.sha256).toBe(installations[1]?.sha256);
  const cache = new KunaProjectCache(cacheRoot, { maxBytes: 64 * 1024 ** 2 });
  try {
    const keys: string[] = [];
    for (const [index, installation] of installations.entries()) {
      const built = await cache.build({
        installation,
        targetPath,
        targetSha256,
      });
      if (!built.ok) throw built.error;
      keys.push(built.value.key);
      expect(built.value.functions[0]?.name).toBe(
        index === 0 ? "alpha" : "beta",
      );
      expect(built.value.manifest.inputs).toMatchObject({
        kuna_command: installation.configuration.command,
        kuna_executable: installation.executable,
      });
    }
    expect(keys[0]).not.toBe(keys[1]);
  } finally {
    expect((await cache.close()).ok).toBe(true);
  }
});
