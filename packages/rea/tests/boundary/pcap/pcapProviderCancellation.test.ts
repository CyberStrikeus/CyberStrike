import { realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";

import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
} from "../../../src/domain/analysisErrorCore.js";
import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { resolvedAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { PcapProvider } from "../../../src/pcap/PcapProvider.js";
import type { PcapCommandLauncher } from "../../../src/pcap/PcapCommand.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const it = test.skipIf(process.platform === "win32");

vi.mock("../../../src/pcap/PcapNativeBound.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/pcap/PcapNativeBound.js")
  >()),
  // Exercise the provider's capture consumer with real owned children on hosts
  // where its production native bound is unavailable (including macOS).
  preparePcapNativeBound: async () => ({ nativeBound: {}, limitations: [] }),
}));

const writeTool = async (
  root: string,
  name: string,
  body: string,
): Promise<string> => {
  const path = join(root, name);
  await writeFile(path, `#!/usr/bin/env -S ${process.execPath}\n${body}\n`, {
    mode: 0o755,
  });
  return path;
};

const writeTools = async (
  root: string,
  capinfosMode: "active" | "physical" | "complete",
  activeVersion = false,
): Promise<{ readonly tshark: string; readonly capinfos: string }> => {
  const tshark = await writeTool(
    root,
    "tshark.cjs",
    `if (process.argv[2] === "--version") { ${activeVersion ? 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000);' : 'console.log("TShark (Wireshark) 4.6.6-test"); process.exit(0);'} }\nconsole.log("[]");`,
  );
  const capinfosBody =
    capinfosMode === "active"
      ? `if (process.argv[2] === "--version") { console.log("Capinfos (Wireshark) 4.6.6-test"); process.exit(0); }\nprocess.stdout.write("ready\\n"); setInterval(() => {}, 1000);`
      : capinfosMode === "physical"
        ? `if (process.argv[2] === "--version") { console.log("Capinfos (Wireshark) 4.6.6-test"); process.exit(0); }\nprocess.stderr.write("authored producer failure\\n"); process.exitCode = 7;`
        : `if (process.argv[2] === "--version") { console.log("Capinfos (Wireshark) 4.6.6-test"); process.exit(0); }\nprocess.stdout.write(${JSON.stringify("File name:           /work/capture.pcap\nFile type:           Wireshark/tcpdump/... - pcap\nFile encapsulation:  Ethernet\nPacket size limit:   file hdr: 262144 bytes\nNumber of packets:   0\nCapture duration:    0.000 seconds\nEarliest packet time: 1791728020.608505\nLatest packet time:   1791728020.608505\n")});`;
  const capinfos = await writeTool(root, "capinfos.cjs", capinfosBody);
  return { tshark, capinfos };
};

const fixture = async (
  mode: "active" | "physical" | "complete",
  controller: AbortController,
  reason: unknown,
  failedCleanupAttempts: number,
  activeVersion = false,
  artifactReader: typeof readStableArtifact = readStableArtifact,
) => {
  const root = await createTestTempDirectory("rea-pcap-provider-cancel-");
  const tools = await writeTools(root, mode, activeVersion);
  const capture = join(root, "capture.pcap");
  await writeFile(capture, "controlled capture bytes");
  let cleanupAttempts = 0;
  const launcher: PcapCommandLauncher = async (spawn) => {
    const launched = await spawnOwnedProviderProcess(spawn);
    const captureCommand = spawn.arguments.includes("-M");
    const activeVersionCommand =
      activeVersion && spawn.arguments.includes("--version");
    if (!captureCommand && !activeVersionCommand) return launched;
    if (activeVersionCommand) controller.abort(reason);
    if (mode === "active" && captureCommand)
      launched.process.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) controller.abort(reason);
      });
    if (!captureCommand) return launched;
    const cleanup =
      launched.cleanup ?? (() => cleanupOwnedProcessGroup(launched.ownership));
    return {
      ...launched,
      cleanup: async () => {
        cleanupAttempts += 1;
        if (mode === "physical") controller.abort(reason);
        if (cleanupAttempts <= failedCleanupAttempts)
          throw new Error("injected retained cleanup failure");
        const result = await cleanup();
        return result;
      },
    };
  };
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: tools.tshark,
      REA_CAPINFOS_COMMAND: tools.capinfos,
    },
    launcher,
    artifactReader,
  });
  onTestFinished(async () => provider.close());
  return { provider, root, capture, cleanupAttempts: () => cleanupAttempts };
};

