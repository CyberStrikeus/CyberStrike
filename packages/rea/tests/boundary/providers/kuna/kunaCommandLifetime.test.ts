import { spawnSync } from "node:child_process";

import { expect, it as test } from "vitest";

import { session } from "./kunaSessionFixture.js";

const SCRIPT = String.raw`
import assert from "node:assert/strict";
import { ArtifactResourceScope } from "./dist/artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "./dist/artifacts/AnalysisCleanupLease.js";
import { inspectKunaInstallation } from "./dist/kuna/KunaInstallation.js";
import { KunaTargetCommands } from "./dist/kuna/KunaTargetCommands.js";
const fixture = JSON.parse(process.env.REA_TEST_KUNA_FIXTURE);
const kunaResources = new ArtifactResourceScope();
const installation = await inspectKunaInstallation(
  { REA_KUNA_COMMAND: fixture.kuna, REA_KUNA_CACHE_DIR: fixture.cacheRoot },
  {
    resourceScope: {
      retain: (handle, resource) =>
        kunaResources.retain({ kind: "lease", resource, lease: AnalysisCleanupLease.forCloseOwner(handle, resource) }),
      run: (operation) => kunaResources.run(operation),
    },
  },
);
assert.equal(installation.ok, true);
const controller = new AbortController();
const commands = new KunaTargetCommands(fixture.target, { signal: controller.signal });
const request = () => commands.run({ installation: installation.value, operation: "retention-probe", arguments: input => ["functions", input, "--json"], deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 2000 }, outputBytes: 16384, signal: controller.signal });
try {
  const capture = async () => {
    const result = await request();
    assert.equal(result.ok, true);
    return new WeakRef(result.value);
  };
  const first = await capture();
  assert.equal((await request()).ok, true);
  // Weak references remain alive until the current job ends; collect only
  // after crossing fresh event-loop turns, without retaining deref results.
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
    globalThis.gc();
  }
  assert.equal(first.deref(), undefined, "The command queue retained a completed output snapshot");
} finally {
  controller.abort();
  assert.equal((await commands.close()).ok, true);
  await kunaResources.close();
}
`;

test.skipIf(process.platform === "win32")(
  "releases completed native outputs after requests settle",
  async () => {
    const { kuna, cacheRoot, target } = await session(
      "rea-kuna-command-retention-",
    );
    const result = spawnSync(
      process.execPath,
      ["--expose-gc", "--input-type=module", "-e", SCRIPT],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          REA_TEST_KUNA_FIXTURE: JSON.stringify({ kuna, cacheRoot, target }),
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  },
);
