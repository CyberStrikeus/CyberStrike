import {
  chmod,
  mkdir,
  readdir,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

import { FirmwareProvider } from "../../../src/firmware/FirmwareProvider.js";
import { FirmwareAnalysisService } from "../../../src/application/firmware/FirmwareAnalysisService.js";
import { FirmwareFileAccess } from "../../../src/firmware/FirmwareFiles.js";
import { WakaruProvider } from "../../../src/javascript/recovery/WakaruProvider.js";
import { JavaScriptRecoveryService } from "../../../src/application/javascript/JavaScriptRecoveryService.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessSupervisor,
} from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { observeProcessStartIdentity } from "../../../src/process/ProcessOwnershipObservation.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { fileURLToPath } from "node:url";
import { preparePcapNativeBound } from "../../../src/pcap/PcapNativeBound.js";
import { runPcapCommand } from "../../../src/pcap/PcapCommand.js";
import { ArtifactAnalysisResources } from "../../../src/process/ArtifactAnalysisResources.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { TsharkCaptureProvider } from "../../../src/captures/TsharkCaptureProvider.js";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import type { LinuxResourceLimits } from "../../../src/process/LinuxResourceLimits.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real children and filesystem, with simulated Linux admission/limits. These
// scripts do not establish native TShark, sigrok or prlimit behavior.
it.skipIf(process.platform === "win32").each(["tshark", "sigrok"] as const)(
  "executes selected %s and limiter wrappers, retaining identity failure output after success",
  async (kind) => {
    const directory = await createTestTempDirectory("rea-selected-producer-");
    const bin = join(directory, "bin"),
      libexec = join(directory, "libexec");
    await mkdir(bin);
    await mkdir(libexec);
    const command = join(bin, kind),
      limiter = join(bin, "prlimit");
    const commandSource = join(libexec, "producer"),
      limiterSource = join(libexec, "limiter");
    const replacement = join(libexec, "replacement");
    const script =
      '#!/bin/sh\nselected="${0%/*}/${0##*/}"\nIFS= read -r role < "$selected.role" || exit 19\nif [ "$role" = limiter ]; then\n  if [ -f "$selected.retarget" ]; then\n    IFS= read -r target < "$selected.retarget"\n    /bin/ln -sf "$target" "$0"\n  fi\n  while [ "$1" != -- ]; do shift; done\n  shift\n  exec "$@"\nfi\nif [ "$1" = --version ]; then\n  if [ "$role" = tshark ]; then printf "TShark (Wireshark) 4.6.9\\n"; else printf "sigrok-cli 0.7.2\\nlibsigrokdecode 0.5.3\\n"; fi\nelse\n  if [ "$role" = tshark ]; then printf "P\\tInternet Protocol\\tip\\n"; else printf "Supported protocol decoders:\\n  uart  UART\\n"; fi\nfi\n';
    for (const path of [commandSource, limiterSource, replacement]) {
      await writeFile(path, script);
      await chmod(path, 0o755);
    }
    await symlink(commandSource, command);
    await symlink(limiterSource, limiter);
    await writeFile(`${command}.role`, `${kind}\n`);
    await writeFile(`${limiter}.role`, "limiter\n");
    const environment = {
      ...process.env,
      ...(kind === "tshark"
        ? { REA_TSHARK_COMMAND: command, REA_TSHARK_PRLIMIT_COMMAND: limiter }
        : { REA_SIGROK_COMMAND: command, REA_SIGROK_PRLIMIT_COMMAND: limiter }),
    };
    const runtime = () =>
      PrivateRuntimeRoot.create({ parent: directory, prefix: "workspace-" });
    const limits = async (configured: LinuxResourceLimits) => configured;
    const provider =
      kind === "tshark"
        ? new TsharkCaptureProvider(
            environment,
            undefined,
            runtime,
            "linux",
            readStableArtifact,
            limits,
          )
        : new SigrokRecordingProvider(
            environment,
            undefined,
            runtime,
            "linux",
            readStableArtifact,
            limits,
          );
    onTestFinished(() => provider.close());
    const inspect =
      provider instanceof TsharkCaptureProvider
        ? () => new PacketCaptureService(provider).inspectFields({})
        : () => new SignalRecordingService(provider).inspectDecoders({});
    const first = await inspect();
    if (!first.ok) throw first.error;
    expect(first.value.normalized_result).toMatchObject({
      tool: { configured_path: command, path: await realpath(commandSource) },
      resource_limiter: {
        configured_path: limiter,
        path: await realpath(limiterSource),
        arguments: expect.arrayContaining([command]),
      },
    });
    // Identical bytes at another physical path must not pass the current
    // invocation's identity verification, even though the producer succeeds.
    await writeFile(`${limiter}.retarget`, `${replacement}\n`);
    const changed = await inspect();
    if (changed.ok) throw new Error("Retargeted limiter was accepted");
    expect(changed.error).toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      path: limiter,
      capturedOutput: {
        stdout:
          kind === "tshark"
            ? "TShark (Wireshark) 4.6.9\n"
            : "sigrok-cli 0.7.2\nlibsigrokdecode 0.5.3\n",
      },
    });
    await unlink(`${limiter}.retarget`);
    const fresh = await inspect();
    if (!fresh.ok) throw fresh.error;
    expect(fresh.value.normalized_result).toMatchObject({
      resource_limiter: { path: await realpath(replacement) },
    });
    expect(first.value.normalized_result).toMatchObject({
      resource_limiter: { path: await realpath(limiterSource) },
    });
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith("workspace-"),
      ),
    ).toEqual([]);
  },
);

