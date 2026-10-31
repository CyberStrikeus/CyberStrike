import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron as electron } from "playwright-core";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  createSystemProcessOwnershipHost,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import {
  createDarwinProcessRunTokenReader,
  DarwinProcessOwnershipInspectionError,
  SWIFTC_INTERRUPT,
  swiftcCompileTimeoutRecovery,
} from "../../../src/process/DarwinProcessRunTokenReader.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import {
  normalizeCaptureFailure,
  ProcessCaptureError,
} from "../../../src/process/capture/ProcessCaptureError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { PlaywrightElectronActiveProvider } from "../../../src/browser/PlaywrightElectronActiveProvider.js";
import { electronActiveObservationInputSchema } from "../../../src/domain/javascript/electronActiveObservation.js";

const execFileAsync = promisify(execFile);
const onDarwin = process.platform === "darwin";

// Readiness files are polled by another process; expose only complete JSON.
const publishFixtureStateSource = `
const publishFixtureState = (file, value) => {
  const pending = file + "." + process.pid + ".pending";
  fs.writeFileSync(pending, JSON.stringify(value));
  fs.renameSync(pending, file);
};
`;

const writeBlockingCompiler = async (directory: string) => {
  const executable = join(directory, "fake-xcrun");
  const statePath = join(directory, "compile-state.json");
  const releasePath = join(directory, "release-compiler");
  const source = `#!/usr/bin/env node
const fs = process.getBuiltinModule("node:fs");
${publishFixtureStateSource}
const path = process.getBuiltinModule("node:path");
const statePath = ${JSON.stringify(statePath)};
const releasePath = ${JSON.stringify(releasePath)};
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf8"))
  : { calls: 0 };
state.calls += 1;
const outputIndex = process.argv.indexOf("-o");
state.output = process.argv[outputIndex + 1];
state.root = path.dirname(state.output);
state.arguments = process.argv.slice(2);
state.releasePath = releasePath;
publishFixtureState(statePath, state);
if (state.calls === 1) {
  const timer = setInterval(() => {
    if (!fs.existsSync(releasePath)) return;
    clearInterval(timer);
    fs.writeFileSync(state.output, "compiled");
  }, 10);
} else {
  fs.writeFileSync(state.output, "compiled");
}
`;
  await writeFile(executable, source);
  await chmod(executable, 0o755);
  return { executable, statePath, releasePath };
};

const writeBlockingIdentityCompiler = async (directory: string) => {
  const executable = join(directory, "fake-identity-xcrun");
  const statePath = join(directory, "identity-helper-state.json");
  const helperSource = `#!/usr/bin/env node
const fs = process.getBuiltinModule("node:fs");
${publishFixtureStateSource}
publishFixtureState(${JSON.stringify(statePath)}, {
  root: process.getBuiltinModule("node:path").dirname(fs.realpathSync(process.argv[1])),
});
setInterval(() => {}, 1000);
`;
  const compilerSource = `#!/usr/bin/env node
const fs = process.getBuiltinModule("node:fs");
const outputIndex = process.argv.indexOf("-o");
const output = process.argv[outputIndex + 1];
fs.writeFileSync(output, ${JSON.stringify(helperSource)});
fs.chmodSync(output, 0o755);
`;
  await writeFile(executable, compilerSource);
  await chmod(executable, 0o755);
  return { executable, statePath };
};

const waitForCompileState = async (statePath: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "calls" in parsed &&
        typeof parsed.calls === "number" &&
        "root" in parsed &&
        typeof parsed.root === "string" &&
        "output" in parsed &&
        typeof parsed.output === "string" &&
        "releasePath" in parsed &&
        typeof parsed.releasePath === "string"
      )
        return {
          calls: parsed.calls,
          root: parsed.root,
          output: parsed.output,
          releasePath: parsed.releasePath,
          arguments:
            "arguments" in parsed && Array.isArray(parsed.arguments)
              ? parsed.arguments
              : [],
        };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("fake compiler did not start");
};

const waitForIdentityHelper = async (statePath: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "root" in parsed &&
        typeof parsed.root === "string"
      )
        return { root: parsed.root };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("fake identity helper did not start");
};

type ElectronCaptureResult = Awaited<
  ReturnType<PlaywrightElectronActiveProvider["capture"]>
>;
type ElectronCaptureOutcome =
  | { readonly state: "result"; readonly value: ElectronCaptureResult }
  | { readonly state: "rejected"; readonly cause: unknown };

it("reports an actionable missing Swift compiler without installing it", async () => {
  const reader = createDarwinProcessRunTokenReader({
    compiler: {
      kind: "xcrun",
      executable: join(tmpdir(), "rea-no-such-xcrun"),
    },
  });
  try {
    await expect(
      reader.read([
        {
          pid: 1,
          parentPid: 0,
          processGroupId: 1,
          state: "S",
          command: "fixture",
        },
      ]),
    ).rejects.toThrow(/requires the Apple Swift compiler via xcrun/u);
  } finally {
    await reader.close();
  }
});

const preparationFailure = async (
  reader: ReturnType<typeof createDarwinProcessRunTokenReader>,
): Promise<DarwinProcessOwnershipInspectionError> => {
  const cause = await reader.prepare().then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(cause).toBeInstanceOf(DarwinProcessOwnershipInspectionError);
  return cause as DarwinProcessOwnershipInspectionError;
};

