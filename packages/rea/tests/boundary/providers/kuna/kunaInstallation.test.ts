import { createHash } from "node:crypto";
import {
  chmod,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it as test } from "vitest";

import { kunaInstallationCancellation } from "../../../../src/kuna/KunaInstallation.js";
import { readKunaConfiguration } from "../../../../src/kuna/KunaConfiguration.js";
import { inspectKunaInstallationOwned as inspectKunaInstallation } from "./kunaResourceScope.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { fakeKunaCalls, writeFakeKuna } from "./fakeKuna.js";
import { makeLauncher, ownedGroupCleanup } from "./kunaVersionProbeProcess.js";

const it = test.skipIf(process.platform === "win32");

it("identifies a caller-selected kuna by version and digest", async () => {
  const root = await createTestTempDirectory("rea-kuna-install-");
  const kuna = await writeFakeKuna(root, {
    version: { stdout: "kuna 1.986\n" },
  });
  const link = join(root, "current-kuna");
  await symlink(kuna, link);

  const result = await inspectKunaInstallation({
    REA_KUNA_COMMAND: link,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  });

  expect(result).toMatchObject({
    ok: true,
    value: {
      configuration: { command: link, cacheRoot: join(root, "cache") },
      executable: await realpath(kuna),
      version: "1.986",
      verified: true,
      // A `#!` launcher reports its interpreter; ownership checks must not expect the path.
      script: true,
      sha256: createHash("sha256")
        .update(await readFile(kuna))
        .digest("hex"),
    },
  });
  // The probe runs inside REA's cache home with no inherited PATH.
  expect(await fakeKunaCalls(kuna)).toEqual([
    {
      pid: expect.any(Number),
      at: expect.any(Number),
      argv: ["--version"],
      home: join(root, "cache", "home"),
      xdg: join(root, "cache", "home", ".cache"),
      path: null,
    },
  ]);
});

it("refuses to pair version output with executable bytes replaced during the probe", async () => {
  const root = await createTestTempDirectory(
    "rea-kuna-replaced-during-version-",
  );
  const kuna = join(root, "kuna");
  const replacement = `#!${process.execPath}\nconsole.log("kuna 1.900");\n`;
  const source = `#!${process.execPath}
const fs = require("node:fs");
const replacement = ${JSON.stringify(replacement)};
console.log("kuna 1.833");
fs.writeFileSync(process.argv[1] + ".new", replacement, { mode: 0o700 });
fs.renameSync(process.argv[1] + ".new", process.argv[1]);
`;
  await writeFile(kuna, source, { mode: 0o700 });
  await chmod(kuna, 0o700);
  const before = await readFile(kuna);

  const result = await inspectKunaInstallation({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  });
  const after = await readFile(kuna);

  expect(createHash("sha256").update(after).digest("hex")).not.toBe(
    createHash("sha256").update(before).digest("hex"),
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "version_unresolved",
      diagnostics: {
        installation_identity_changed: true,
        version: "1.833",
        before_sha256: createHash("sha256").update(before).digest("hex"),
        after_sha256: createHash("sha256").update(after).digest("hex"),
        before_bytes: before.length,
        after_bytes: after.length,
      },
    },
  });
});

it("accepts another release but reports it as unverified", async () => {
  const root = await createTestTempDirectory("rea-kuna-unverified-");
  const kuna = await writeFakeKuna(root, {
    version: { stdout: "kuna 1.833\n" },
  });

  const result = await inspectKunaInstallation({ REA_KUNA_COMMAND: kuna });

  expect(result).toMatchObject({
    ok: true,
    value: { version: "1.833", verified: false },
  });
});

it("refuses a version line it cannot recognize", async () => {
  const root = await createTestTempDirectory("rea-kuna-garbled-");
  const kuna = await writeFakeKuna(root, {
    version: { stdout: "Kuna decompiler, built today\n" },
  });

  expect(
    await inspectKunaInstallation({ REA_KUNA_COMMAND: kuna }),
  ).toMatchObject({
    ok: false,
    error: {
      code: "version_unresolved",
      diagnostics: { stdout: "Kuna decompiler, built today\n" },
    },
  });
});

it("reports a failed version probe with its exit status", async () => {
  const root = await createTestTempDirectory("rea-kuna-probe-exit-");
  const kuna = await writeFakeKuna(root, { version: { exit: 3 } });

  expect(
    await inspectKunaInstallation({ REA_KUNA_COMMAND: kuna }),
  ).toMatchObject({
    ok: false,
    error: {
      code: "version_unresolved",
      reason: expect.stringContaining("version probe failed"),
      diagnostics: { exit_code: 3, probe_failure_reason: "process" },
    },
  });
});