const selectedEngineLauncher = (kind: "firmware" | "wakaru"): string => {
  const producer = fileURLToPath(
    new URL(
      kind === "firmware"
        ? "../../fixtures/firmware/producer.mjs"
        : "../../fixtures/javascript-recovery/producer.mjs",
      import.meta.url,
    ),
  );
  const invocation = [
    process.execPath,
    producer,
    ...(kind === "firmware" ? ["binwalk"] : []),
  ]
    .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
    .join(" ");
  return `#!/bin/sh\nIFS= read -r role < "$0.role" || exit 19\nif [ -f "$0.retarget" ]; then\n  IFS= read -r target < "$0.retarget"\n  /bin/ln -sf "$target" "$0"\nfi\nif [ "$role" = limiter ]; then\n  while [ "$1" != -- ]; do shift; done\n  shift\n  exec "$@"\nfi\nexec ${invocation} "$@"\n`;
};

// Own real wrapper processes and their workspaces. Linux/x64 admission and
// /proc limits are simulated; supervision always runs on the actual host.
const createSelectedEngineFixture = async (
  kind: "firmware" | "wakaru",
  afterLaunch?: () => void,
) => {
  const directory = await createTestTempDirectory("rea-selected-command-");
  const bin = join(directory, "bin"),
    libexec = join(directory, "libexec");
  await mkdir(bin);
  await mkdir(libexec);
  const command = join(bin, "engine"),
    limiter = join(bin, "prlimit");
  const commandSource = join(libexec, "engine"),
    limiterSource = join(libexec, "limiter");
  const replacement = join(libexec, "replacement");
  const script = selectedEngineLauncher(kind);
  for (const path of [commandSource, limiterSource, replacement])
    await writeFile(path, script, { mode: 0o755 });
  await symlink(commandSource, command);
  await symlink(limiterSource, limiter);
  await writeFile(`${command}.role`, `${kind}\n`);
  await writeFile(`${limiter}.role`, "limiter\n");
  const input = join(directory, kind === "firmware" ? "input.bin" : "input.js");
  await writeFile(
    input,
    kind === "firmware" ? "fixture-input-data" : "module.exports = 42;",
  );
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  if (platform === undefined || arch === undefined)
    throw new Error("Missing host descriptors");
  const restoreHost = () => {
    Object.defineProperty(process, "platform", platform);
    Object.defineProperty(process, "arch", arch);
  };
  const launches: {
    cwd?: string;
    pid?: number;
    command: string;
    environmentMarker: string | undefined;
  }[] = [];
  const environment = {
    ...process.env,
    REA_BINWALK_COMMAND: command,
    REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
    REA_WAKARU_COMMAND: command,
    REA_JAVASCRIPT_PRLIMIT_COMMAND: limiter,
    REA_SELECTED_ENVIRONMENT: "initial",
  };
  const launcher: typeof spawnOwnedProviderProcess = async (options) => {
    restoreHost();
    const child = await spawnOwnedProviderProcess(options);
    launches.push({
      command: options.command,
      environmentMarker: options.hostEnvironment?.REA_SELECTED_ENVIRONMENT,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(child.process.pid === undefined ? {} : { pid: child.process.pid }),
    });
    afterLaunch?.();
    return child;
  };
  const fileSizeCeiling = vi
    .spyOn(FirmwareFileAccess.prototype, "fileSizeCeiling")
    .mockResolvedValue(Number.MAX_SAFE_INTEGER);
  onTestFinished(() => fileSizeCeiling.mockRestore());
  const service =
    kind === "firmware"
      ? new FirmwareAnalysisService(new FirmwareProvider(environment, launcher))
      : new JavaScriptRecoveryService(
          new WakaruProvider(environment, launcher),
        );
  onTestFinished(async () => {
    restoreHost();
    await service.close();
    for (const launch of launches) {
      if (launch.pid !== undefined)
        expect(await observeProcessStartIdentity(launch.pid)).toBeUndefined();
      if (launch.cwd !== undefined)
        await expect(readdir(launch.cwd)).rejects.toMatchObject({
          code: "ENOENT",
        });
    }
  });
  let sequence = 0;
  const execute = async () => {
    Object.defineProperty(process, "platform", {
      ...platform,
      value: "linux",
    });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    try {
      return service instanceof FirmwareAnalysisService
        ? await service.execute("inspect_firmware_regions", { path: input })
        : await service.recover({
            path: input,
            output_directory: join(directory, `output-${sequence++}`),
          });
    } finally {
      restoreHost();
    }
  };
  return {
    bin,
    command,
    limiter,
    commandSource,
    limiterSource,
    replacement,
    environment,
    launches,
    execute,
  };
};