// The tshark version probe's owned process cleanup fails once, and the tool's
// bytes appear changed when the probe re-reads it after the run.
const probeCleanupFixture = async (rereadCloseFailure = false) => {
  const root = await createTestTempDirectory("rea-pcap-probe-cleanup-");
  const tools = await writeTools(root, "complete");
  const tshark = await realpath(tools.tshark);
  let tsharkReads = 0;
  let probeCleanupAttempts = 0;
  const launcher: PcapCommandLauncher = async (spawn) => {
    const launched = await spawnOwnedProviderProcess(spawn);
    if (!spawn.arguments.includes("--version")) return launched;
    const cleanup =
      launched.cleanup ?? (() => cleanupOwnedProcessGroup(launched.ownership));
    return {
      ...launched,
      cleanup: async () => {
        probeCleanupAttempts += 1;
        if (probeCleanupAttempts === 1)
          throw new Error("injected probe cleanup failure");
        return cleanup();
      },
    };
  };
  const artifactReader: typeof readStableArtifact = async (...args) => {
    const snapshot = await readStableArtifact(...args);
    if (args[0] !== tshark) return snapshot;
    tsharkReads += 1;
    // Reads: identity capture, pre-run check, post-run check.
    if (tsharkReads !== 3) return snapshot;
    if (!rereadCloseFailure) return { ...snapshot, sha256: "0".repeat(64) };
    const resource = `executable-read:${tshark}`;
    const lease = new AnalysisCleanupLease(async () => {}, [resource]);
    args[4]?.retain({ kind: "lease", resource, lease });
    throw new ArtifactReaderFailure("io", "injected executable read failure", {
      cleanup: { reason: "injected file close failure", resources: [resource] },
      cleanupLeases: [lease],
    });
  };
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: tools.tshark,
      REA_CAPINFOS_COMMAND: tools.capinfos,
    },
    launcher,
    artifactReader,
  });
  onTestFinished(async () => provider.close());
  return provider;
};

