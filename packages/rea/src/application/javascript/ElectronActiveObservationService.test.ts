import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { electronActiveObservationInputSchema } from "../../domain/javascript/electronActiveObservation.js";
import { err, ok } from "../../domain/result.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import { createElectronActiveObservationFixtureResult } from "../../domain/javascript/electronActiveObservation.fixture.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import type { ElectronActiveObservationPort } from "./ElectronActiveObservationPort.js";
import { captureElectronScenario } from "./ElectronActiveObservationService.js";

const SKIP_PERMISSIONS =
  process.platform === "win32" || process.getuid?.() === 0;

/** A provider that records admitted input and never launches anything. */
const recordingProvider = () => {
  const capture = vi.fn<ElectronActiveObservationPort["capture"]>(() =>
    Promise.resolve(
      err(
        new AnalysisCapabilityUnavailableError(
          "test",
          "capture_electron_scenario",
          "recording provider",
        ),
      ),
    ),
  );
  const provider: ElectronActiveObservationPort = {
    identity: () => ({ id: "test", name: "test", version: "1" }),
    capture,
  };
  return { provider, capture };
};

const fixture = async () => {
  const root = await createTestTempDirectory("rea-electron-admission-");
  const denied = join(root, "denied");
  const readable = join(root, "readable");
  await mkdir(join(denied, "root"), { recursive: true });
  await mkdir(readable);
  const executable = join(denied, "electron");
  await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(join(denied, "main.js"), "module.exports = {};\n");
  await writeFile(join(readable, "main.js"), "module.exports = {};\n");
  return { root, denied, readable, executable };
};

/** Remove search permission from `directory` for the duration of `run`. */
const withoutSearchPermission = async <T>(
  directory: string,
  run: () => Promise<T>,
): Promise<T> => {
  await chmod(directory, 0o000);
  try {
    return await run();
  } finally {
    await chmod(directory, 0o700);
  }
};

it
  .skipIf(SKIP_PERMISSIONS)
  .each(["application_path", "application_root", "executable_path"] as const)(
  "reports a search-denied %s as host access denial before any provider work",
  async (field) => {
    const { denied, readable, executable } = await fixture();
    const selected = {
      application_path: join(denied, "main.js"),
      application_root: join(denied, "root"),
      executable_path: executable,
    }[field];
    const { provider, capture } = recordingProvider();
    const result = await withoutSearchPermission(denied, () =>
      captureElectronScenario(
        provider,
        electronActiveObservationInputSchema.parse({
          executable_path: process.execPath,
          application_path: join(readable, "main.js"),
          actions: [],
          [field]: selected,
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "access_denied",
      category: "unavailable",
      details: {
        operation: "capture_electron_scenario",
        path: selected,
        system_code: "EACCES",
        boundary: "filesystem-read",
      },
    });
    expect(capture).not.toHaveBeenCalled();
  },
);

it.skipIf(SKIP_PERMISSIONS)(
  "reports invalid selections before a host denial on another path",
  async () => {
    const { root, denied } = await fixture();
    const missing = join(root, "missing.js");
    const { provider, capture } = recordingProvider();
    const result = await withoutSearchPermission(denied, () =>
      captureElectronScenario(
        provider,
        electronActiveObservationInputSchema.parse({
          executable_path: process.execPath,
          application_path: missing,
          application_root: join(denied, "root"),
          actions: [],
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["application_path"],
            reason: "invalid_value",
            message: expect.stringContaining("ENOENT"),
          },
        ],
      },
    });
    expect(capture).not.toHaveBeenCalled();
  },
);

it.skipIf(SKIP_PERMISSIONS).each([
  { label: "0644", mode: 0o644 },
  { label: "0000", mode: 0o000 },
])(
  "keeps a reachable executable without execute permission (mode $label) as invalid input",
  async ({ mode }) => {
    const { root, readable } = await fixture();
    const executable = join(root, "not-executable");
    await writeFile(executable, "not executable");
    await chmod(executable, mode);
    const { provider, capture } = recordingProvider();
    const result = await captureElectronScenario(
      provider,
      electronActiveObservationInputSchema.parse({
        executable_path: executable,
        application_path: join(readable, "main.js"),
        actions: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["executable_path"],
            reason: "invalid_value",
            message: expect.stringContaining("is not an executable file"),
          },
        ],
      },
    });
    expect(capture).not.toHaveBeenCalled();
  },
);

it("admits readable selections and hands canonical paths to the provider", async () => {
  const { readable } = await fixture();
  const { provider, capture } = recordingProvider();
  const application = join(readable, "main.js");
  await captureElectronScenario(
    provider,
    electronActiveObservationInputSchema.parse({
      executable_path: process.execPath,
      application_path: application,
      actions: [],
    }),
  );
  expect(capture).toHaveBeenCalledOnce();
  expect(capture.mock.calls[0]?.[0]).toMatchObject({
    application_path: application,
    application_root: readable,
  });
});

it.skipIf(process.platform === "win32")(
  "records selected scenario paths and omission while executing canonical paths",
  async () => {
    const { root, readable } = await fixture();
    const alias = join(root, "selected-application");
    await symlink(readable, alias);
    const input = electronActiveObservationInputSchema.parse({
      executable_path: process.execPath,
      application_path: join(alias, "main.js"),
    });
    const canonicalApplication = await realpath(input.application_path);
    const capture = vi.fn<ElectronActiveObservationPort["capture"]>(() =>
      Promise.resolve(
        ok(createElectronActiveObservationFixtureResult(canonicalApplication)),
      ),
    );
    const result = await captureElectronScenario(
      { identity: () => ({ id: "test", name: "test", version: "1" }), capture },
      input,
    );
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      executable_path: await realpath(process.execPath),
      application_path: canonicalApplication,
      application_root: await realpath(readable),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.parameters).toEqual({
      ...input,
      scenario_sha256: digestCanonicalValue(input, "Electron scenario"),
      resolved_paths: {
        executable_path: await realpath(process.execPath),
        application_path: canonicalApplication,
        application_root: await realpath(readable),
      },
    });
    expect(result.value.parameters).not.toHaveProperty("application_root");
    expect(result.value.normalized_result).toMatchObject({
      application: { application_path: canonicalApplication },
    });
  },
);