it.skipIf(process.platform === "win32").each(["firmware", "wakaru"] as const)(
  "executes selected %s wrappers and retains completed output when either alias changes",
  async (kind) => {
    const {
      command,
      limiter,
      commandSource,
      limiterSource,
      replacement,
      execute,
    } = await createSelectedEngineFixture(kind);
    const first = await execute();
    if (!first.ok) throw first.error;
    expect(first.value.normalized_result).toMatchObject({
      engine:
        kind === "firmware"
          ? { executable_path: await realpath(commandSource) }
          : { executable: { path: await realpath(commandSource) } },
    });
    expect(first.value.raw_result).toMatchObject({
      [kind === "firmware" ? "version_execution" : "version"]: {
        command,
        resource_limiter: limiter,
      },
    });
    for (const [selectedPath, target] of [
      [command, replacement],
      [limiter, replacement],
      [command, command],
      [limiter, limiter],
    ] as const) {
      await writeFile(`${selectedPath}.retarget`, `${target}\n`);
      const changed = await execute();
      if (changed.ok) throw new Error("Retargeted executable was accepted");
      expect(changed.error).toMatchObject({
        _tag: "AnalysisArtifactChangedError",
        path: selectedPath,
        capturedOutput: {
          stdout: kind === "firmware" ? "binwalk 3.1.0\n" : "wakaru 1.14.0\n",
        },
      });
      await unlink(`${selectedPath}.retarget`);
      await unlink(selectedPath);
      await symlink(
        selectedPath === command ? commandSource : limiterSource,
        selectedPath,
      );
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps firmware configuration consistent within an operation and accepts later updates",
  async () => {
    const {
      bin,
      command,
      limiter,
      commandSource,
      limiterSource,
      environment,
      launches,
      execute,
    } = await createSelectedEngineFixture("firmware");
    const nextCommand = join(bin, "next-engine");
    const nextLimiter = join(bin, "next-prlimit");
    await symlink(commandSource, nextCommand);
    await symlink(limiterSource, nextLimiter);
    await writeFile(`${nextCommand}.role`, "firmware\n");
    await writeFile(`${nextLimiter}.role`, "limiter\n");
    const originalHash = FirmwareFileAccess.prototype.hash;
    const hash = vi.spyOn(FirmwareFileAccess.prototype, "hash");
    onTestFinished(() => hash.mockRestore());
    hash.mockImplementationOnce(async function (
      this: FirmwareFileAccess,
      path,
      signal,
    ) {
      const digest = await originalHash.call(this, path, signal);
      environment.REA_BINWALK_COMMAND = nextCommand;
      environment.REA_FIRMWARE_PRLIMIT_COMMAND = nextLimiter;
      environment.REA_SELECTED_ENVIRONMENT = "updated";
      return digest;
    });
    const first = await execute();
    if (!first.ok) throw first.error;
    expect(first.value.raw_result).toMatchObject({
      version_execution: { command, resource_limiter: limiter },
    });
    expect(launches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: limiter,
          environmentMarker: "initial",
        }),
      ]),
    );
    expect(
      launches.every((launch) => launch.environmentMarker === "initial"),
    ).toBe(true);
    const next = await execute();
    if (!next.ok) throw next.error;
    expect(next.value.raw_result).toMatchObject({
      version_execution: {
        command: nextCommand,
        resource_limiter: nextLimiter,
      },
    });
    expect(launches.at(-1)).toMatchObject({
      command: nextLimiter,
      environmentMarker: "updated",
    });
  },
);

