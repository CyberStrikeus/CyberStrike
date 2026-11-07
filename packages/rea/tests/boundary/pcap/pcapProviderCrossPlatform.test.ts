/**
 * Cross-platform pcap provider tests.
 *
 * POSIX hosts run the #!/bin/sh fixtures;
 * Windows runs the .cmd stubs from tests/fixtures/pcap/. Both validate
 * the same provider contract surface: tool probing, capture inspection,
 * refusal paths, and cancellation before spawn.
 */
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it, onTestFinished, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { PcapProvider } from "../../../src/pcap/PcapProvider.js";
import { PcapAnalysisService } from "../../../src/application/pcap/PcapAnalysisService.js";
import {
  CAPINFOS_COMMAND_ENV,
  TSHARK_COMMAND_ENV,
} from "../../../src/pcap/PcapConfiguration.js";
import { PcapSnapshot } from "../../../src/pcap/PcapSnapshot.js";
import * as regularFile from "../../../src/filesystem/RegularFile.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import type { PcapCommandLauncher } from "../../../src/pcap/PcapCommand.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import type { PcapRequest } from "../../../src/domain/pcap/pcapAnalysis.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";

const isWindows = process.platform === "win32";
const hasNativeBound = process.platform === "linux" || isWindows;
const stubDir = join(import.meta.dirname, "../../fixtures/pcap");
const tsharkStub = isWindows
  ? join(stubDir, "tshark-stub.cmd")
  : join(stubDir, "tshark-stub.sh");
const capinfosStub = isWindows
  ? join(stubDir, "capinfos-stub.cmd")
  : join(stubDir, "capinfos-stub.sh");

const providerOver = (launcher?: PcapCommandLauncher): PcapProvider => {
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: tsharkStub,
      REA_CAPINFOS_COMMAND: capinfosStub,
    },
    ...(launcher === undefined ? {} : { launcher }),
  });
  onTestFinished(() => provider.close());
  return provider;
};

it.skipIf(isWindows).each(["path", "explicit"] as const)(
  "retains the selected %s environment after a successful Wireshark probe",
  async (selection) => {
    const root = await createTestTempDirectory("rea-pcap-environment-");
    for (const [name, banner] of [
      ["tshark", "TShark"],
      ["capinfos", "Capinfos"],
    ] as const) {
      await writeFile(
        join(root, name),
        `#!/bin/sh
printf '${banner} (Wireshark) 4.6.6-%s\\n' "$PCAP_TEST_PROFILE"
printf '%s|%s|%s\\n' "$PCAP_TEST_PROFILE" "$PCAP_TEST_EMPTY" "\${PCAP_TEST_ABSENT-unset}" >> "$0.calls"
`,
        { mode: 0o755 },
      );
    }
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: root,
      PCAP_TEST_PROFILE: "selected",
      PCAP_TEST_EMPTY: "",
    };
    delete environment.PCAP_TEST_ABSENT;
    delete environment.REA_TSHARK_COMMAND;
    delete environment.REA_CAPINFOS_COMMAND;
    if (selection === "explicit") {
      environment.REA_TSHARK_COMMAND = join(root, "tshark");
      environment.REA_CAPINFOS_COMMAND = join(root, "capinfos");
    }
    const provider = new PcapProvider({ environment });
    onTestFinished(() => provider.close());
    const service = new PcapAnalysisService(provider);
    const first = await service.execute("inspect_pcap_client", {});
    if (!first.ok) throw first.error;
    expect(first.value.normalized_result).toMatchObject({
      client: {
        tshark_version: "TShark (Wireshark) 4.6.6-selected",
        capinfos_version: "Capinfos (Wireshark) 4.6.6-selected",
      },
    });
    environment.PATH = join(root, "missing-bin");
    environment.PCAP_TEST_PROFILE = "later";
    environment.PCAP_TEST_EMPTY = "later";
    environment.PCAP_TEST_ABSENT = "later";
    if (selection === "explicit") {
      environment.REA_TSHARK_COMMAND = join(root, "missing-tshark");
      environment.REA_CAPINFOS_COMMAND = join(root, "missing-capinfos");
    }
    const repeated = await service.execute("inspect_pcap_client", {});
    if (!repeated.ok) throw repeated.error;
    expect(repeated.value.normalized_result).toEqual(
      first.value.normalized_result,
    );
    expect(JSON.stringify(repeated.value)).not.toContain("PCAP_TEST_PROFILE");
    for (const name of ["tshark", "capinfos"])
      expect(await readFile(join(root, `${name}.calls`), "utf8")).toBe(
        "selected||unset\nselected||unset\n",
      );
  },
);