it("reports a missing or non-executable command as executable_missing", async () => {
  const root = await createTestTempDirectory("rea-kuna-missing-");
  const kuna = await writeFakeKuna(root);
  await chmod(kuna, 0o644);

  for (const command of [kuna, join(root, "absent"), root])
    expect(
      await inspectKunaInstallation({ REA_KUNA_COMMAND: command }),
    ).toMatchObject({
      ok: false,
      error: { code: "executable_missing", diagnostics: { command } },
    });
});

it("distinguishes an unset command from an invalid one", async () => {
  expect(await inspectKunaInstallation({})).toMatchObject({
    ok: false,
    error: { code: "not_configured", diagnostics: { configured: false } },
  });
  expect(
    await inspectKunaInstallation({ REA_KUNA_COMMAND: "bin/kuna" }),
  ).toMatchObject({
    ok: false,
    error: {
      code: "open_options_invalid",
      diagnostics: { configured: true, setting: "REA_KUNA_COMMAND" },
    },
  });
});

it("declares Windows hosts unsupported before touching the command", async () => {
  expect(
    await inspectKunaInstallation(
      { REA_KUNA_COMMAND: "/opt/kuna/kuna" },
      { platform: "win32" },
    ),
  ).toMatchObject({ ok: false, error: { code: "unsupported_host" } });
});

it("parses cache, timeout and job settings at the configuration boundary", () => {
  const environment = {
    REA_KUNA_COMMAND: "/opt/kuna/kuna",
    HOME: "/home/analyst",
  };
  expect(readKunaConfiguration(environment, "linux")).toMatchObject({
    ok: true,
    value: {
      cacheRoot: "/home/analyst/.cache/rea/kuna",
      cacheMaxBytes: 4 * 1024 ** 3,
      projectTimeoutMs: 1_800_000,
      functionTimeoutMs: 120_000,
      // Kuna's reference answer is a serial export; more jobs change results.
      jobs: 1,
    },
  });
  expect(
    readKunaConfiguration(
      { ...environment, XDG_CACHE_HOME: "/var/cache/analyst" },
      "linux",
    ),
  ).toMatchObject({ value: { cacheRoot: "/var/cache/analyst/rea/kuna" } });
  expect(readKunaConfiguration(environment, "darwin")).toMatchObject({
    value: { cacheRoot: "/home/analyst/Library/Caches/rea/kuna" },
  });
  expect(
    readKunaConfiguration(
      {
        ...environment,
        REA_KUNA_CACHE_MAX_BYTES: "2097152",
        REA_KUNA_PROJECT_TIMEOUT_MS: "60000",
        REA_KUNA_TIMEOUT_MS: "5000",
        REA_KUNA_JOBS: "3",
      },
      "linux",
    ),
  ).toMatchObject({
    value: {
      cacheMaxBytes: 2097152,
      projectTimeoutMs: 60000,
      functionTimeoutMs: 5000,
      jobs: 3,
    },
  });
  for (const [setting, value] of [
    ["REA_KUNA_CACHE_DIR", "relative/cache"],
    ["REA_KUNA_CACHE_MAX_BYTES", "1024"],
    ["REA_KUNA_CACHE_MAX_BYTES", "4GiB"],
    ["REA_KUNA_PROJECT_TIMEOUT_MS", "0"],
    ["REA_KUNA_TIMEOUT_MS", "-1"],
    ["REA_KUNA_JOBS", "33"],
    ["REA_KUNA_JOBS", "0"],
  ] as const)
    expect(
      readKunaConfiguration({ ...environment, [setting]: value }, "linux"),
    ).toMatchObject({
      ok: false,
      error: { code: "open_options_invalid", setting },
    });
});

it("stops a version probe that ignores SIGTERM instead of waiting on it", async () => {
  const root = await createTestTempDirectory("rea-kuna-probe-term-");
  const kuna = await writeFakeKuna(root, { version: { ignoreTerm: true } });
  const started = Date.now();

  const result = await inspectKunaInstallation(
    { REA_KUNA_COMMAND: kuna },
    // Allow owned-process identity preparation, then exercise the stopped child.
    { probeTimeoutMs: 4_000 },
  );

  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "version_unresolved",
      diagnostics: {
        probe_failure_reason: "timeout",
        deadline_ms: 4_000,
      },
    },
  });
  // The owned process-group stop is bounded and must not wait on inherited output forever.
  expect(Date.now() - started).toBeLessThan(10_000);
  const pid = (await fakeKunaCalls(kuna))[0]?.pid ?? 0;
  expect(() => process.kill(pid, 0)).toThrow();
}, 20_000);