it.skipIf(process.platform === "win32")(
  "reports the compiler exit code with its diagnostics when preparation fails",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-compiler-failure-test-",
    );
    const executable = join(directory, "failing-xcrun");
    await writeFile(
      executable,
      '#!/usr/bin/env node\nprocess.stderr.write("module cache is not writable\\n" + "x".repeat(12000)); process.exitCode = 1;\n',
    );
    await chmod(executable, 0o755);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: executable },
    });
    try {
      const failure = await preparationFailure(reader);
      expect(failure.compilerOutcome).toMatchObject({
        outcome: "exited",
        code: 1,
        signal: null,
        stderr: expect.stringMatching(/^module cache is not writable\n/u),
        stderrTruncated: true,
        killed: false,
      });
      expect(failure.message).toContain(
        "(compiler result: exit code 1): module cache is not writable",
      );
      expect(failure.message).toContain(
        "[diagnostics truncated at 512 bytes; this release has no runtime override]",
      );
      const normalized = normalizeCaptureFailure(failure, undefined);
      if (!(normalized instanceof ProcessCaptureError))
        throw new Error("Expected a normalized process capture error");
      expect(projectAnalysisError(normalized)).toMatchObject({
        code: "process_capture_failed",
        details: {
          execution_failure: expect.stringContaining(
            "compiler result: exit code 1",
          ),
          captured_output: {
            stderr: expect.stringContaining("module cache is not writable"),
            exit_code: 1,
            truncated: true,
          },
        },
      });
    } finally {
      await reader.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reports compiler diagnostics captured before the compilation deadline",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-compiler-timeout-test-",
    );
    const executable = join(directory, "hanging-xcrun");
    await writeFile(
      executable,
      '#!/usr/bin/env node\nprocess.stderr.write("error: PCH was compiled with module cache path that differs\\n", () => { setInterval(() => {}, 1000); });\n',
    );
    await chmod(executable, 0o755);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: executable },
      // Headroom for the child interpreter's cold start under suite load.
      compileTimeoutMs: 3_000,
    });
    try {
      const failure = await preparationFailure(reader);
      expect(failure.message).toContain(
        "macOS process ownership helper compilation failed via xcrun (compiler result: timed out after 3000 ms.",
      );
      expect(failure.message).toContain(swiftcCompileTimeoutRecovery(3_000));
      expect(failure.message).toContain(
        "error: PCH was compiled with module cache path that differs",
      );
      expect(failure.compilerOutcome).toMatchObject({
        outcome: "timed_out",
        code: "ETIMEDOUT",
        timeoutMs: 3_000,
      });
    } finally {
      await reader.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reports the stop signal when the compiler dies without an exit code",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-compiler-signal-test-",
    );
    const executable = join(directory, "segv-xcrun");
    await writeFile(
      executable,
      '#!/usr/bin/env node\nprocess.stderr.write("fatal: segmentation fault during type checking\\n");\nprocess.kill(process.pid, "SIGSEGV");\n',
    );
    await chmod(executable, 0o755);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: executable },
    });
    try {
      await expect(preparationFailure(reader)).resolves.toMatchObject({
        message:
          "macOS process ownership helper compilation failed via xcrun (compiler result: stopped by signal SIGSEGV): fatal: segmentation fault during type checking",
        compilerOutcome: {
          outcome: "signaled",
          code: null,
          signal: "SIGSEGV",
        },
      });
    } finally {
      await reader.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "bounds embedded compiler diagnostics and marks the truncation",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-compiler-verbose-test-",
    );
    const executable = join(directory, "verbose-xcrun");
    const diagnostic = "x".repeat(600);
    await writeFile(
      executable,
      `#!/usr/bin/env node\nprocess.stderr.write(${JSON.stringify(`${diagnostic}\n`)}); process.exitCode = 1;\n`,
    );
    await chmod(executable, 0o755);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: executable },
    });
    try {
      const failure = await preparationFailure(reader);
      const outcome = failure.compilerOutcome;
      if (outcome === undefined) throw new Error("Expected compiler outcome");
      expect(outcome.stderrBytes).toBe(601);
      expect(outcome.stderrTruncated).toBe(false);
      expect(failure.message).toContain(
        `: ${"x".repeat(512)}… [diagnostics truncated at 512 bytes; this release has no runtime override]`,
      );
      const excerpt = failure.message.split("): ")[1]?.split("…")[0];
      expect(excerpt).toBe("x".repeat(512));
      expect(Buffer.byteLength(excerpt ?? "", "utf8")).toBeLessThanOrEqual(512);
      expect(Buffer.byteLength(outcome.stderr, "utf8")).toBeLessThanOrEqual(
        8 * 1024,
      );
    } finally {
      await reader.close();
    }
  },
);

it
  .skipIf(!onDarwin || process.getuid?.() === 0)
  .each(["file", "read-only directory"])(
  "ignores unusable inherited Swift module cache: %s",
  async (kind) => {
    const directory = await createTestTempDirectory(
      "rea-process-token-inherited-cache-test-",
    );
    const cacheParent = join(directory, "cache-parent");
    if (kind === "file") await writeFile(cacheParent, "not a directory");
    else {
      await mkdir(cacheParent);
      await chmod(cacheParent, 0o500);
    }
    const cachePath = join(cacheParent, "modules");
    vi.stubEnv("CLANG_MODULE_CACHE_PATH", cachePath);
    const reader = createDarwinProcessRunTokenReader();
    try {
      const executable = await reader.prepare();
      const { stdout } = await execFileOutput(
        executable,
        ["--identities", String(process.pid)],
        { timeout: 15_000 },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        results: [{ pid: process.pid, state: "readable" }],
      });
      expect(process.env.CLANG_MODULE_CACHE_PATH).toBe(cachePath);
    } finally {
      vi.unstubAllEnvs();
      if (kind === "read-only directory") await chmod(cacheParent, 0o700);
      await reader.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "uses the compiler-managed module cache instead of rebuilding system modules per REA process",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-module-cache-test-",
    );
    const fakeCompiler = await writeBlockingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const preparation = reader.prepare();
    try {
      const state = await waitForCompileState(fakeCompiler.statePath);
      expect(state.arguments).not.toContain("-module-cache-path");
      await writeFile(fakeCompiler.releasePath, "release");
      await preparation;
    } finally {
      await Promise.all([reader.close(), Promise.allSettled([preparation])]);
    }
  },
);

const writeCacheRecordingCompiler = async (directory: string) => {
  const executable = join(directory, "fake-cache-xcrun");
  const statePath = join(directory, "cache-compile-state.json");
  const source = `#!/usr/bin/env node
const fs = process.getBuiltinModule("node:fs");
${publishFixtureStateSource}
const path = process.getBuiltinModule("node:path");
const flagIndex = process.argv.indexOf("-module-cache-path");
const cache = flagIndex === -1 ? undefined : process.argv[flagIndex + 1];
publishFixtureState(${JSON.stringify(statePath)}, {
  arguments: process.argv.slice(2),
  moduleCacheEnvironment: process.env.CLANG_MODULE_CACHE_PATH ?? null,
});
if (cache !== undefined) {
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, "written-into-cache"), "kept");
}
const output = process.argv[process.argv.indexOf("-o") + 1];
fs.writeFileSync(output, "#!/bin/sh\\nexit 0\\n");
fs.chmodSync(output, 0o755);
`;
  await writeFile(executable, source);
  await chmod(executable, 0o755);
  return { executable, statePath };
};