it.skipIf(isWindows)(
  "preserves selected Wireshark wrappers and re-admits changed symlink targets after success",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-pcap-selected-wrapper-",
    );
    const bin = join(directory, "bin"),
      libexec = join(directory, "libexec");
    await mkdir(bin);
    await mkdir(libexec);
    const source = join(libexec, "wrapper"),
      replacement = join(libexec, "replacement");
    const script =
      '#!/bin/sh\nselected="${0%/*}/${0##*/}"\nIFS= read -r banner < "$selected.version" || exit 19\nprintf "%s\\n" "$banner"\nif [ -f "$selected.retarget" ]; then\n  IFS= read -r target < "$selected.retarget"\n  /bin/ln -sf "$target" "$0"\nfi\n';
    for (const path of [source, replacement]) {
      await writeFile(path, script);
      await chmod(path, 0o755);
    }
    const tshark = join(bin, "tshark"),
      capinfos = join(bin, "capinfos");
    for (const [path, name] of [
      [tshark, "TShark"],
      [capinfos, "Capinfos"],
    ] as const) {
      await symlink(source, path);
      await writeFile(`${path}.version`, `${name} (Wireshark) 4.6.6-stub\n`);
    }
    expect(
      (await promisify(execFile)(tshark, ["--version"])).stdout.trim(),
    ).toBe("TShark (Wireshark) 4.6.6-stub");
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: tshark,
        REA_CAPINFOS_COMMAND: capinfos,
      },
    });
    onTestFinished(() => provider.close());
    const request = { operation: "inspect_pcap_client", input: {} } as const;
    const first = await evidenceResult(provider, request);
    expect(first.client).toMatchObject({
      tshark_command: tshark,
      tshark_resolved_path: await realpath(source),
      capinfos_command: capinfos,
    });
    await writeFile(`${tshark}.retarget`, `${replacement}\n`);
    const changed = await provider.execute(request);
    if (changed.ok) throw new Error("Changed selected wrapper was accepted");
    expect(projectAnalysisError(changed.error)).toMatchObject({
      code: "artifact_changed",
      details: {
        path: tshark,
        captured_output: { stdout: "TShark (Wireshark) 4.6.6-stub\n" },
      },
    });
    await unlink(`${tshark}.retarget`);
    const fresh = await evidenceResult(provider, request);
    expect(fresh.client).toMatchObject({
      tshark_command: tshark,
      tshark_resolved_path: await realpath(replacement),
    });
    expect(first.client).toMatchObject({
      tshark_resolved_path: await realpath(source),
    });
  },
);

const evidenceResult = async (
  provider: PcapProvider,
  request: PcapRequest,
): Promise<Record<string, unknown>> => {
  const result = await provider.execute(request);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.result as Record<string, unknown>;
};

// Windows keeps PATH/PATHEXT resolution in the launcher; POSIX hosts locate the file.
it.skipIf(isWindows)(
  "runs and reports the tools located on PATH rather than bare names",
  async () => {
    const directory = await createTestTempDirectory("rea-pcap-path-");
    await symlink(tsharkStub, join(directory, "tshark"));
    await symlink(capinfosStub, join(directory, "capinfos"));
    const provider = new PcapProvider({
      environment: { PATH: `relative-entry:${directory}` },
    });
    onTestFinished(() => provider.close());
    const result = await evidenceResult(provider, {
      operation: "inspect_pcap_client",
      input: {},
    });
    expect(result.client).toMatchObject({
      tshark_command: join(directory, "tshark"),
      tshark_source: "path",
      tshark_version: expect.stringContaining("4.6.6") as unknown,
      tshark_resolved_path: await realpath(tsharkStub),
      tshark_sha256: createHash("sha256")
        .update(await readFile(join(directory, "tshark")))
        .digest("hex"),
      tshark_identity_status: "verified",
      capinfos_command: join(directory, "capinfos"),
      capinfos_source: "path",
      capinfos_resolved_path: await realpath(capinfosStub),
      capinfos_sha256: createHash("sha256")
        .update(await readFile(join(directory, "capinfos")))
        .digest("hex"),
      capinfos_identity_status: "verified",
    });
  },
);

