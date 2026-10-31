import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { systemDoctorHost } from "../../../src/application/Doctor.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ExecFileOutputCancelledError } from "../../../src/process/ExecFileOutput.js";

it("threads the selected host and environment into system diagnostics", async () => {
  const environment = {
    HOME: "/selected/home",
    HOPPER_LAUNCHER_PATH: "/selected/bin/hopper",
    PATH: "/selected/bin",
  };
  const calls: Array<{
    command: string;
    arguments: readonly string[];
    environment: NodeJS.ProcessEnv | undefined;
  }> = [];
  const host = systemDoctorHost({
    platform: "linux",
    architecture: "x64",
    environment,
    execFileOutput: async (command, arguments_, options) => {
      expect(options).toMatchObject({
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        stopSignal: "SIGTERM",
        signal: expect.any(AbortSignal),
      });
      calls.push({ command, arguments: arguments_, environment: options?.env });
      if (command === "/usr/bin/sw_vers")
        return {
          stdout: "15.0\n",
          stderr: "",
          stdoutBytes: 5,
          stderrBytes: 0,
        };
      if (command === "ldd")
        return {
          stdout: "linux-vdso.so.1",
          stderr: "",
          stdoutBytes: Buffer.byteLength("linux-vdso.so.1"),
          stderrBytes: 0,
        };
      if (command === "which")
        return {
          stdout: "/selected/bin/rea\n",
          stderr: "",
          stdoutBytes: 18,
          stderrBytes: 0,
        };
      throw new Error(`Unexpected diagnostic command: ${command}`);
    },
  });

  expect(host.homeDirectory).toBe("/selected/home");
  expect(host.platform).toBe("linux");
  expect(host.architecture).toBe("x64");
  await host.installationPaths?.();
  expect(await host.macosVersion()).toBe("15.0");
  await host.executable(process.execPath);

  expect(calls.map(({ command }) => command)).toEqual([
    "which",
    "/usr/bin/sw_vers",
    "ldd",
  ]);
  expect(
    calls.every(({ environment: observed }) => observed === environment),
  ).toBe(true);
});

it.each([
  "macosVersion",
  "installationPaths",
  "brewHopperPath",
  "executable",
  "ilspyCmdVersion",
] as const)(
  "preserves cancellation through the %s fallback",
  async (operation) => {
    const reason = { request: "stop diagnostics" };
    const host = systemDoctorHost({
      platform: "linux",
      environment: {},
      execFileOutput: async () => {
        throw new ExecFileOutputCancelledError(reason);
      },
    });
    try {
      await expect(host[operation]?.(process.execPath)).rejects.toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
      });
    } finally {
      await host.close?.();
    }
  },
);

it.each(["complete", "failed"] as const)(
  "retains a %s probe's outcome when cancellation arrives at completion",
  async (outcome) => {
    const controller = new AbortController();
    const reason = { request: "late cancellation" };
    const host = systemDoctorHost({
      signal: controller.signal,
      environment: {},
      execFileOutput: async () => {
        controller.abort(reason);
        if (outcome === "failed")
          throw Object.assign(new Error("probe timed out"), {
            code: "ETIMEDOUT",
          });
        return {
          stdout: "observed",
          stderr: "warning",
          stdoutBytes: 8,
          stderrBytes: 7,
        };
      },
    });
    try {
      const pending = host.installationPaths?.();
      if (outcome === "failed") await expect(pending).resolves.toEqual([]);
      else
        await expect(pending).rejects.toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
          capturedOutput: {
            stdout: "observed",
            stderr: "warning",
            stdout_bytes: 8,
            stderr_bytes: 7,
            exit_code: 0,
          },
        });
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32").each(["abort", "close"] as const)(
  "%s joins an active diagnostic probe's exit and preserves cancellation",
  async (action) => {
    const home = await createTestTempDirectory("rea-doctor-probe-stop-");
    const started = join(home, "started");
    const cleaned = join(home, "cleaned");
    await writeFile(
      join(home, "which"),
      `#!${process.execPath}
const fs = require("node:fs");
const timer = setTimeout(() => process.exit(91), 8000);
process.on("SIGTERM", () => {
  clearTimeout(timer);
  setTimeout(() => { fs.writeFileSync(${JSON.stringify(cleaned)}, "cleaned"); process.exit(0); }, 50);
});
fs.writeFileSync(${JSON.stringify(started)}, "ready");
`,
      { mode: 0o700 },
    );
    const controller = new AbortController();
    const reason = { request: "cancel running probe" };
    const host = systemDoctorHost({
      environment: { HOME: home, PATH: home },
      signal: controller.signal,
    });
    const pending = host.installationPaths!().then(
      (value) => value,
      (cause: unknown) => cause,
    );
    try {
      await expect.poll(async () => readFile(started, "utf8")).toBe("ready");
      if (action === "abort") controller.abort(reason);
      else await host.close?.();
      const failure = await pending;
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (action === "abort") expect((failure as Error).cause).toBe(reason);
      expect(await readFile(cleaned, "utf8")).toBe("cleaned");
    } finally {
      controller.abort(reason);
      await pending;
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "does not launch a diagnostic for an already cancelled request",
  async () => {
    const home = await createTestTempDirectory("rea-doctor-pre-abort-");
    const marker = join(home, "launched");
    await writeFile(
      join(home, "which"),
      `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "launched");\n`,
      { mode: 0o700 },
    );
    const controller = new AbortController();
    const reason = { request: "already cancelled" };
    controller.abort(reason);
    const host = systemDoctorHost({
      environment: { HOME: home, PATH: home },
      signal: controller.signal,
    });
    try {
      await expect(host.installationPaths?.()).rejects.toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
      });
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await host.close?.();
    }
  },
);

