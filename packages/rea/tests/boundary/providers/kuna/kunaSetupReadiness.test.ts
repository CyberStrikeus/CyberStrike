import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  FakeSetupHost,
  options,
} from "../../../../src/application/Setup.fixture.js";
import { runSetup } from "../../../../src/application/Setup.js";
import { inspectKunaProviderOwned } from "./kunaResourceScope.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { writeFakeKuna } from "./fakeKuna.js";

const test = it.skipIf(process.platform === "win32");

test.each([
  { cache: "blocked", version: "kuna 1.833\n", expected: ["ghidra"] },
  {
    cache: "ready",
    version: "kuna 1.950\n",
    expected: ["kuna", "ghidra"],
  },
])(
  "projects installation separately from $cache cache readiness",
  async ({ cache, version, expected }) => {
    const root = await createTestTempDirectory("rea-kuna-setup-readiness-");
    const command = await writeFakeKuna(root, {
      version: { stdout: version },
    });
    const cachePath = join(root, "cache");
    if (cache === "blocked") await writeFile(cachePath, "not a directory");
    else await mkdir(cachePath);

    const inspection = await inspectKunaProviderOwned({
      REA_KUNA_COMMAND: command,
      REA_KUNA_CACHE_DIR: cachePath,
    });
    expect(inspection.available).toBe(cache === "ready");
    expect(inspection.checks[0]).toMatchObject({
      name: "installation",
      ok: true,
    });
    expect(inspection.checks[1]).toMatchObject({
      name: "cache",
      ok: cache === "ready",
    });
    if (version === "kuna 1.950\n")
      expect(inspection.checks[0]).toMatchObject({
        ok: true,
        detail: expect.stringContaining("project layout is unverified"),
      });

    const host = new FakeSetupHost();
    host.providerInspections = [
      inspection,
      {
        id: "ghidra",
        configured: true,
        available: true,
        providerVersion: "12.1.4",
        registrationEnvironment: { GHIDRA_INSTALL_DIR: "/tools/ghidra" },
        checks: [
          {
            name: "installation",
            ok: true,
            code: null,
            detail: "Ghidra installation passed its required checks.",
            remediation: null,
            classification: "config_drift",
          },
        ],
      },
    ];
    host.doctorHealthy = cache === "ready";
    host.scopedDoctorHealthy = true;

    const result = await runSetup(options(true), host);

    expect(result.status).toBe("ready");
    expect(result.doctor.availableProviders).toEqual(expected);
  },
);
