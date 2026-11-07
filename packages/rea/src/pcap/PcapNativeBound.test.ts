import { chmod, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import type { ArtifactAnalysisResources } from "../process/ArtifactAnalysisResources.js";
import {
  AnalysisCancelledError,
  AnalysisArtifactChangedError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import {
  BOUNDED_PRODUCER_LIMITS,
  prlimitCeilingArguments,
  type LinuxResourceLimits,
} from "../process/LinuxResourceLimits.js";
import { preparePcapNativeBound } from "./PcapNativeBound.js";

const probeResult = (stdout: string, stderr = "") => ({
  stdout,
  capturedOutput: { stdout, stderr, truncated: false },
});
const help = " --as[=limit] --fsize[=limit] --cpu[=limit] --core[=limit]";

const resources = {
  readLimits: (limits: LinuxResourceLimits) => Promise.resolve(limits),
} as ArtifactAnalysisResources;

const withPlatform = async (
  platform: NodeJS.Platform,
  run: () => Promise<void>,
) => {
  const previousPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: previousPlatform,
    });
  }
};

it("uses the shared 1 GiB ceiling for the Windows job memory limit", async () => {
  await withPlatform("win32", async () => {
    await expect(
      preparePcapNativeBound({}, resources, async () => probeResult("")),
    ).resolves.toMatchObject({
      nativeBound: {
        memoryLimitBytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
      },
    });
  });
});

it("accepts selected limiter symlinks with different and whitespace-bearing basenames", async () => {
  const root = await createTestTempDirectory("rea-prlimit-alias-");
  const executable = join(root, "prlimit");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  for (const name of ["bounded-capture", " limiter", " limiter "]) {
    const selected = join(root, name);
    await symlink(executable, selected);
    await withPlatform("linux", async () => {
      const bound = await preparePcapNativeBound(
        { REA_TSHARK_PRLIMIT_COMMAND: selected },
        resources,
        async (selection, args) => {
          expect(selection.invocationPath).toBe(selected);
          return probeResult(
            args[0] === "--help" ? help : `${name} from util-linux 2.38.1\n`,
          );
        },
      );
      expect(bound.nativeBound.limiter?.command.invocationPath).toBe(selected);
    });
  }
});

it("attributes malformed limiter version output while retaining producer evidence", async () => {
  const root = await createTestTempDirectory("rea-prlimit-invalid-output-");
  const selected = join(root, "prlimit");
  await writeFile(selected, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const capturedOutput = { stdout: "\ufffd", stderr: "", truncated: false };
  const failure = new AnalysisOutputError(
    "inspect_pcap_capture",
    "invalid UTF-8",
    {
      capturedOutput,
      diagnostics: { invalid_utf8_streams: ["stdout"] },
    },
  );
  await withPlatform("linux", async () => {
    await expect(
      preparePcapNativeBound(
        { REA_TSHARK_PRLIMIT_COMMAND: selected },
        resources,
        async () => {
          throw failure;
        },
      ),
    ).rejects.toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      capturedOutput,
      diagnostics: {
        invalid_utf8_streams: ["stdout"],
        configuration_key: "REA_TSHARK_PRLIMIT_COMMAND",
        configured: selected,
      },
      userMessage: expect.stringContaining("unreadable version output"),
    });
  });
});

it("pins capture ceilings through the shared prlimit prefix and keeps 300 CPU seconds", async () => {
  const root = await createTestTempDirectory("rea-pcap-prlimit-");
  const limiter = join(root, "prlimit");
  await writeFile(limiter, "#!/bin/sh\n");
  await chmod(limiter, 0o700);
  const limits = {
    address_space_bytes: BOUNDED_PRODUCER_LIMITS.address_space_bytes,
    file_bytes: BOUNDED_PRODUCER_LIMITS.file_bytes,
    cpu_seconds: 300,
  };
  await withPlatform("linux", async () => {
    const prepared = await preparePcapNativeBound(
      { REA_TSHARK_PRLIMIT_COMMAND: limiter },
      resources,
      async (_selection, args) =>
        probeResult(
          args[0] === "--help" ? help : "prlimit from util-linux 2.38.1\n",
        ),
    );
    expect(prepared.nativeBound.limiter?.arguments).toEqual(
      prlimitCeilingArguments(limits),
    );
    expect(prepared.limitations[0]).toContain(String(limits.cpu_seconds));
  });
});

it("rejects a directory or a command that does not identify as util-linux prlimit", async () => {
  const root = await createTestTempDirectory("rea-invalid-prlimit-");
  const executable = join(root, "not-prlimit");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o700);
  await withPlatform("linux", async () => {
    for (const [path, output] of [
      [root, "prlimit from util-linux 2.38"],
      [executable, ""],
    ] as const) {
      await expect(
        preparePcapNativeBound(
          { REA_TSHARK_PRLIMIT_COMMAND: path },
          resources,
          async () => probeResult(output),
        ),
      ).rejects.toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        diagnostics: {
          configuration_key: "REA_TSHARK_PRLIMIT_COMMAND",
          configured: path,
        },
      });
    }
  });
});

it("preserves cancellation and selected-command identity failures during the probe", async () => {
  const root = await createTestTempDirectory("rea-prlimit-probe-failure-");
  const limiter = join(root, "prlimit");
  await writeFile(limiter, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await withPlatform("linux", async () => {
    for (const failure of [
      new AnalysisCancelledError("inspect_pcap_capture"),
      new AnalysisArtifactChangedError(
        "inspect_pcap_capture",
        limiter,
        "changed",
      ),
      new AnalysisOutputError("inspect_pcap_capture", "invalid output", {
        cleanup: { reason: "stop failed", resources: ["owned-process"] },
      }),
    ]) {
      await expect(
        preparePcapNativeBound(
          { REA_TSHARK_PRLIMIT_COMMAND: limiter },
          resources,
          async () => {
            throw failure;
          },
        ),
      ).rejects.toBe(failure);
    }
  });
});

it("rejects another util-linux command and retains the rejected help output", async () => {
  const root = await createTestTempDirectory("rea-prlimit-impostor-");
  const selected = join(root, "lsblk");
  await writeFile(selected, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const capturedOutput = probeResult(
    " --output columns",
    "help diagnostic",
  ).capturedOutput;
  await withPlatform("linux", async () => {
    await expect(
      preparePcapNativeBound(
        { REA_TSHARK_PRLIMIT_COMMAND: selected },
        resources,
        async (_selection, args) =>
          args[0] === "--help"
            ? { stdout: capturedOutput.stdout, capturedOutput }
            : probeResult("lsblk from util-linux 2.38\n"),
      ),
    ).rejects.toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      capturedOutput,
    });
  });
});

it("retains rejected version output", async () => {
  const root = await createTestTempDirectory("rea-prlimit-rejected-version-");
  const selected = join(root, "prlimit");
  await writeFile(selected, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const output = probeResult("unexpected banner", "diagnostic");
  await withPlatform("linux", async () => {
    await expect(
      preparePcapNativeBound(
        { REA_TSHARK_PRLIMIT_COMMAND: selected },
        resources,
        async () => output,
      ),
    ).rejects.toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      capturedOutput: output.capturedOutput,
    });
  });
});