const readCacheCompileState = async (statePath: string) =>
  JSON.parse(await readFile(statePath, "utf8")) as {
    arguments: string[];
    moduleCacheEnvironment: string | null;
  };

const existsPath = async (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

it
  .skipIf(process.platform === "win32")
  .each([
    "selected environment",
    "selected environment and deadline",
    "default environment",
  ] as const)(
  "captures the compiler and helper environment from %s",
  async (selection) => {
    const directory = await createTestTempDirectory(
      "rea-process-token-selected-environment-",
    );
    const developerDirectory = join(directory, "selected Xcode.app");
    const compileState = join(directory, "compile-environment.json");
    const executable = join(directory, "fixture-xcrun");
    const helper = `#!${process.execPath}
console.log(JSON.stringify({ results: process.argv.slice(2).map(pid => ({
  pid: Number(pid), state: "readable", run_id: process.env.DEVELOPER_DIR,
})) }));
`;
    await writeFile(
      executable,
      `#!${process.execPath}
const fs = process.getBuiltinModule("node:fs");
fs.writeFileSync(${JSON.stringify(compileState)}, JSON.stringify({
  developerDirectory: process.env.DEVELOPER_DIR ?? null,
}));
const output = process.argv[process.argv.indexOf("-o") + 1];
fs.writeFileSync(output, ${JSON.stringify(helper)});
fs.chmodSync(output, 0o755);
`,
      { mode: 0o755 },
    );
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.stubEnv("DEVELOPER_DIR", developerDirectory);
    const environment = { ...process.env };
    const compiler = { kind: "xcrun" as const, executable };
    const reader =
      selection === "default environment"
        ? createDarwinProcessRunTokenReader({ compiler })
        : createSystemProcessOwnershipHost("darwin", environment, {
            darwinCompiler: compiler,
            ...(selection === "selected environment and deadline"
              ? { compileTimeoutMs: 15_000 }
              : {}),
          });
    environment.DEVELOPER_DIR = join(directory, "later caller selection");
    vi.stubEnv("DEVELOPER_DIR", join(directory, "later ambient selection"));
    try {
      await reader.prepare?.(AbortSignal.timeout(15_000));
      expect(JSON.parse(await readFile(compileState, "utf8"))).toEqual({
        developerDirectory,
      });
      const processes = [
        {
          pid: 123,
          parentPid: 1,
          processGroupId: 123,
          state: "S",
          command: "fixture",
        },
      ];
      const observations =
        "read" in reader
          ? await reader.read(processes)
          : await reader.runTokens?.(processes);
      expect(observations?.get(123)).toEqual({
        state: "readable",
        runId: developerDirectory,
      });
    } finally {
      await reader.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "forwards a caller-owned module cache and keeps it after the helper root is removed",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-caller-cache-test-",
    );
    const cachePath = join(directory, "caller", " modules ");
    const fakeCompiler = await writeCacheRecordingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
      moduleCachePath: cachePath,
    });
    let executable: string;
    try {
      executable = await reader.prepare();
    } finally {
      await reader.close();
    }
    const state = await readCacheCompileState(fakeCompiler.statePath);
    const flagIndex = state.arguments.indexOf("-module-cache-path");
    expect(state.arguments[0]).toBe("swiftc");
    expect(flagIndex).toBe(1);
    expect(state.arguments[flagIndex + 1]).toBe(cachePath);
    expect(state.moduleCacheEnvironment).toBe(cachePath);
    expect(await existsPath(join(cachePath, "written-into-cache"))).toBe(true);
    expect(await existsPath(executable)).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "selects the caller module cache through REA_DARWIN_MODULE_CACHE_PATH",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-host-cache-test-",
    );
    const cachePath = join(directory, "from-environment", "modules");
    const fakeCompiler = await writeCacheRecordingCompiler(directory);
    const host = createSystemProcessOwnershipHost(
      "darwin",
      { ...process.env, REA_DARWIN_MODULE_CACHE_PATH: cachePath },
      {
        darwinCompiler: { kind: "xcrun", executable: fakeCompiler.executable },
      },
    );
    try {
      await host.prepare?.(AbortSignal.timeout(15_000));
      const state = await readCacheCompileState(fakeCompiler.statePath);
      const flagIndex = state.arguments.indexOf("-module-cache-path");
      expect(state.arguments[flagIndex + 1]).toBe(cachePath);
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps the shared module cache for the system host without the setting",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-host-default-test-",
    );
    vi.stubEnv("CLANG_MODULE_CACHE_PATH", join(directory, "ambient-cache"));
    const hostEnvironment = { ...process.env };
    delete hostEnvironment.REA_DARWIN_MODULE_CACHE_PATH;
    const fakeCompiler = await writeCacheRecordingCompiler(directory);
    const host = createSystemProcessOwnershipHost("darwin", hostEnvironment, {
      darwinCompiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    try {
      await host.prepare?.(AbortSignal.timeout(15_000));
      const state = await readCacheCompileState(fakeCompiler.statePath);
      expect(state.arguments).not.toContain("-module-cache-path");
      expect(state.moduleCacheEnvironment).toBeNull();
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "bypasses xcrun for an explicitly selected Swift compiler and SDK",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-direct-compiler-",
    );
    const fakeCompiler = await writeCacheRecordingCompiler(directory);
    const sdkRoot = join(directory, "MacOSX.sdk");
    const cachePath = join(directory, "modules");
    const host = createSystemProcessOwnershipHost("darwin", {
      ...process.env,
      REA_DARWIN_SWIFTC_PATH: fakeCompiler.executable,
      SDKROOT: sdkRoot,
      REA_DARWIN_MODULE_CACHE_PATH: cachePath,
    });
    try {
      await host.prepare?.(AbortSignal.timeout(15_000));
      const state = await readCacheCompileState(fakeCompiler.statePath);
      expect(state.arguments.slice(0, 2)).toEqual(["-sdk", sdkRoot]);
      expect(state.arguments).not.toContain("swiftc");
      expect(state.arguments).toContain(cachePath);
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reports the missing SDK prerequisite before starting a direct compiler",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-direct-no-sdk-",
    );
    const fakeCompiler = await writeCacheRecordingCompiler(directory);
    const host = createSystemProcessOwnershipHost("darwin", {
      ...process.env,
      REA_DARWIN_SWIFTC_PATH: fakeCompiler.executable,
      SDKROOT: "",
    });
    try {
      await expect(
        host.prepare?.(AbortSignal.timeout(15_000)),
      ).rejects.toMatchObject({
        name: "DarwinProcessOwnershipInspectionError",
        message: expect.stringContaining("REA_DARWIN_SWIFTC_PATH and SDKROOT"),
      });
      expect(await existsPath(fakeCompiler.statePath)).toBe(false);
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "identifies a missing selected Swift compiler rather than xcrun",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-direct-missing-",
    );
    const host = createSystemProcessOwnershipHost("darwin", {
      ...process.env,
      REA_DARWIN_SWIFTC_PATH: join(directory, "missing-swiftc"),
      SDKROOT: join(directory, "MacOSX.sdk"),
    });
    try {
      await expect(
        host.prepare?.(AbortSignal.timeout(15_000)),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "selected Swift compiler (REA_DARWIN_SWIFTC_PATH)",
        ),
        compilerOutcome: expect.objectContaining({
          outcome: "spawn_failed",
          code: "ENOENT",
        }),
      });
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(!onDarwin)(
  "compiles the helper against the caller cache with the host compiler",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-real-cache-test-",
    );
    const cachePath = join(directory, "caller", "modules");
    const { stdout: compilerPath } = await execFileAsync("/usr/bin/xcrun", [
      "--find",
      "swiftc",
    ]);
    const { stdout: sdkRoot } = await execFileAsync("/usr/bin/xcrun", [
      "--show-sdk-path",
    ]);
    const host = createSystemProcessOwnershipHost("darwin", {
      ...process.env,
      REA_DARWIN_MODULE_CACHE_PATH: cachePath,
      REA_DARWIN_SWIFTC_PATH: compilerPath.trim(),
      SDKROOT: sdkRoot.trim(),
    });
    try {
      await host.prepare?.(AbortSignal.timeout(180_000));
      const current = (await host.listProcesses()).find(
        ({ pid }) => pid === process.pid,
      );
      if (current === undefined)
        throw new Error("Current process missing from host snapshot");
      if (host.processIdentities === undefined)
        throw new Error("Darwin host omitted native identity inspection");
      const identity = (await host.processIdentities([current])).get(
        process.pid,
      );
      expect(identity).toMatchObject({
        state: "readable",
        relation: {
          state: "observed",
          parentPid: process.ppid,
          processGroupId: current.processGroupId,
        },
      });
      if (identity?.state !== "readable")
        throw new Error("Current native identity unavailable");
      expect(identity.identity).not.toBe("");
      expect(
        (await host.processIdentities([current])).get(process.pid),
      ).toMatchObject({
        state: "readable",
        identity: identity.identity,
      });
      const entries = await readdir(cachePath);
      expect(
        entries.some(
          (name) =>
            name.endsWith(".swiftmodule") ||
            name.endsWith(".pcm") ||
            name === "Modules",
        ),
      ).toBe(true);
    } finally {
      await host.close?.();
    }
    expect(await existsPath(join(directory, "caller"))).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "rethrows compile cancellation, removes its temporary root, and permits retry",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-process-token-abort-test-"),
    );
    const fakeCompiler = await writeBlockingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const controller = new AbortController();
    const compilation = reader.prepare(controller.signal).then(
      () => ({ state: "fulfilled" as const }),
      (cause: unknown) => ({ state: "rejected" as const, cause }),
    );
    try {
      const firstAttempt = await waitForCompileState(fakeCompiler.statePath);
      controller.abort();
      const outcome = await compilation;

      expect(outcome.state).toBe("rejected");
      if (outcome.state !== "rejected")
        throw new Error(
          "aborted native reader compilation unexpectedly succeeded",
        );
      expect(outcome.cause).toMatchObject({ name: "AbortError" });
      expect(
        normalizeCaptureFailure(outcome.cause, controller.signal),
      ).toMatchObject({ reason: "cancelled", userCategory: "cancelled" });
      await expect(access(firstAttempt.root)).rejects.toThrow();

      await reader.prepare();
      const retry = await waitForCompileState(fakeCompiler.statePath);
      expect(retry).toMatchObject({ calls: 2 });
      await expect(access(retry.output)).resolves.toBeUndefined();
      await reader.close();
      await expect(access(retry.root)).rejects.toThrow();
    } finally {
      if (!controller.signal.aborted) controller.abort();
      await compilation;
      await reader.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

const temporaryStateSchema = z.object({
  root: z.string(),
  temporary: z.string(),
});

/**
 * A compiler whose detached job closes standard streams but retains fd 3,
 * writes an object after the SIGINT-stopped driver exits, then closes fd 3.
 */
const writeTemporaryObjectCompiler = async (directory: string) => {
  const executable = join(directory, "fake-temporary-xcrun");
  const statePath = join(directory, "temporary-state.json");
  const source = `#!/usr/bin/env node
const fs = process.getBuiltinModule("node:fs");
${publishFixtureStateSource}
const os = process.getBuiltinModule("node:os");
const path = process.getBuiltinModule("node:path");
const { spawn } = process.getBuiltinModule("node:child_process");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "TemporaryDirectory."));
const object = path.join(temporary, "ProcessRunTokenReader-1.o");
let lifetime = "ignore";
try { if (fs.fstatSync(3).isSocket()) lifetime = 3; } catch {}
const job = spawn(process.execPath, ["-e",
  "setTimeout(() => { const fs = process.getBuiltinModule('node:fs'); fs.mkdirSync(" + JSON.stringify(temporary) +
  ", { recursive: true }); fs.writeFileSync(" + JSON.stringify(object) + ", 'object'); }, 300)"],
  { detached: true, stdio: ["ignore", "ignore", "ignore", lifetime] });
job.unref();
process.on("SIGINT", () => {
  process.exit(130);
});
const output = process.argv[process.argv.indexOf("-o") + 1];
publishFixtureState(${JSON.stringify(statePath)}, { root: path.dirname(output), temporary });
setInterval(() => {}, 1000);
`;
  await writeFile(executable, source);
  await chmod(executable, 0o755);
  return { executable, statePath };
};

it.skipIf(process.platform === "win32")(
  "removes cancelled compiler temporaries with the helper root",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-process-token-temporary-test-",
    );
    const compiler = await writeTemporaryObjectCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: compiler.executable },
    });
    const controller = new AbortController();
    const preparation = reader.prepare(controller.signal).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    let temporary: string | undefined;
    try {
      const deadline = Date.now() + 5_000;
      let state: z.infer<typeof temporaryStateSchema> | undefined;
      while (state === undefined && Date.now() < deadline) {
        const parsed = temporaryStateSchema.safeParse(
          await readFile(compiler.statePath, "utf8").then(
            (text): unknown => JSON.parse(text),
            () => undefined,
          ),
        );
        if (parsed.success) state = parsed.data;
        else await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (state === undefined) throw new Error("fake compiler did not start");
      temporary = state.temporary;
      expect(state.temporary.startsWith(`${state.root}/`)).toBe(true);

      controller.abort();
      expect(await preparation).toMatchObject({ name: "AbortError" });
      await reader.close();
      // A job that outlived the compiler would recreate the root by now.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await expect(access(state.root)).rejects.toThrow();
    } finally {
      if (!controller.signal.aborted) controller.abort();
      await preparation;
      await reader.close();
      if (temporary !== undefined)
        await rm(temporary, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32").each(["first", "second"] as const)(
  "keeps shared compilation alive when the %s waiter cancels",
  async (cancelledWaiter) => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-process-token-shared-compile-test-"),
    );
    const fakeCompiler = await writeBlockingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstWaiter = reader.prepare(firstController.signal).then(
      (value) => ({ state: "fulfilled" as const, value }),
      (cause: unknown) => ({ state: "rejected" as const, cause }),
    );
    const secondWaiterPromise = (async () => {
      const state = await waitForCompileState(fakeCompiler.statePath);
      const secondWaiter = reader.prepare(secondController.signal).then(
        (value) => ({ state: "fulfilled" as const, value }),
        (cause: unknown) => ({ state: "rejected" as const, cause }),
      );
      const cancelled =
        cancelledWaiter === "first" ? firstWaiter : secondWaiter;
      const surviving =
        cancelledWaiter === "first" ? secondWaiter : firstWaiter;
      (cancelledWaiter === "first"
        ? firstController
        : secondController
      ).abort();
      const firstOutcome = await cancelled;
      expect(firstOutcome.state).toBe("rejected");
      if (firstOutcome.state !== "rejected")
        throw new Error("cancelled compilation waiter unexpectedly succeeded");
      expect(firstOutcome.cause).toMatchObject({ name: "AbortError" });
      await expect(access(state.root)).resolves.toBeUndefined();
      await writeFile(fakeCompiler.releasePath, "release");
      return { state, outcome: await surviving };
    })();

    try {
      const { state, outcome } = await secondWaiterPromise;
      expect(state.calls).toBe(1);
      expect(outcome.state).toBe("fulfilled");
      if (outcome.state !== "fulfilled") throw outcome.cause;
      expect(outcome.value).toBe(state.output);
      await reader.close();
      await expect(access(state.root)).rejects.toThrow();
    } finally {
      if (!firstController.signal.aborted) firstController.abort();
      if (!secondController.signal.aborted) secondController.abort();
      await Promise.allSettled([firstWaiter, secondWaiterPromise]);
      await reader.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it
  .skipIf(process.platform === "win32" || process.getuid?.() === 0)
  .each(["reader-close", "exact-root"] as const)(
  "retains a failed compilation cleanup for a later %s retry",
  async (retry) => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-process-token-cleanup-retry-test-"),
    );
    const fakeCompiler = await writeBlockingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const controller = new AbortController();
    const preparation = reader.prepare(controller.signal).then(
      () => ({ state: "fulfilled" as const }),
      (cause: unknown) => ({ state: "rejected" as const, cause }),
    );
    let compilationRoot: string | undefined;
    try {
      const state = await waitForCompileState(fakeCompiler.statePath);
      compilationRoot = state.root;
      await writeFile(
        join(state.root, "retained.txt"),
        "cleanup must remain tracked",
      );
      await chmod(state.root, 0o000);
      controller.abort();
      const outcome = await preparation;
      expect(outcome.state).toBe("rejected");
      if (retry === "reader-close") {
        await expect(reader.close()).rejects.toThrow();
        await chmod(state.root, 0o700);
        await reader.close();
      } else {
        if (
          outcome.state !== "rejected" ||
          !(outcome.cause instanceof DarwinProcessOwnershipInspectionError)
        )
          throw new Error("Expected owned compilation cleanup failure");
        const failure = outcome.cause;
        expect(failure.cleanupOwner).toBeDefined();
        expect(failure.cleanupFailure?.cleanupIncomplete).toBe(true);
        await expect(failure.cleanupOwner?.close()).rejects.toThrow();
        await chmod(state.root, 0o700);
        await failure.cleanupOwner?.close();
        expect(failure.cleanupFailure?.cleanupIncomplete).toBe(false);
        // Releasing the failed root does not close the shared reader itself.
        const stopped = new AbortController();
        const reason = { request: "probe reader remains open" };
        stopped.abort(reason);
        await expect(reader.prepare(stopped.signal)).rejects.toBe(reason);
      }
      await expect(access(state.root)).rejects.toThrow();
    } finally {
      if (!controller.signal.aborted) controller.abort();
      await preparation;
      if (compilationRoot !== undefined)
        await chmod(compilationRoot, 0o700).catch(() => undefined);
      await reader.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "aborts and cleans an active compilation when the reader closes",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-process-token-close-compile-test-"),
    );
    const fakeCompiler = await writeBlockingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const preparation = reader.prepare().then(
      () => ({ state: "fulfilled" as const }),
      (cause: unknown) => ({ state: "rejected" as const, cause }),
    );
    try {
      const state = await waitForCompileState(fakeCompiler.statePath);
      await reader.close();
      const outcome = await preparation;
      expect(outcome.state).toBe("rejected");
      if (outcome.state !== "rejected")
        throw new Error("closed reader compilation unexpectedly succeeded");
      expect(outcome.cause).toMatchObject({ name: "AbortError" });
      await expect(access(state.root)).rejects.toThrow();
      await expect(reader.prepare()).rejects.toMatchObject({
        _tag: "ProcessAdmissionError",
        code: "reader_closed",
      });
      await expect(reader.close()).resolves.toBeUndefined();
    } finally {
      await Promise.allSettled([preparation]);
      await reader.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "maps cancellation during native preparation before Electron launch",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-electron-token-abort-test-"),
    );
    const fakeCompiler = await writeBlockingCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const prepareSpy = vi
      .spyOn(systemProcessOwnershipHost, "prepare")
      .mockImplementation(async (signal) => {
        await reader.prepare(signal);
      });
    const launchSpy = vi.spyOn(electron, "launch");
    const controller = new AbortController();
    let captureOutcome: Promise<ElectronCaptureOutcome> | undefined;
    try {
      const input = electronActiveObservationInputSchema.parse({
        executable_path: "/missing/electron",
        application_path: "/missing/application.js",
      });
      captureOutcome = new PlaywrightElectronActiveProvider({})
        .capture(
          { ...input, application_root: process.cwd() },
          { signal: controller.signal },
        )
        .then(
          (value) => ({ state: "result" as const, value }),
          (cause: unknown) => ({ state: "rejected" as const, cause }),
        );
      const compileState = await waitForCompileState(fakeCompiler.statePath);
      controller.abort();
      const outcome = await captureOutcome;

      expect(outcome.state).toBe("result");
      if (outcome.state !== "result") throw outcome.cause;
      expect(outcome.value).toMatchObject({
        ok: false,
        error: { reason: "cancelled", userCategory: "cancelled" },
      });
      expect(launchSpy).not.toHaveBeenCalled();
      await expect(access(compileState.root)).rejects.toThrow();
    } finally {
      if (!controller.signal.aborted) controller.abort();
      if (captureOutcome !== undefined) await captureOutcome;
      prepareSpy.mockRestore();
      launchSpy.mockRestore();
      await reader.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32").each(["baseline", "tokens"] as const)(
  "preserves cancellation through system-host %s inspection",
  async (kind) => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-process-baseline-abort-test-"),
    );
    const fakeCompiler = await writeBlockingIdentityCompiler(directory);
    const host = createSystemProcessOwnershipHost("darwin", process.env, {
      darwinCompiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const controller = new AbortController();
    let helperRoot: string | undefined;
    const inspection =
      kind === "baseline"
        ? host.captureBaseline?.(controller.signal)
        : host.runTokens?.(
            [
              {
                pid: process.pid,
                parentPid: process.ppid,
                processGroupId: process.pid,
                state: "S",
                command: process.execPath,
              },
            ],
            controller.signal,
          );
    const baseline =
      inspection?.then(
        () => ({ state: "fulfilled" as const }),
        (cause: unknown) => ({ state: "rejected" as const, cause }),
      ) ?? Promise.resolve({ state: "missing" as const });
    try {
      if (host.captureBaseline === undefined)
        throw new Error("Darwin host did not expose process baselines");
      const helper = await waitForIdentityHelper(fakeCompiler.statePath);
      helperRoot = helper.root;
      controller.abort();
      const outcome = await baseline;

      expect(outcome.state).toBe("rejected");
      if (outcome.state !== "rejected")
        throw new Error("aborted identity inspection unexpectedly succeeded");
      expect(outcome.cause).toMatchObject({ name: "AbortError" });
      expect(
        normalizeCaptureFailure(outcome.cause, controller.signal),
      ).toMatchObject({ reason: "cancelled", userCategory: "cancelled" });
      await expect(access(helper.root)).resolves.toBeUndefined();
    } finally {
      if (!controller.signal.aborted) controller.abort();
      await baseline;
      await host.close?.();
      if (helperRoot !== undefined)
        await expect(access(helperRoot)).rejects.toThrow();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "passes Electron cancellation into capture-local baseline inspection",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-electron-baseline-abort-test-"),
    );
    const fakeCompiler = await writeBlockingIdentityCompiler(directory);
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable: fakeCompiler.executable },
    });
    const prepareSpy = vi
      .spyOn(systemProcessOwnershipHost, "prepare")
      .mockResolvedValue();
    const baselineSpy = vi
      .spyOn(systemProcessOwnershipHost, "captureBaseline")
      .mockImplementation(async (signal) => {
        await reader.identities(
          [
            {
              pid: process.pid,
              parentPid: process.ppid,
              processGroupId: process.pid,
              state: "S",
              command: process.execPath,
            },
          ],
          signal,
        );
        return [];
      });
    const launchSpy = vi.spyOn(electron, "launch");
    const controller = new AbortController();
    let captureOutcome: Promise<ElectronCaptureOutcome> | undefined;
    try {
      const input = electronActiveObservationInputSchema.parse({
        executable_path: process.execPath,
        application_path: fileURLToPath(import.meta.url),
        application_root: process.cwd(),
      });
      captureOutcome = new PlaywrightElectronActiveProvider({})
        .capture(
          { ...input, application_root: process.cwd() },
          { signal: controller.signal },
        )
        .then(
          (value) => ({ state: "result" as const, value }),
          (cause: unknown) => ({ state: "rejected" as const, cause }),
        );
      const helper = await waitForIdentityHelper(fakeCompiler.statePath);
      controller.abort();
      const outcome = await captureOutcome;

      expect(outcome.state).toBe("result");
      if (outcome.state !== "result") throw outcome.cause;
      expect(outcome.value).toMatchObject({
        ok: false,
        error: { reason: "cancelled", userCategory: "cancelled" },
      });
      expect(launchSpy).not.toHaveBeenCalled();
      await expect(access(helper.root)).resolves.toBeUndefined();
    } finally {
      if (!controller.signal.aborted) controller.abort();
      if (captureOutcome !== undefined) await captureOutcome;
      prepareSpy.mockRestore();
      baselineSpy.mockRestore();
      launchSpy.mockRestore();
      await reader.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(!onDarwin)(
  "parses exact NUL-delimited token records and rejects truncated argv",
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "rea-process-token-parser-test-"),
    );
    const executable = join(root, "parser-test");
    const core = fileURLToPath(
      new URL(
        "../../../bridge/process/ProcessRunTokenReader.swift",
        import.meta.url,
      ),
    );
    const fixture = fileURLToPath(
      new URL(
        "../../fixtures/processRunTokenParserProbe.swift",
        import.meta.url,
      ),
    );
    try {
      await execFileOutput(
        "/usr/bin/xcrun",
        ["swiftc", core, fixture, "-o", executable],
        { timeout: 120_000, stopSignal: SWIFTC_INTERRUPT },
      );
      const { stdout } = await execFileAsync(executable, [], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(JSON.parse(stdout)).toEqual({
        argvDecoyFailsClosed: true,
        readableEnvironmentWithoutToken: {
          runId: null,
          environmentEntryCount: 1,
        },
        restrictedReadableEnvironmentWithoutToken: {
          state: "readable",
          reason: null,
        },
        restrictedEmptyEnvironment: {
          state: "unavailable",
          reason: "restricted_process_environment_withheld",
        },
        platformEmptyEnvironment: {
          state: "unavailable",
          reason: "platform_binary_environment_withheld",
        },
        restrictedUnavailableEnvironment: {
          state: "unavailable",
          reason: "restricted_process_environment_withheld",
        },
        restrictedAmbiguousEnvironment: {
          state: "unavailable",
          reason: "restricted_process_environment_withheld",
        },
        ordinaryAmbiguousEnvironment: {
          state: "unavailable",
          reason: "ambiguous_environment_boundary",
        },
        ordinaryUnavailableEnvironment: {
          state: "unavailable",
          reason: "environment_unavailable",
        },
        alternatePaddingRead: true,
        appleVectorTokenFailsClosed: true,
        clearedAppleVectorTokenFailsClosed: true,
        callerPfzBeforeTokenRead: true,
        emptyLaterArgumentRead: true,
        emptyArgv0Read: true,
        emptyEnvironmentRecordsBeforeTokenFailClosed: true,
        duplicateTokenFailsClosed: true,
        invalidTokenEncodingFailsClosed: true,
        finalAssignmentArgumentRead: true,
        missingAppleBoundaryFailsClosed: true,
        malformedBuffersRejected: true,
        invalidPointerSizeFailsClosed: true,
        malformedStages: [
          { state: "unavailable", reason: "malformed_procargs_header" },
          { state: "unavailable", reason: "malformed_procargs_argument_count" },
          {
            state: "unavailable",
            reason: "malformed_procargs_executable_path",
          },
          { state: "unavailable", reason: "malformed_procargs_pointer_size" },
          { state: "unavailable", reason: "malformed_procargs_path_padding" },
          { state: "unavailable", reason: "malformed_procargs_arguments" },
          { state: "unavailable", reason: "malformed_procargs_terminator" },
          {
            state: "unavailable",
            reason: "malformed_procargs_trailing_entries",
          },
        ],
        malformedObservation: {
          state: "unavailable",
          reason: "malformed_procargs",
        },
        nonAsciiPathRead: true,
        realTokenRead: true,
        reservedArgumentWithRealTokenFailsClosed: true,
        titleOverwriteFailsClosed: true,
        truncatedArgvFailsClosed: true,
        zeroArgumentsRead: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  150_000,
);

it.skipIf(!onDarwin)(
  "retries a growing process table after ENOMEM and preserves other sysctl errors",
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "rea-process-snapshot-retry-test-"),
    );
    const executable = join(root, "snapshot-probe");
    const core = fileURLToPath(
      new URL(
        "../../../bridge/process/ProcessRunTokenReader.swift",
        import.meta.url,
      ),
    );
    const fixture = fileURLToPath(
      new URL(
        "../../fixtures/processRunTokenSnapshotProbe.swift",
        import.meta.url,
      ),
    );
    try {
      await execFileOutput(
        "/usr/bin/xcrun",
        ["swiftc", core, fixture, "-o", executable],
        { timeout: 120_000, stopSignal: SWIFTC_INTERRUPT },
      );
      const { stdout } = await execFileAsync(executable, [], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(JSON.parse(stdout)).toEqual({
        preservedOtherErrno: true,
        retriedAfterFreshSize: true,
        successfulSnapshotMissingPidIsAbsent: true,
        failedSnapshotMissingPidIsUnavailable: true,
        invalidPidIsUnavailable: true,
        zombieLifecycleIsSeparateFromIdentity: true,
        effectiveUidComesFromNativeIdentity: true,
        nativeRelationIsSeparateFromIdentity: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  150_000,
);

it.skipIf(!onDarwin)(
  "reads exact ownership keys and preserves unknowns after process title changes",
  async () => {
    const host = createSystemProcessOwnershipHost("darwin");
    const children: Awaited<ReturnType<typeof startNodeChild>>[] = [];
    try {
      const decoy = await startNodeChild({
        DECOY: "words REA_PROCESS_RUN_ID=synthetic-decoy",
      });
      children.push(decoy);
      const owned = await startNodeChild({
        REA_PROCESS_RUN_ID: "synthetic-owned",
      });
      children.push(owned);
      const titleMutated = await startNodeChild(
        { REA_PROCESS_RUN_ID: "synthetic-title-mutated" },
        process.execPath,
        ["-e", 'process.title = "npm run check"; setInterval(() => {}, 1_000)'],
      );
      children.push(titleMutated);
      await expect
        .poll(async () => {
          const process = (await host.listProcesses()).find(
            ({ pid }) => pid === titleMutated.pid,
          );
          return process?.command ?? "";
        })
        .toMatch(/^npm run check/u);

      const processes = await host.listProcesses();
      const entries = [decoy, owned, titleMutated].map(({ pid }) => {
        const entry = processes.find((process) => process.pid === pid);
        if (entry === undefined)
          throw new Error("test child is absent from process table");
        return entry;
      });
      const observations = await host.runTokens?.(entries);
      const identities = await host.processIdentities?.(entries);
      expect(observations?.get(decoy.pid)).toEqual({
        state: "readable",
        runId: undefined,
      });
      expect(observations?.get(owned.pid)).toEqual({
        state: "readable",
        runId: "synthetic-owned",
      });
      expect(observations?.get(titleMutated.pid)).toMatchObject({
        state: "unavailable",
        reason: expect.stringMatching(/\S/u),
      });
      expect(identities?.get(decoy.pid)?.state).toBe("readable");
      expect(identities?.get(owned.pid)?.state).toBe("readable");
      expect(identities?.get(titleMutated.pid)?.state).toBe("readable");
    } finally {
      try {
        await Promise.all(children.map(({ child }) => stopNodeChild(child)));
      } finally {
        await host.close?.();
      }
    }
  },
);

it.skipIf(!onDarwin)(
  "keeps a long title overwrite unknown when it hides the child's token",
  async () => {
    const host = createSystemProcessOwnershipHost("darwin");
    const children: ChildProcess[] = [];
    try {
      for (const length of [256, 384, 512, 1024]) {
        const child = spawn(
          process.execPath,
          [
            "-e",
            `if(process.env.PROBE_TITLE!=='-') process.title=process.env.PROBE_TITLE;process.send({ready:true,stillOwned:process.env.REA_PROCESS_RUN_ID==='probe-owned'});setInterval(()=>{},1000)`,
            "arg1",
            "arg2",
            "arg3",
          ],
          {
            env: {
              REA_PROCESS_RUN_ID: "probe-owned",
              PROBE_TITLE: "n".repeat(length),
              PATH: process.env.PATH,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          },
        );
        children.push(child);
        const message = await waitForChildReadiness(child);
        expect(message).toEqual({ ready: true, stillOwned: true });
        if (child.pid === undefined)
          throw new Error("test child did not receive a PID");
        const entry = (await host.listProcesses()).find(
          ({ pid }) => pid === child.pid,
        );
        if (
          entry === undefined ||
          host.processIdentities === undefined ||
          host.runTokens === undefined
        )
          throw new Error("native child inspection unavailable");
        const before = (await host.processIdentities([entry])).get(child.pid);
        const token = (await host.runTokens([entry])).get(child.pid);
        const after = (await host.processIdentities([entry])).get(child.pid);
        expect(before).toMatchObject({
          state: "readable",
          lifecycle: { state: "observed", lifecycle: "non-zombie" },
        });
        if (before?.state !== "readable")
          throw new Error("child identity unavailable");
        expect(after).toMatchObject({
          state: "readable",
          identity: before.identity,
          lifecycle: { state: "observed", lifecycle: "non-zombie" },
        });
        if (token?.state === "readable") {
          expect(token.runId).toBe("probe-owned");
        } else {
          expect(token).toEqual({
            state: "unavailable",
            reason: "ambiguous_environment_boundary",
          });
        }
      }
    } finally {
      try {
        await Promise.all(children.map(stopNodeChild));
      } finally {
        await host.close?.();
      }
    }
  },
  150_000,
);

it.skipIf(!onDarwin)(
  "reads owned tokens across executable padding and distinguishes a real empty environment",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-process-token-padding-"));
    const host = createSystemProcessOwnershipHost("darwin");
    const children: Awaited<ReturnType<typeof startNodeChild>>[] = [];
    try {
      const executables = Array.from({ length: 8 }, (_, index) =>
        join(root, "n".repeat(index + 1)),
      );
      for (const executable of executables)
        await symlink(process.execPath, executable);
      for (let index = 0; index < executables.length; index += 1) {
        const executable = executables[index];
        if (executable === undefined)
          throw new Error("test executable is missing");
        children.push(
          await startNodeChild(
            { REA_PROCESS_RUN_ID: `synthetic-padding-${String(index)}` },
            executable,
            ["-e", "setInterval(() => {}, 1_000)", "", "FOO=bar"],
            index === 0 ? "" : undefined,
          ),
        );
      }
      children.push(await startNodeChild({}));
      const processes = await host.listProcesses();
      const entries = children.map(({ pid }) => {
        const entry = processes.find((process) => process.pid === pid);
        if (entry === undefined)
          throw new Error("owned test child is absent from process table");
        return entry;
      });
      const observations = await host.runTokens?.(entries);
      expect(children.map(({ pid }) => observations?.get(pid))).toEqual([
        ...executables.map((_, index) => ({
          state: "readable",
          runId: `synthetic-padding-${String(index)}`,
        })),
        { state: "readable" },
      ]);
    } finally {
      for (const { child } of children) await stopNodeChild(child);
      await host.close?.();
      await rm(root, { recursive: true, force: true });
    }
  },
);

const startNodeChild = async (
  environment: NodeJS.ProcessEnv,
  command = process.execPath,
  arguments_: readonly string[] = ["-e", "setInterval(() => {}, 1_000)"],
  argv0?: string,
) => {
  const child = spawn(command, [...arguments_], {
    env: environment,
    stdio: "ignore",
    ...(argv0 === undefined ? {} : { argv0 }),
  });
  if (child.pid === undefined)
    throw new Error("test child did not receive a PID");
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return { child, pid: child.pid };
};

const stopNodeChild = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await exited;
};

const waitForChildReadiness = async (child: ChildProcess): Promise<unknown> => {
  const listeners = new AbortController();
  const message = once(child, "message", { signal: listeners.signal });
  const exit = once(child, "exit", { signal: listeners.signal });
  try {
    await awaitAcknowledgement(
      message.then(() => undefined),
      exit,
      "title-mutating child readiness",
    );
    return (await message)[0];
  } finally {
    listeners.abort();
  }
};

it("stops a child that never acknowledges readiness", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    await expect(waitForChildReadiness(child)).rejects.toThrow(
      "title-mutating child readiness was not acknowledged before the gate deadline",
    );
  } finally {
    await stopNodeChild(child);
  }
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
});

it.skipIf(process.platform === "win32").each([
  {
    name: "invalid UTF-8",
    stdout: "owned compiler stdout",
    stderrHex: "ff",
    stderrBytes: 1,
    truncated: false,
  },
  {
    name: "bounded stdout",
    stdout: "x".repeat(12000),
    stderrHex: "61",
    stderrBytes: 1,
    truncated: true,
  },
])(
  "retains original output facts for $name compiler failures",
  async ({ stdout, stderrHex, stderrBytes, truncated }) => {
    const directory = await createTestTempDirectory(
      "rea-compiler-output-facts-",
    );
    const executable = join(directory, "compiler");
    await writeFile(
      executable,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(Buffer.from(${JSON.stringify(stderrHex)}, "hex")); process.exitCode=7;\n`,
      { mode: 0o755 },
    );
    const reader = createDarwinProcessRunTokenReader({
      compiler: { kind: "xcrun", executable },
    });
    try {
      const failure = await preparationFailure(reader);
      expect(failure.compilerOutcome?.stderrBytes).toBe(stderrBytes);
      expect(failure.capturedOutput).toEqual({
        stdout: stdout.slice(0, 8192),
        stderr: Buffer.from(stderrHex, "hex").toString("utf8"),
        stdout_bytes: Buffer.byteLength(stdout),
        stderr_bytes: stderrBytes,
        truncated,
        exit_code: 7,
        signal: null,
      });
      const normalized = normalizeCaptureFailure(failure, undefined);
      if (!(normalized instanceof ProcessCaptureError))
        throw new Error("Expected capture failure");
      expect(normalized.capturedOutput).toEqual(failure.capturedOutput);
    } finally {
      await reader.close();
    }
  },
);