it("keeps a version deadline ahead of cancellation during its joined stop", async () => {
  const root = await createTestTempDirectory("rea-kuna-deadline-first-");
  const command = join(root, "probe.cjs");
  const stopped = join(root, "stopped");
  const release = join(root, "release");
  const launcher = makeLauncher(async (_child, pid) => {
    process.kill(-pid, "SIGTERM");
    const waitFor = async (path: string) => {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        try {
          await readFile(path);
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      throw new Error(`Timed out waiting for ${path}`);
    };
    await waitFor(stopped);
    await waitFor(release);
    return ownedGroupCleanup(pid);
  });
  await (
    await import("node:fs/promises")
  ).writeFile(
    command,
    `#!${process.execPath}
const fs = require("node:fs");
process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(stopped)}, "timeout stop"));
const gate = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(gate); process.exit(0); }
}, 5);
setTimeout(() => process.exit(9), 10000).unref();
`,
    { mode: 0o700 },
  );
  const controller = new AbortController();
  const pending = inspectKunaInstallation(
    {
      REA_KUNA_COMMAND: command,
      REA_KUNA_CACHE_DIR: join(root, "cache"),
    },
    {
      signal: controller.signal,
      probeTimeoutMs: 1_000,
      processLauncher: launcher.launcher,
    },
  );
  const outcome = pending.then(
    (value) => ({ kind: "result" as const, value }),
    (cause: unknown) => ({ kind: "thrown" as const, cause }),
  );
  try {
    await expect
      .poll(
        () =>
          readFile(stopped).then(
            () => true,
            () => false,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
    controller.abort({ request: "late doctor cancellation" });
    await writeFile(release, "release");
    expect(await outcome).toMatchObject({
      kind: "result",
      value: {
        ok: false,
        error: {
          code: "version_unresolved",
          diagnostics: {
            deadline_ms: 1000,
            probe_failure_reason: "timeout",
          },
        },
      },
    });
  } finally {
    await writeFile(release, "release");
    await outcome;
  }
});

it("retains an admitted lookup failure when cancellation arrives during settlement", async () => {
  const root = await createTestTempDirectory("rea-kuna-lookup-failure-");
  const command = join(root, "missing-kuna");
  const controller = new AbortController();
  const pending = inspectKunaInstallation(
    {
      REA_KUNA_COMMAND: command,
      REA_KUNA_CACHE_DIR: join(root, "cache"),
    },
    { signal: controller.signal },
  );
  controller.abort({ request: "cancel in-flight lookup" });
  const outcome = await pending.then(
    (value) => ({ kind: "result" as const, value }),
    (cause: unknown) => ({ kind: "thrown" as const, cause }),
  );
  expect(outcome).toMatchObject({
    kind: "result",
    value: {
      ok: false,
      error: { code: "executable_missing", diagnostics: { command } },
    },
  });
});

it("preserves an already-cancelled caller before admitting a lookup", async () => {
  const root = await createTestTempDirectory("rea-kuna-preabort-lookup-");
  const controller = new AbortController();
  const reason = { request: "cancel before lookup" };
  controller.abort(reason);
  const cause: unknown = await inspectKunaInstallation(
    {
      REA_KUNA_COMMAND: join(root, "missing-kuna"),
      REA_KUNA_CACHE_DIR: join(root, "cache"),
    },
    { signal: controller.signal },
  ).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(kunaInstallationCancellation(cause)?.reason).toBe(reason);
});

it.each(["darwin", "linux"] as const)(
  "preserves native traversal in default cache roots on %s",
  (platform) => {
    const home = "/workspace/alias/../home";
    const environment = { REA_KUNA_COMMAND: "/tools/kuna", HOME: home };
    const configured = readKunaConfiguration(environment, platform);
    expect(configured).toMatchObject({
      value: {
        cacheRoot:
          platform === "darwin"
            ? `${home}/Library/Caches/rea/kuna`
            : `${home}/.cache/rea/kuna`,
      },
    });
    if (platform === "linux")
      expect(
        readKunaConfiguration(
          { ...environment, XDG_CACHE_HOME: "/workspace/alias/../cache" },
          platform,
        ),
      ).toMatchObject({
        value: { cacheRoot: "/workspace/alias/../cache/rea/kuna" },
      });
  },
);