it("does not report a directory as an available executable", async () => {
  const host = systemDoctorHost({
    platform: "darwin",
    architecture: "arm64",
    environment: {},
    execFileOutput: () => Promise.reject(new Error("unexpected command")),
  });

  await expect(host.executable(dirname(process.execPath))).resolves.toBe(false);
  await expect(host.executable(process.execPath)).resolves.toBe(true);
});

it.each([
  [{ default: { appdir: "/Applications" } }, "/Applications"],
  [
    {
      default: { appdir: "/Applications" },
      env: { appdir: "/Env Apps" },
      explicit: { appdir: "~/Tools" },
    },
    "HOME/Tools",
  ],
  [
    { default: { appdir: "/Applications" }, env: { appdir: "/Env Apps" } },
    "/Env Apps",
  ],
])(
  "locates the Hopper cask from its Caskroom receipt without a cask command (%j)",
  async (config, expectedAppdir) => {
    const root = await createTestTempDirectory("rea-doctor-caskroom-");
    const caskroom = join(root, "Caskroom");
    const metadata = join(caskroom, "hopper-disassembler", ".metadata");
    await mkdir(metadata, { recursive: true });
    await writeFile(join(metadata, "config.json"), JSON.stringify(config));
    const calls: (readonly string[])[] = [];
    const host = systemDoctorHost({
      platform: "darwin",
      environment: { HOME: join(root, "home") },
      execFileOutput: async (_command, arguments_) => {
        calls.push(arguments_);
        return {
          stdout: `${caskroom}\n`,
          stderr: "",
          stdoutBytes: Buffer.byteLength(`${caskroom}\n`),
          stderrBytes: 0,
        };
      },
    });

    expect(await host.brewHopperPath()).toBe(
      join(
        expectedAppdir.replace("HOME", join(root, "home")),
        "Hopper Disassembler.app/Contents/MacOS/hopper",
      ),
    );
    // A cask argument makes Homebrew fetch and cache its API data.
    expect(calls).toEqual([["--caskroom"]]);
  },
);

it.skipIf(process.platform === "win32").each(["absolute", "home"])(
  "preserves symlink traversal in the cask appdir (%s)",
  async (spelling) => {
    const root = await createTestTempDirectory("rea-doctor-cask-path-");
    const home = join(root, "home");
    const caskroom = join(root, "Caskroom");
    const metadata = join(caskroom, "hopper-disassembler", ".metadata");
    const target = join(root, "selected", "nested");
    await mkdir(home, { recursive: true });
    await mkdir(target, { recursive: true });
    await mkdir(metadata, { recursive: true });
    await symlink(target, join(home, "apps"));
    const suffix = "Hopper Disassembler.app/Contents/MacOS/hopper";
    const selected = join(root, "selected", suffix);
    await mkdir(dirname(selected), { recursive: true });
    await writeFile(selected, "selected Hopper");
    const appdir = spelling === "home" ? "~/apps/.." : `${home}/apps/..`;
    await writeFile(
      join(metadata, "config.json"),
      JSON.stringify({ explicit: { appdir } }),
    );
    const host = systemDoctorHost({
      platform: "darwin",
      environment: { HOME: home },
      execFileOutput: async () => ({
        stdout: `${caskroom}\n`,
        stderr: "",
        stdoutBytes: Buffer.byteLength(`${caskroom}\n`),
        stderrBytes: 0,
      }),
    });
    const discovered = await host.brewHopperPath();
    expect(discovered).toBe(`${home}/apps/../${suffix}`);
    expect(await readFile(discovered!, "utf8")).toBe("selected Hopper");
  },
);

it("reports no Homebrew Hopper when the cask has no receipt", async () => {
  const caskroom = await createTestTempDirectory("rea-doctor-caskroom-");
  const calls: (readonly string[])[] = [];
  const host = systemDoctorHost({
    platform: "darwin",
    environment: { HOME: caskroom },
    execFileOutput: async (_command, arguments_) => {
      calls.push(arguments_);
      return {
        stdout: `${caskroom}\n`,
        stderr: "",
        stdoutBytes: Buffer.byteLength(`${caskroom}\n`),
        stderrBytes: 0,
      };
    },
  });

  expect(await host.brewHopperPath()).toBeUndefined();
  expect(new Set(calls.map((arguments_) => arguments_.join(" ")))).toEqual(
    new Set(["--caskroom"]),
  );
});