it.skipIf(process.platform === "win32")(
  "keeps Wakaru configuration consistent across version and recovery launches",
  async () => {
    let mutateOnce = true;
    const fixture = await createSelectedEngineFixture("wakaru", () => {
      if (!mutateOnce) return;
      mutateOnce = false;
      fixture.environment.REA_WAKARU_COMMAND = nextCommand;
      fixture.environment.REA_JAVASCRIPT_PRLIMIT_COMMAND = nextLimiter;
      fixture.environment.REA_SELECTED_ENVIRONMENT = "updated";
    });
    const {
      bin,
      command,
      limiter,
      commandSource,
      limiterSource,
      launches,
      execute,
    } = fixture;
    const nextCommand = join(bin, "next-engine");
    const nextLimiter = join(bin, "next-prlimit");
    await symlink(commandSource, nextCommand);
    await symlink(limiterSource, nextLimiter);
    await writeFile(`${nextCommand}.role`, "wakaru\n");
    await writeFile(`${nextLimiter}.role`, "limiter\n");
    const first = await execute();
    if (!first.ok) throw first.error;
    expect(first.value.raw_result).toMatchObject({
      version: { command, resource_limiter: limiter },
    });
    expect(
      launches.map(({ command, environmentMarker }) => ({
        command,
        environmentMarker,
      })),
    ).toEqual([
      { command: limiter, environmentMarker: "initial" },
      { command: limiter, environmentMarker: "initial" },
    ]);
    const next = await execute();
    if (!next.ok) throw next.error;
    expect(next.value.raw_result).toMatchObject({
      version: { command: nextCommand, resource_limiter: nextLimiter },
    });
    expect(
      launches.slice(2).map(({ command, environmentMarker }) => ({
        command,
        environmentMarker,
      })),
    ).toEqual([
      { command: nextLimiter, environmentMarker: "updated" },
      { command: nextLimiter, environmentMarker: "updated" },
    ]);
  },
);

