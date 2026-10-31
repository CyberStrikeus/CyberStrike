import { lstat, mkdir, readlink, symlink, writeFile } from "node:fs/promises";
import { join, sep as separator } from "node:path";

import { expect, it as test } from "vitest";

import { inspectKunaProviderOwned as inspectKunaProvider } from "./kunaResourceScope.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { fakeKunaCalls, writeFakeKuna } from "./fakeKuna.js";
import { createSystemDoctorHost } from "../../../../src/doctorRuntime.js";
import { runDoctorOwned } from "../../../../src/application/Doctor.js";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import { STARTUP_OWNER_CLOSED } from "../../../../src/process/SharedStartupAttempt.js";

const it = test.skipIf(process.platform === "win32");

it("reports an unconfigured Kuna as a missing optional engine", async () => {
  expect(await inspectKunaProvider({})).toMatchObject({
    id: "kuna",
    configured: false,
    available: false,
    providerVersion: null,
    registrationEnvironment: {},
    checks: [
      {
        name: "installation",
        ok: false,
        code: "not_configured",
        classification: "missing_analysis_engine",
      },
    ],
  });
});

it("publishes the caller's explicit settings once the installation validates", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-");
  const kuna = await writeFakeKuna(root, {
    version: { stdout: "kuna 1.986\n" },
  });
  const cache = join(root, "cache");

  const inspection = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: cache,
    REA_KUNA_JOBS: "4",
    UNRELATED: "not published",
  });

  expect(inspection).toMatchObject({
    configured: true,
    available: true,
    providerVersion: "1.986",
    registrationEnvironment: {
      REA_KUNA_COMMAND: kuna,
      REA_KUNA_CACHE_DIR: cache,
      REA_KUNA_JOBS: "4",
    },
    checks: [
      {
        name: "installation",
        ok: true,
        detail: expect.stringMatching(
          /reports Kuna 1\.986 \(sha256 [a-f0-9]{64}\)\.$/u,
        ),
        remediation: null,
        details: { version: "1.986", verified_version: "1.986" },
      },
      {
        name: "cache",
        ok: true,
        detail: `REA creates the Kuna project cache at ${cache} on first use.`,
      },
    ],
  });
  expect(Object.keys(inspection.registrationEnvironment)).toHaveLength(3);
});

it("flags an unverified release without failing the installation", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-version-");
  const kuna = await writeFakeKuna(root, {
    version: { stdout: "kuna 1.950\n" },
  });

  const inspection = await inspectKunaProvider({ REA_KUNA_COMMAND: kuna });

  expect(inspection.checks[0]).toMatchObject({
    ok: true,
    detail: expect.stringContaining(
      "You may continue with the selected unverified release.",
    ),
    remediation: expect.stringContaining("setting REA_KUNA_COMMAND"),
    details: { verified_version: "1.986" },
  });
});

it("reports a cache root REA cannot use without creating anything", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-cache-");
  const kuna = await writeFakeKuna(root);
  const occupied = join(root, "occupied");
  await writeFile(occupied, "not a directory");
  const existing = join(root, "existing");
  await mkdir(existing);

  const blocked = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: occupied,
  });
  const ready = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: existing,
  });

  expect(blocked.available).toBe(false);
  expect(blocked.checks[0]).toMatchObject({ name: "installation", ok: true });
  expect(blocked.checks[1]).toMatchObject({
    name: "cache",
    ok: false,
    code: "open_options_invalid",
  });
  expect(blocked.registrationEnvironment).toMatchObject({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: occupied,
  });
  expect(ready.checks[1]).toMatchObject({
    name: "cache",
    ok: true,
    detail: expect.stringContaining(`cached in ${existing}`),
  });
});

it("reports a cache root REA cannot create under its nearest existing parent", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-create-");
  const kuna = await writeFakeKuna(root);
  const readOnly = join(root, "read-only");
  await mkdir(readOnly, { mode: 0o500 });
  const occupied = join(root, "occupied");
  await writeFile(occupied, "not a directory");

  const underReadOnly = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(readOnly, "nested", "cache"),
  });
  const underFile = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(occupied, "cache"),
  });

  expect(underReadOnly.checks[1]).toMatchObject({
    name: "cache",
    ok: false,
    detail: expect.stringContaining(`${readOnly} is not writable`),
  });
  expect(underFile.checks[1]).toMatchObject({
    name: "cache",
    ok: false,
    // stat reports ENOTDIR for a path beneath a regular file.
    detail: expect.stringContaining("not a directory"),
  });
});