it("inspects both tools through cross-platform stubs", async () => {
  const result = await evidenceResult(providerOver(), {
    operation: "inspect_pcap_client",
    input: {},
  });
  expect(result.client).toMatchObject({
    tshark_source: "environment",
    tshark_version: expect.stringContaining("4.6.6") as unknown,
    tshark_resolved_path: await realpath(tsharkStub),
    capinfos_source: "environment",
    capinfos_version: expect.stringContaining("4.6.6") as unknown,
    capinfos_resolved_path: await realpath(capinfosStub),
    tshark_sha256: createHash("sha256")
      .update(await readFile(tsharkStub))
      .digest("hex"),
    tshark_identity_status: "verified",
    capinfos_sha256: createHash("sha256")
      .update(await readFile(capinfosStub))
      .digest("hex"),
    capinfos_identity_status: "verified",
  });
});

it("projects a missing configured tool as a capability gap", async () => {
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: tsharkStub,
      REA_CAPINFOS_COMMAND: join(import.meta.dirname, "missing-capinfos"),
    },
  });
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "inspect_pcap_client",
    input: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "capability_unavailable",
    details: { provider_id: "pcap", operation: "inspect_pcap_client" },
  });
  expect(projected.message).toContain(TSHARK_COMMAND_ENV);
  expect(projected.message).toContain(CAPINFOS_COMMAND_ENV);
  expect(projected.message).toContain("Wireshark 4.x");
  expect(projected.message).toContain("PATH");
  expect(projected.message).toContain("absolute");
  expect(projected.message).toContain("does not install");
});