it.skipIf(process.platform === "win32")(
  "executes the selected PCAP limiter and retains completed output when its alias changes",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-selected-pcap-limiter-",
    );
    const selected = join(directory, "prlimit"),
      physical = join(directory, "driver"),
      replacement = join(directory, "replacement");
    const script =
      '#!/bin/sh\n[ -f "$0.role" ] || exit 19\nif [ -f "$0.retarget" ]; then\n  IFS= read -r target < "$0.retarget"\n  /bin/ln -sf "$target" "$0"\nfi\nwhile [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n';
    await writeFile(physical, script, { mode: 0o755 });
    await writeFile(replacement, script, { mode: 0o755 });
    await symlink(physical, selected);
    await writeFile(`${selected}.role`, "limiter");
    const resources = new ArtifactAnalysisResources(
      "pcap",
      "inspect_pcap_capture",
      readStableArtifact,
      async (configured) => configured,
      { message: "busy", details: {} },
    );
    onTestFinished(() => resources.close());
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (platform === undefined) throw new Error("Missing host descriptor");
    let prepared: Awaited<ReturnType<typeof preparePcapNativeBound>>;
    try {
      Object.defineProperty(process, "platform", {
        ...platform,
        value: "linux",
      });
      prepared = await preparePcapNativeBound(
        { REA_TSHARK_PRLIMIT_COMMAND: selected },
        resources,
        async (_selected, args) => {
          const stdout =
            args[0] === "--help"
              ? " --as[=limit] --fsize[=limit] --cpu[=limit] --core[=limit]"
              : "prlimit from util-linux 2.38.1";
          return {
            stdout,
            capturedOutput: { stdout, stderr: "", truncated: false },
          };
        },
      );
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    let refuseCleanup = false;
    let retained: ProviderProcessSupervisor | undefined;
    onTestFinished(async () => {
      refuseCleanup = false;
      await retained?.stop();
    });
    const execute = () =>
      runPcapCommand({
        operation: "inspect_pcap_capture",
        command: "/bin/echo",
        arguments: ["selected limiter"],
        limits: { timeoutMs: 10_000, maxOutputBytes: 1024 },
        environment: process.env,
        signal: undefined,
        nativeBound: prepared.nativeBound,
        launcher: async (options) => {
          const child = await spawnOwnedProviderProcess(options);
          return {
            ...child,
            cleanup: () =>
              refuseCleanup
                ? Promise.resolve({
                    cleaned: false,
                    reason: "controlled pending command cleanup",
                  })
                : cleanupOwnedProcessGroup(child.ownership),
          };
        },
        retain: (owner) => {
          retained = owner;
        },
      });
    await expect(execute()).resolves.toMatchObject({
      stdout: "selected limiter\n",
    });
    await writeFile(`${selected}.retarget`, `${replacement}\n`);
    await expect(execute()).rejects.toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      path: selected,
      capturedOutput: { stdout: "selected limiter\n" },
    });
    await unlink(selected);
    await symlink(physical, selected);
    await writeFile(`${selected}.retarget`, `${selected}\n`);
    refuseCleanup = true;
    const failed: unknown = await execute().catch((cause: unknown) => cause);
    expect(failed).toBeInstanceOf(AnalysisError);
    if (!(failed instanceof AnalysisError))
      throw new Error("Expected typed cleanup failure");
    expect(failed).toMatchObject({
      cleanupIncomplete: true,
      cleanup: { reason: "controlled pending command cleanup" },
      capturedOutput: { stdout: "selected limiter\n" },
    });
    expect(failed.cleanupPrimary).toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      path: selected,
    });
    refuseCleanup = false;
    await expect(retained?.stop()).resolves.toMatchObject({
      status: "verified-cleanup",
    });
    expect(failed.resolveCleanup().cleanupIncomplete).toBe(false);
  },
);