it("reports a dangling cache link as unusable and accepts a resolving link", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-link-");
  const kuna = await writeFakeKuna(root);
  const dangling = join(root, "dangling");
  const missing = join(root, "missing-target");
  await symlink(missing, dangling);
  const target = join(root, "target");
  await mkdir(target);
  const resolving = join(root, "resolving");
  await symlink(target, resolving);

  const direct = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: dangling,
  });
  const trailing = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: `${dangling}${separator}`,
  });
  const beneath = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(dangling, "nested", "cache"),
  });
  const ready = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: resolving,
  });
  const readyTrailing = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: `${resolving}${separator}`,
  });

  for (const blocked of [direct, trailing, beneath]) {
    expect(blocked.available).toBe(false);
    expect(blocked.checks[1]).toMatchObject({
      name: "cache",
      ok: false,
      code: "open_options_invalid",
      detail: expect.stringContaining(
        `${dangling} is a symbolic link whose target does not exist.`,
      ),
    });
  }
  expect(trailing.checks[1]).toMatchObject({
    detail: expect.stringContaining(`${dangling}${separator}`),
    details: { cache_root: `${dangling}${separator}` },
  });
  for (const usable of [ready, readyTrailing]) {
    expect(usable.available).toBe(true);
    expect(usable.checks[1]).toMatchObject({
      name: "cache",
      ok: true,
      detail: expect.stringContaining("cached in"),
    });
  }
  expect(ready.checks[1]?.detail).toContain(resolving);
  // Diagnosis neither creates the cache nor repairs the link.
  expect(await readlink(dangling)).toBe(missing);
  await expect(lstat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(dangling, "nested"))).rejects.toThrow();
});

it("keeps a trailing backslash as part of a POSIX cache path", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-backslash-");
  const kuna = await writeFakeKuna(root);
  const directory = join(root, "cache");
  await mkdir(directory);
  const named = `${directory}\\`;
  await writeFile(named, "not-a-directory");

  const inspection = await inspectKunaProvider({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: named,
  });

  expect(inspection.available).toBe(false);
  expect(inspection.checks[1]).toMatchObject({
    name: "cache",
    ok: false,
    code: "open_options_invalid",
    detail: expect.stringContaining(`${named} exists but is not a directory.`),
    details: expect.objectContaining({ cache_root: named }),
  });
  expect((await lstat(directory)).isDirectory()).toBe(true);
  expect((await lstat(named)).isFile()).toBe(true);
});

const doctorEnvironment = (root: string, kuna: string): NodeJS.ProcessEnv => ({
  HOME: root,
  PATH: "",
  JAVA_HOME: join(root, "missing-jdk"),
  GHIDRA_INSTALL_DIR: join(root, "missing-ghidra"),
  REA_KUNA_COMMAND: kuna,
  REA_KUNA_CACHE_DIR: join(root, "cache"),
});