it.skipIf(isWindows)(
  "rejects TShark that changes during its version probe",
  async () => {
    const directory = await createTestTempDirectory("rea-pcap-mutated-tool-");
    const tshark = join(directory, "tshark");
    const capinfos = join(directory, "capinfos");
    await writeFile(
      tshark,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'TShark (Wireshark) 4.6.6-stub\\n'
  printf '\\n# changed during version probe\\n' >> "$0"
  exit 0
fi
exit 2
`,
      { mode: 0o755 },
    );
    await symlink(capinfosStub, capinfos);
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: tshark,
        REA_CAPINFOS_COMMAND: capinfos,
      },
    });
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "inspect_pcap_client",
      input: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "artifact_changed",
        details: { path: tshark },
      });
  },
);

it.each([0, 7])(
  "retains failed-probe cleanup across admission retry and resolves after owner close: exit=%s",
  async (exitCode) => {
    let mayClean = false;
    let launches = 0;
    const launcher: PcapCommandLauncher = async (spawn) => {
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: [
          "-e",
          `process.stdout.write("TShark (Wireshark) 4.6.6\\n"); process.exitCode = ${exitCode}`,
        ],
        expectedCommand: process.execPath,
      });
      launches++;
      if (launches !== 1) return launched;
      const cleanup =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          const result = await cleanup();
          if (!mayClean) throw new Error("injected tool-probe cleanup failure");
          return result;
        },
      };
    };
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: tsharkStub,
        REA_CAPINFOS_COMMAND: capinfosStub,
      },
      launcher,
    });
    onTestFinished(async () => {
      mayClean = true;
      await provider.close();
    });

    const result = await provider.execute({
      operation: "inspect_pcap_client",
      input: {},
    });
    if (result.ok) throw new Error("Expected retained tool-probe cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    if (exitCode === 0)
      expect(result.error.diagnostics).toMatchObject({
        reason: "injected tool-probe cleanup failure",
      });
    else {
      expect(result.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        capturedOutput: { exit_code: 7 },
      });
    }
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    const retry = await provider.execute({
      operation: "inspect_pcap_client",
      input: {},
    });
    if (retry.ok)
      throw new Error("Expected retained cleanup to block admission");
    expect(projectAnalysisError(retry.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: expect.arrayContaining([...result.error.cleanupResources]),
      },
    });
    expect(retry.error.cleanupResources.length).toBeGreaterThan(0);
    expect(launches).toBe(1);

    mayClean = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(retry.error.cleanupIncomplete).toBe(false);
    expect(launches).toBe(1);
  },
);

it.runIf(hasNativeBound)(
  "inspects a capture with metadata, endpoints, DNS, and protocol facts",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-x-");
    const capturePath = join(root, "capture.pcap");
    const captureBytes = "cross-platform-pcap-fixture";
    await writeFile(capturePath, captureBytes);

    const result = await evidenceResult(providerOver(), {
      operation: "inspect_pcap_capture",
      input: { path: capturePath },
    });

    expect(result.target).toMatchObject({
      path: capturePath,
      bytes: captureBytes.length,
      sha256: createHash("sha256").update(captureBytes).digest("hex"),
    });
    expect(result.file_type).toContain("pcap");
    expect(result.packet_count).toBe(3);
    expect(result.capture_start).toBe("2026-10-11T14:13:40.608505Z");
    expect(result.capture_end).toBe("2026-10-11T14:13:40.981978Z");
    expect((result.endpoints as unknown[]).length).toBeGreaterThan(0);
    expect((result.protocol_distribution as unknown[]).length).toBeGreaterThan(
      0,
    );
    expect(result.dns_queries).toEqual([
      {
        query: "api.example.com",
        query_labels_hex: ["617069", "6578616d706c65", "636f6d"],
        response_addresses: ["93.184.216.34"],
        response_address_count: 1,
      },
    ]);
    expect(result.unattributed_dns_addresses).toEqual([]);
    expect(result.unattributed_dns_address_count).toBe(0);
    expect(result.unattributed_dns_packet_count).toBe(0);
    expect(result.coverage).toBe("complete");
  },
);

// Hosts without a native bound refuse before touching the path; that order
// is pinned by the unsupported-boundary test below.
it.runIf(hasNativeBound)(
  "rejects a path that is not a readable file",
  async () => {
    const result = await providerOver().execute({
      operation: "inspect_pcap_capture",
      input: { path: "/nonexistent/definitely-missing.pcap" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
    });
  },
);

it("reports a missing binary as a capability gap", async () => {
  const provider = new PcapProvider({
    environment: { REA_TSHARK_COMMAND: "/nonexistent/tshark" },
  });
  expect(await provider.inspectAvailability()).toMatchObject({
    status: "unavailable",
    code: "executable_missing",
  });
});

it("cancels before spawning anything", async () => {
  const controller = new AbortController();
  controller.abort();
  const launcher = vi.fn<NonNullable<PcapCommandLauncher>>(async () => {
    throw new Error("Cancelled analysis must not launch a tool");
  });
  const result = await providerOver(launcher).execute(
    { operation: "inspect_pcap_capture", input: { path: "/any/capture.pcap" } },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
  });
  expect(launcher).not.toHaveBeenCalled();
});

it.runIf(!hasNativeBound)(
  "reports an unsupported native memory boundary before reading the capture",
  async () => {
    const provider = providerOver();
    expect(await provider.inspectAvailability()).toMatchObject({
      status: "unavailable",
      code: "unsupported_host",
    });
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path: "/not-opened/capture.pcap" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "capability_unavailable",
      details: { provider_id: "pcap", operation: "inspect_pcap_capture" },
    });
    // The refusal concerns this host, so it must not suggest another target.
    const reason =
      projected.details &&
      "reason" in projected.details &&
      typeof projected.details.reason === "string"
        ? projected.details.reason
        : "";
    expect(reason).toContain("Linux");
    expect(reason).toContain("util-linux");
    expect(reason).toContain("prlimit");
    expect(reason).toContain("Windows");
    expect(reason).toContain("owned");
    expect(reason).toContain("Job Objects");
    expect(projected.remediation.action).toBe(projected.message);
  },
);

it("retains a verification admission owner before translating cancellation", async () => {
  const root = await createTestTempDirectory("rea-pcap-verify-admission-");
  const path = join(root, "held.bin");
  await writeFile(path, "held capture bytes");
  const handle = await open(path, "r");
  const owner = new OwnedFileHandle(handle);
  const controller = new AbortController();
  const reason = null;
  const snapshot = await PcapSnapshot.create();
  const admission = vi
    .spyOn(regularFile, "openRegularFile")
    .mockImplementationOnce(async () => {
      controller.abort(reason);
      throw new regularFile.RegularFileAdmissionFailure(
        snapshot.path,
        new regularFile.RegularFileOperationCancelled(reason),
        new Error("admission close unavailable"),
        owner,
      );
    });
  try {
    await expect(
      snapshot.verify({ bytes: 0, sha256: "unused" }, path, controller.signal),
    ).rejects.toMatchObject({ _tag: "AnalysisCancelledError", cause: reason });
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    await snapshot.close();
    expect(handle.fd).toBe(-1);
  } finally {
    admission.mockRestore();
    await snapshot.close();
    await owner.close();
  }
});

it.each(["tshark", "capinfos"] as const)(
  "classifies directory-selected %s as a configuration refusal with its path",
  async (tool) => {
    const root = await createTestTempDirectory("rea-pcap-tool-directory-");
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: tool === "tshark" ? root : tsharkStub,
        REA_CAPINFOS_COMMAND: tool === "capinfos" ? root : capinfosStub,
      },
    });
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "inspect_pcap_client",
      input: {},
    });
    if (result.ok) throw new Error("Expected selected tool admission refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining(root),
      details: { provider_id: "pcap", operation: "inspect_pcap_client" },
    });
    expect(projectAnalysisError(result.error).message).toContain(
      "Wireshark 4.x",
    );
  },
);