it("reports a probe's pending cleanup when its post-run identity check fails", async () => {
  const provider = await probeCleanupFixture();
  const result = await provider.execute({
    operation: "inspect_pcap_client",
    input: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
  expect(result.error.cleanupPrimary).toBeInstanceOf(
    AnalysisArtifactChangedError,
  );
  expect(
    result.error.cleanupResources.some((path) =>
      path.startsWith("process-group:"),
    ),
  ).toBe(true);
});

it("keeps an executable re-read's own cleanup live beside the probe's pending cleanup", async () => {
  const provider = await probeCleanupFixture(true);
  const result = await provider.execute({
    operation: "inspect_pcap_client",
    input: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^executable-read:/u),
      expect.stringMatching(/^process-group:/u),
    ]),
  );
  await provider.close();
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("availability surfaces a probe's pending cleanup instead of reporting the tool unavailable", async () => {
  const provider = await probeCleanupFixture();
  let failure: unknown;
  try {
    await provider.inspectAvailability();
  } catch (cause) {
    failure = cause;
  }
  expect(failure).toMatchObject({ cleanupIncomplete: true });
  expect(
    (failure as { cleanupPrimary?: unknown }).cleanupPrimary,
  ).toBeInstanceOf(AnalysisArtifactChangedError);
});

it("availability preserves the producer's exact cancellation reason", async () => {
  const controller = new AbortController();
  const reason = new ProviderCleanupError(
    "caller-owned",
    ["foreign resource"],
    { reason: "opaque caller reason" },
  );
  const { provider } = await fixture("active", controller, reason, 0, true);
  let failure: unknown;
  try {
    await provider.inspectAvailability(controller.signal);
  } catch (cause) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(AnalysisCancelledError);
  expect(failure).toMatchObject({ cause: reason });
});

it("executable identity hashing preserves artifact-read cancellation", async () => {
  const controller = new AbortController();
  const reason = { caller: "cancel executable identity read" };
  const { provider } = await fixture(
    "active",
    controller,
    reason,
    0,
    false,
    async () => {
      throw new ArtifactReaderFailure("cancelled", "identity read cancelled", {
        cancellation: { reason },
      });
    },
  );
  const result = await provider.execute(
    { operation: "inspect_pcap_client", input: {} },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
});

it("active cancellation stays primary through retained command and snapshot cleanup retry", async () => {
  const controller = new AbortController();
  const reason = "caller cancellation token";
  const { provider, capture, cleanupAttempts } = await fixture(
    "active",
    controller,
    reason,
    2,
  );
  const result = await provider.execute(
    {
      operation: "inspect_pcap_capture",
      input: { path: capture },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const returned = result.error;
  const primary = returned.cleanupPrimary;
  expect(primary).toBeInstanceOf(AnalysisCancelledError);
  expect(primary?.cause).toBe(reason);
  expect(projectAnalysisError(returned).code).toBe("cleanup_incomplete");
  expect(
    returned.cleanupResources.some((path) => path.startsWith("process-group:")),
  ).toBe(true);
  expect(
    returned.cleanupResources.some((path) => path.endsWith("/capture.pcap")),
  ).toBe(true);

  const blocked = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path: capture },
  });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.error).toBeInstanceOf(ProviderCleanupError);
    expect(blocked.error.cleanupResources).toEqual(returned.cleanupResources);
  }

  const snapshotPath = returned.cleanupResources.find((path) =>
    path.endsWith("/capture.pcap"),
  );
  if (snapshotPath === undefined) throw new Error("Missing retained snapshot");
  const close = PrivateRuntimeRoot.prototype.close;
  const denied = vi
    .spyOn(PrivateRuntimeRoot.prototype, "close")
    .mockImplementation(function (this: PrivateRuntimeRoot) {
      if (this.path === dirname(snapshotPath))
        return Promise.reject(new Error("injected snapshot close failure"));
      return close.call(this);
    });
  try {
    let firstCloseFailure: unknown;
    try {
      await provider.close();
    } catch (cause) {
      firstCloseFailure = cause;
    }
    expect(firstCloseFailure).toBeInstanceOf(ProviderCleanupError);
    expect(firstCloseFailure).toMatchObject({ cleanupIncomplete: true });
    const closeFailure = firstCloseFailure as ProviderCleanupError;
    expect(closeFailure.cleanupResources).toContain(snapshotPath);
    expect(
      closeFailure.cleanupResources.some((path) =>
        path.startsWith("process-group:"),
      ),
    ).toBe(true);
    expect(cleanupAttempts()).toBe(2);
    // The next close releases the command but the deliberately denied snapshot
    // close leaves only that exact owner in the first close error.
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(closeFailure.cleanupResources).toEqual([snapshotPath]);
    expect(closeFailure.cleanupIncomplete).toBe(true);
    expect(returned.cleanupIncomplete).toBe(true);
    expect(returned.cleanupResources).toEqual([snapshotPath]);
    denied.mockRestore();
    await provider.close();
    expect(closeFailure.cleanupIncomplete).toBe(false);
    expect(closeFailure.cleanupResources).toEqual([]);
  } finally {
    denied.mockRestore();
  }
  expect(returned.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(returned)).toBe(primary);
});

it("a physical command failure survives a late cancellation and cleanup retry", async () => {
  const controller = new AbortController();
  const reason = { caller: "late abort" };
  const { provider, capture } = await fixture(
    "physical",
    controller,
    reason,
    1,
  );
  const result = await provider.execute(
    {
      operation: "inspect_pcap_capture",
      input: { path: capture },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const returned = result.error;
  const primary = returned.cleanupPrimary;
  expect(primary?._tag).toBe("AnalysisProtocolError");
  expect(primary?.cause).not.toBe(reason);
  expect(projectAnalysisError(returned).code).toBe("cleanup_incomplete");
  expect(returned.capturedOutput?.stderr).toContain(
    "authored producer failure",
  );
  await provider.close();
  expect(returned.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(returned)).toBe(primary);
});

it("resolves the original completed-output cleanup error after retry", async () => {
  const controller = new AbortController();
  const { provider, capture, cleanupAttempts } = await fixture(
    "complete",
    controller,
    undefined,
    1,
  );
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path: capture },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const returned = result.error;
  expect(returned).toBeInstanceOf(ProviderCleanupError);
  expect(returned.diagnostics).toMatchObject({ previous_error: null });
  expect(returned.partialObservation).toBeDefined();
  expect(returned.cleanupIncomplete).toBe(true);
  await provider.close();
  expect(cleanupAttempts()).toBe(2);
  expect(returned.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(returned)).toBe(returned);
});