// Exercise the production composition, not just Kuna's installation helper:
// both the caller signal and the host's own close signal must reach the probe.
it.each(["caller", "host"] as const)(
  "cancels and joins the composed Kuna doctor probe on %s cancellation",
  async (source) => {
    const root = await createTestTempDirectory("rea-kuna-doctor-cancel-");
    const gate = join(root, "release-version");
    const kuna = await writeFakeKuna(root, {
      version: { stdout: "kuna 1.833\n", gate },
    });
    const controller = new AbortController();
    const reason = { request: "cancel Kuna doctor" };
    const host = createSystemDoctorHost(
      doctorEnvironment(root, kuna),
      controller.signal,
    );
    let settled = false;
    const inspection = host.providerInspections!().then(
      () => {
        settled = true;
        return undefined;
      },
      (cause: unknown) => {
        settled = true;
        return cause;
      },
    );
    let closing: ReturnType<NonNullable<typeof host.close>> | undefined;
    try {
      // The preceding Ghidra probe may prepare Darwin process ownership before
      // Kuna starts; keep startup separate from the bounded post-abort join.
      await expect
        .poll(async () => (await fakeKunaCalls(kuna)).length, {
          timeout: 10_000,
        })
        .toBe(1);
      const probe = (await fakeKunaCalls(kuna))[0];
      if (probe === undefined) throw new Error("Missing Kuna version probe");
      expect(probe.argv).toEqual(["--version"]);
      if (source === "caller") controller.abort(reason);
      else closing = host.close!();
      // The unreleased probe normally waits for its ten-second deadline.
      await expect.poll(() => settled, { timeout: 2_000 }).toBe(true);
      const failure = await inspection;
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (!(failure instanceof AnalysisCancelledError))
        throw new Error("Expected Kuna inspection cancellation");
      expect(failure.operation).toBe("doctor");
      expect(failure.cause).toBe(
        source === "caller" ? reason : STARTUP_OWNER_CLOSED,
      );
      // Cancellation only settles once execFile has reaped its direct child.
      expect(() => process.kill(probe.pid, 0)).toThrowError(
        expect.objectContaining({ code: "ESRCH" }),
      );
      await closing;
      expect(await fakeKunaCalls(kuna)).toHaveLength(1);
    } finally {
      await writeFile(gate, "release");
      await inspection;
      await closing;
      await host.close!();
    }
  },
);

it("does not launch the composed Kuna probe for an already cancelled caller", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-preabort-");
  const kuna = await writeFakeKuna(root);
  const controller = new AbortController();
  controller.abort({ request: "cancel before inspection" });
  const host = createSystemDoctorHost(
    doctorEnvironment(root, kuna),
    controller.signal,
  );
  try {
    await expect(host.providerInspections!()).rejects.toBeDefined();
    expect(await fakeKunaCalls(kuna)).toEqual([]);
  } finally {
    await host.close!();
  }
});

it("keeps a healthy composed Kuna inspection when the caller stays active", async () => {
  const root = await createTestTempDirectory("rea-kuna-doctor-active-");
  const kuna = await writeFakeKuna(root);
  const host = createSystemDoctorHost(
    doctorEnvironment(root, kuna),
    new AbortController().signal,
  );
  try {
    expect(await host.providerInspections!()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "kuna",
          available: true,
          providerVersion: "1.833",
        }),
      ]),
    );
    expect(await fakeKunaCalls(kuna)).toHaveLength(1);
  } finally {
    await host.close!();
  }
});

it("projects the fake Kuna through the completed doctor workflow", async () => {
  const root = await createTestTempDirectory("rea-kuna-public-doctor-");
  const kuna = await writeFakeKuna(root);
  const host = createSystemDoctorHost(
    doctorEnvironment(root, kuna),
    new AbortController().signal,
  );
  try {
    const report = await runDoctorOwned(undefined, host, {
      providers: ["kuna"],
      skill: false,
      clients: [],
    });
    expect(report.providerInspections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "kuna",
          available: true,
          providerVersion: "1.833",
          checks: expect.arrayContaining([
            expect.objectContaining({ name: "installation", ok: true }),
          ]),
        }),
      ]),
    );
    expect(await fakeKunaCalls(kuna)).toHaveLength(1);
  } finally {
    await host.close!();
  }
});

it.each([
  ["REA_KUNA_CACHE_DIR", "relative"],
  ["REA_KUNA_CACHE_MAX_BYTES", "0"],
  ["REA_KUNA_PROJECT_TIMEOUT_MS", "0"],
  ["REA_KUNA_TIMEOUT_MS", "0"],
  ["REA_KUNA_JOBS", "33"],
] as const)(
  "recommends repairing %s without replacing a valid executable",
  async (setting, value) => {
    const root = await createTestTempDirectory("rea-kuna-setting-remediation-");
    const command = join(root, "caller-kuna");
    const inspection = await inspectKunaProvider({
      REA_KUNA_COMMAND: command,
      [setting]: value,
    });
    expect(inspection.available).toBe(false);
    expect(inspection.checks[0]).toMatchObject({
      code: "open_options_invalid",
      classification: "config_drift",
      details: { setting },
      remediation: expect.stringContaining(`Correct ${setting}`),
    });
    expect(inspection.checks[0]?.remediation).not.toContain("REA_KUNA_COMMAND");
    await expect(lstat(command)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
