import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";

import { PcapProvider } from "../../../src/pcap/PcapProvider.js";
import {
  CAPINFOS_COMMAND_ENV,
  TSHARK_COMMAND_ENV,
} from "../../../src/pcap/PcapConfiguration.js";
import { primaryAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  pcapResultSchemas,
  type PcapRequest,
} from "../../../src/domain/pcap/pcapAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { holdFirstFileRead } from "../../support/holdFirstFileRead.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import type { PcapCommandLauncher } from "../../../src/pcap/PcapCommand.js";
import {
  CAPINFOS_OUTPUT,
  TSHARK_JSON,
  TSHARK_DNS_JSON,
  writeStubTools,
  type PcapStubToolsOptions,
} from "../../fixtures/pcap/pcapTestTools.js";

const it = test.skipIf(process.platform !== "linux");
const posixIt = test.skipIf(process.platform === "win32");

const providerWith = async (
  options: PcapStubToolsOptions & {
    launcher?: PcapCommandLauncher;
    beforeClose?: () => void;
  } = {},
) => {
  const root = await createTestTempDirectory("rea-pcap-");
  const { tshark, capinfos } = await writeStubTools(root, options);
  const provider = new PcapProvider({
    environment: { REA_TSHARK_COMMAND: tshark, REA_CAPINFOS_COMMAND: capinfos },
    ...(options.launcher === undefined ? {} : { launcher: options.launcher }),
  });
  onTestFinished(async () => {
    options.beforeClose?.();
    await provider.close();
  });
  return {
    provider,
    root,
  };
};

const evidenceResult = async (
  provider: PcapProvider,
  request: PcapRequest,
): Promise<Record<string, unknown>> => {
  const result = await provider.execute(request);
  if (!result.ok) throw new Error(result.error.message);
  return pcapResultSchemas[request.operation].parse(result.value.result);
};

const captureFixture = async (root: string): Promise<string> => {
  const path = join(root, "capture.pcap");
  await writeFile(path, Buffer.from("pcap-fixture-bytes"));
  return path;
};

it("inspects both tools without reading a capture", async () => {
  const { provider, root } = await providerWith();
  const result = await evidenceResult(provider, {
    operation: "inspect_pcap_client",
    input: {},
  });
  expect(result.client).toMatchObject({
    tshark_source: "environment",
    tshark_version: "TShark (Wireshark) 4.6.6-stub",
    tshark_sha256: createHash("sha256")
      .update(await readFile(join(root, "tshark")))
      .digest("hex"),
    tshark_identity_status: "verified",
    capinfos_source: "environment",
    capinfos_version: "Capinfos (Wireshark) 4.6.6-stub",
    capinfos_sha256: createHash("sha256")
      .update(await readFile(join(root, "capinfos")))
      .digest("hex"),
    capinfos_identity_status: "verified",
  });
});

it("inspects a capture with endpoints, DNS, TLS SNI, and HTTP", async () => {
  const { provider, root } = await providerWith();
  const path = await captureFixture(root);
  const result = await evidenceResult(provider, {
    operation: "inspect_pcap_capture",
    input: { path },
  });
  expect(result.target).toMatchObject({
    path,
    bytes: 18,
    sha256: createHash("sha256").update("pcap-fixture-bytes").digest("hex"),
  });
  expect(result.file_type).toBe("Wireshark/tcpdump/... - pcap");
  expect(result.capture_start).toBe("2026-10-11T14:13:40.608505Z");
  expect(result.capture_end).toBe("2026-10-11T14:13:40.981978Z");
  expect(result.packet_count).toBe(3);
  expect(result.snapshot_length).toBe(262144);
  expect(result.endpoints).toEqual(
    expect.arrayContaining([
      { address: "192.168.1.100", port: null, packet_count: 3 },
      { address: "8.8.8.8", port: null, packet_count: 1 },
    ]),
  );
  expect(result.dns_queries).toEqual([
    {
      query: "api.example.com",
      query_labels_hex: ["617069", "6578616d706c65", "636f6d"],
      response_addresses: ["93.184.216.34"],
      response_address_count: 1,
    },
  ]);
  expect(result.tls_sni_values).toEqual(["api.example.com"]);
  expect(result.http_request_uris).toEqual(["http://api.example.com/v1/data"]);
  expect(result.coverage).toBe("complete");
});

it.each([0, 1])(
  "preserves packet-count mismatch facts while accepting an empty capture: capinfos=%s",
  async (count) => {
    const { provider, root } = await providerWith({
      tsharkJson: "[]",
      dnsJson: "[]",
      capinfosText: `File type: pcap\nFile encapsulation: Ethernet\nNumber of packets: ${String(count)}\n`,
    });
    const path = await captureFixture(root);
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    if (count === 0) {
      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({
        packet_count: 0,
        coverage: "complete",
      });
    } else {
      if (result.ok) throw new Error("Expected contradictory counts");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "unreadable_output",
        details: {
          diagnostics: {
            reason: "packet_count_mismatch",
            capinfos_packet_count: 1,
            tshark_packet_count: 0,
          },
        },
      });
    }
  },
);

it("retains both observed digests when capinfos disagrees with the snapshot", async () => {
  const reported = "0".repeat(64);
  const { provider, root } = await providerWith({
    capinfosText: `File type: pcap\nFile encapsulation: Ethernet\nNumber of packets: 0\nSHA256: ${reported}\n`,
  });
  const path = await captureFixture(root);
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path },
  });
  if (result.ok) throw new Error("Expected contradictory snapshot digest");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unreadable_output",
    details: {
      diagnostics: {
        reason: "capture_sha256_mismatch",
        capinfos_sha256: reported,
        snapshot_sha256: createHash("sha256")
          .update("pcap-fixture-bytes")
          .digest("hex"),
      },
    },
  });
});

it("retains an absolute HTTP request target without a Host-derived full URI", async () => {
  const { provider, root } = await providerWith({ httpAbsoluteUriOnly: true });
  const path = await captureFixture(root);
  const result = await evidenceResult(provider, {
    operation: "inspect_pcap_capture",
    input: { path },
  });
  expect(result.http_request_uris).toEqual(["http://proxy.example.test/path"]);
  expect(result.coverage).toBe("complete");
});

it.each(["stdout", "stderr"] as const)(
  "refuses replacement-decoded TShark %s and names its invalid stream",
  async (stream) => {
    const { provider, root } = await providerWith({
      invalidTsharkStream: stream,
    });
    const path = await captureFixture(root);
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed producer encoding");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
      details: {
        diagnostics: { stage: "tshark", invalid_utf8_streams: [stream] },
      },
    });
  },
);

it("keeps a literal replacement character in valid TShark UTF-8", async () => {
  const { provider, root } = await providerWith({ literalReplacement: true });
  const path = await captureFixture(root);
  const result = await evidenceResult(provider, {
    operation: "inspect_pcap_capture",
    input: { path },
  });
  expect(result.http_request_uris).toEqual(["http://api.example.com/�"]);
  expect(result.coverage).toBe("complete");
});

posixIt.each(["stdout", "stderr"] as const)(
  "refuses replacement-decoded TShark version %s before banner parsing",
  async (stream) => {
    const { provider } = await providerWith({
      invalidTsharkVersionStream: stream,
    });
    const result = await provider.execute({
      operation: "inspect_pcap_client",
      input: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed version output");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
      details: {
        diagnostics: { stage: "version", invalid_utf8_streams: [stream] },
      },
    });
  },
);

it.each(["stdout", "stderr"] as const)(
  "refuses replacement-decoded capinfos %s before metadata parsing",
  async (stream) => {
    const { provider, root } = await providerWith({
      invalidCapinfosStream: stream,
    });
    const path = await captureFixture(root);
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed producer encoding");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
      details: {
        diagnostics: { stage: "capinfos", invalid_utf8_streams: [stream] },
      },
    });
  },
);

it.each([
  { stage: "capinfos", denySnapshotClose: false },
  { stage: "tshark", denySnapshotClose: false },
  { stage: "capinfos", denySnapshotClose: true },
  { stage: "tshark", denySnapshotClose: true },
] as const)(
  "retires $stage cleanup with its snapshot (snapshot close denied: $denySnapshotClose)",
  async ({ stage, denySnapshotClose }) => {
    let mayClean = false;
    let producerLaunches = 0;
    let cleanupAttempts = 0;
    const launcher: PcapCommandLauncher = async (spawn) => {
      const selectedStage = spawn.arguments.includes("-M")
        ? "capinfos"
        : spawn.arguments.includes("-T")
          ? "tshark"
          : undefined;
      const launched = await spawnOwnedProviderProcess(spawn);
      if (selectedStage !== stage) return launched;
      producerLaunches += 1;
      const cleanupOwned =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          cleanupAttempts++;
          const cleaned = await cleanupOwned();
          if (!mayClean) throw new Error("injected retained cleanup failure");
          return cleaned;
        },
      };
    };
    const { provider, root } = await providerWith({
      launcher,
      beforeClose: () => {
        mayClean = true;
      },
    });
    const path = await captureFixture(root);
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    if (result.ok) throw new Error("Expected cleanup to remain unresolved");
    expect(result.error).toMatchObject({ cleanupIncomplete: true });
    expect(result.error.diagnostics).toMatchObject({
      reason: "injected retained cleanup failure",
      previous_error: null,
      captured_output: {
        stdout: stage === "capinfos" ? CAPINFOS_OUTPUT + "\n" : TSHARK_JSON,
        truncated: false,
      },
    });
    expect(result.error.partialObservation).toMatchObject({
      normalized_result:
        stage === "capinfos"
          ? {
              stage: "capinfos-complete-tshark-not-run",
              packet_count: 3,
            }
          : {
              coverage: "partial",
              packet_count: 3,
              endpoints: expect.any(Array),
            },
    });
    expect(producerLaunches).toBe(1);
    expect(
      Buffer.compare(await readFile(path), Buffer.from("pcap-fixture-bytes")),
    ).toBe(0);
    const snapshotPath = result.error.cleanupResources.find((resource) =>
      resource.endsWith("/capture.pcap"),
    );
    if (snapshotPath === undefined)
      throw new Error("Missing retained snapshot");
    expect(
      result.error.cleanupResources.some((resource) =>
        resource.startsWith("process-group:"),
      ),
    ).toBe(true);
    const originatingCause = result.error.cause;
    const originatingObservation = result.error.partialObservation;
    const attemptsBeforeClose = cleanupAttempts;
    mayClean = true;
    if (denySnapshotClose) {
      const close = PrivateRuntimeRoot.prototype.close;
      const denied = vi
        .spyOn(PrivateRuntimeRoot.prototype, "close")
        .mockImplementation(function (this: PrivateRuntimeRoot) {
          if (this.path === dirname(snapshotPath))
            return Promise.reject(new Error("injected snapshot close failure"));
          return close.call(this);
        });
      try {
        await expect(provider.close()).rejects.toMatchObject({
          cleanupIncomplete: true,
        });
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(cleanupAttempts).toBe(attemptsBeforeClose + 1);
        expect(
          Buffer.compare(
            await readFile(snapshotPath),
            Buffer.from("pcap-fixture-bytes"),
          ),
        ).toBe(0);
      } finally {
        denied.mockRestore();
      }
    }
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cause).toBe(originatingCause);
    expect(result.error.partialObservation).toBe(originatingObservation);
    expect(cleanupAttempts).toBe(attemptsBeforeClose + 1);
    await expect(readFile(snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("reports a non-capture file as unsupported", async () => {
  const { provider, root } = await providerWith({ failCapinfos: true });
  const failPath = join(root, "fail.pcap");
  await writeFile(failPath, "not a capture file");
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path: failPath },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unsupported_target",
  });
});

it("rejects a capture that is not a readable file", async () => {
  const { provider } = await providerWith();
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path: "/nonexistent/capture.pcap" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
  });
});

it("reports relative configuration and missing capinfos as capability gaps", async () => {
  const root = await createTestTempDirectory("rea-pcap-config-");
  const { tshark } = await writeStubTools(root);
  for (const environment of [
    { REA_TSHARK_COMMAND: "relative/tshark" },
    {
      REA_TSHARK_COMMAND: tshark,
      REA_CAPINFOS_COMMAND: join(root, "missing-capinfos"),
    },
  ]) {
    const provider = new PcapProvider({ environment });
    onTestFinished(() => provider.close());
    expect((await provider.inspectAvailability()).status).toBe("unavailable");
    const result = await provider.execute({
      operation: "inspect_pcap_client",
      input: {},
    });
    if (result.ok) throw new Error("expected unavailable tools");
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
  }
});

it("names the prlimit selection when the Linux limiter is unusable", async () => {
  const root = await createTestTempDirectory("rea-pcap-prlimit-");
  const tools = await writeStubTools(root);
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: tools.tshark,
      REA_CAPINFOS_COMMAND: tools.capinfos,
      REA_TSHARK_PRLIMIT_COMMAND: "relative/prlimit",
    },
  });
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path: "/not-opened/capture.pcap" },
  });
  if (result.ok) throw new Error("expected an unusable limiter");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "capability_unavailable",
    details: { provider_id: "pcap", operation: "inspect_pcap_capture" },
  });
  expect(projected.message).toContain("must be absolute");
  expect(projected.message).toContain("Check that REA_TSHARK_PRLIMIT_COMMAND");
});

it("rejects directory and non-prlimit selections before opening the capture", async () => {
  const root = await createTestTempDirectory("rea-pcap-invalid-limiter-");
  const tools = await writeStubTools(root);
  for (const configured of [root, "/usr/bin/true"]) {
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: tools.tshark,
        REA_CAPINFOS_COMMAND: tools.capinfos,
        REA_TSHARK_PRLIMIT_COMMAND: configured,
      },
    });
    try {
      const result = await provider.execute({
        operation: "inspect_pcap_capture",
        input: { path: "/not-opened/capture.pcap" },
      });
      if (result.ok) throw new Error("expected an unusable limiter");
      const error = projectAnalysisError(result.error);
      expect(error).toMatchObject({
        code: "capability_unavailable",
        details: {
          diagnostics: {
            configuration_key: "REA_TSHARK_PRLIMIT_COMMAND",
            configured,
          },
        },
      });
      expect(error.message).toContain("REA_TSHARK_PRLIMIT_COMMAND");
      expect(error.message).not.toContain("Cannot run selected tool");
    } finally {
      await provider.close();
    }
  }
});

it("rejects a different util-linux command before opening capture bytes", async () => {
  const root = await createTestTempDirectory("rea-pcap-other-util-linux-");
  const tools = await writeStubTools(root);
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: tools.tshark,
      REA_CAPINFOS_COMMAND: tools.capinfos,
      REA_TSHARK_PRLIMIT_COMMAND: "/usr/bin/lsblk",
    },
  });
  try {
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path: "/not-opened/capture.pcap" },
    });
    if (result.ok) throw new Error("expected an unusable limiter");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      capturedOutput: { stdout: expect.stringContaining("--output") },
    });
  } finally {
    await provider.close();
  }
});

it("accepts real prlimit selected through differently named symlinks", async () => {
  const root = await createTestTempDirectory("rea-pcap-prlimit-alias-");
  const tools = await writeStubTools(root);
  for (const name of ["bounded-capture", " limiter "]) {
    const limiter = join(root, name);
    await symlink("/usr/bin/prlimit", limiter);
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: tools.tshark,
        REA_CAPINFOS_COMMAND: tools.capinfos,
        REA_TSHARK_PRLIMIT_COMMAND: limiter,
      },
    });
    try {
      const result = await provider.execute({
        operation: "inspect_pcap_capture",
        input: { path: await captureFixture(root) },
      });
      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({ coverage: "complete" });
    } finally {
      await provider.close();
    }
  }
});

// Capture execution requires the Linux native resource bound used by providerWith.
it.each([
  { pass: "selected", invalidUtf8: false },
  { pass: "dns", invalidUtf8: false },
  { pass: "selected", invalidUtf8: true },
  { pass: "metadata", invalidUtf8: false },
  { pass: "digest", invalidUtf8: false },
] as const)(
  "retains invalid $pass output cleanup ownership (UTF-8: $invalidUtf8) and retries it with the snapshot",
  async ({ pass, invalidUtf8 }) => {
    const capinfosPass = pass === "metadata" || pass === "digest";
    const capinfosText =
      pass === "metadata"
        ? "not capinfos"
        : `${CAPINFOS_OUTPUT}\nSHA256: ${"0".repeat(64)}`;
    const failureText = capinfosPass
      ? pass === "digest"
        ? "SHA256 disagrees"
        : "did not provide machine-readable"
      : invalidUtf8
        ? "not valid UTF-8"
        : "malformed JSON";
    let mayClean = false;
    let cleanupAttempts = 0;
    const launcher: PcapCommandLauncher = async (spawn) => {
      const launched = await spawnOwnedProviderProcess(spawn);
      if (
        capinfosPass
          ? !spawn.arguments.includes("-M")
          : !spawn.arguments.includes("-T") ||
            spawn.arguments.includes("-x") !== (pass === "dns")
      )
        return launched;
      const cleanupOwned =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          cleanupAttempts += 1;
          const cleaned = await cleanupOwned();
          if (!mayClean) throw new Error("injected output cleanup failure");
          return cleaned;
        },
      };
    };
    const { provider, root } = await providerWith({
      launcher,
      ...(capinfosPass
        ? { capinfosText }
        : invalidUtf8
          ? { invalidTsharkStream: "stdout" as const }
          : pass === "dns"
            ? { malformedDnsJson: true }
            : { tsharkJson: "{" }),
      beforeClose: () => {
        mayClean = true;
      },
    });
    const path = await captureFixture(root);
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    if (result.ok) throw new Error("Expected malformed output cleanup failure");
    expect(result.error).toMatchObject({ cleanupIncomplete: true });
    expect(result.error.diagnostics).toMatchObject({
      cleanup_error: {
        details: {
          diagnostics: {
            reason: "injected output cleanup failure",
            captured_output: {
              stdout: capinfosPass
                ? capinfosText + "\n"
                : invalidUtf8
                  ? expect.stringContaining("�")
                  : "{",
              truncated: false,
            },
          },
        },
      },
    });
    const primary = primaryAnalysisError(result.error);
    expect(primary).toMatchObject({
      _tag: invalidUtf8 ? "AnalysisOutputError" : "AnalysisProtocolError",
      message: expect.stringContaining(failureText),
    });
    const snapshot = result.error.cleanupResources.find((resource) =>
      resource.endsWith("/capture.pcap"),
    );
    if (snapshot === undefined)
      throw new Error("Missing retained output snapshot");
    expect(
      result.error.cleanupResources.some((resource) =>
        resource.startsWith("process-group:"),
      ),
    ).toBe(true);
    expect(
      (await readFile(snapshot)).equals(Buffer.from("pcap-fixture-bytes")),
    ).toBe(true);
    const attempts = cleanupAttempts;
    mayClean = true;
    await provider.close();
    expect(cleanupAttempts).toBe(attempts + 1);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(primaryAnalysisError(result.error)).toBe(primary);
    await expect(readFile(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

const nodeTool = async (
  root: string,
  name: string,
  body: string,
): Promise<string> => {
  const path = join(root, name);
  await writeFile(
    path,
    `#!/usr/bin/env -S ${process.execPath} --jitless --max-old-space-size=64\nconst fs = require('node:fs'); const crypto = require('node:crypto');\n${body}\n`,
    { mode: 0o755 },
  );
  return path;
};
const versionProbe =
  "if (process.argv[2] === '--version') { console.log((process.argv[1].includes('capinfos') ? 'Capinfos' : 'TShark') + ' (Wireshark) 4.6.6-test'); process.exit(0); }";

it("refuses observations whose owned snapshot changed during dissection", async () => {
  const root = await createTestTempDirectory("rea-pcap-mutated-");
  const { capinfos } = await writeStubTools(root);
  const path = await captureFixture(root);
  const before = await readFile(path);
  const tshark = await nodeTool(
    root,
    "tshark.cjs",
    `${versionProbe}
const selected = process.argv[process.argv.indexOf('-r') + 1];
fs.chmodSync(selected, 0o600); fs.writeFileSync(selected, 'changed private snapshot');
console.log(process.argv.includes("-x") ? ${JSON.stringify(TSHARK_DNS_JSON)} : ${JSON.stringify(TSHARK_JSON)});`,
  );
  const provider = new PcapProvider({
    environment: { REA_TSHARK_COMMAND: tshark, REA_CAPINFOS_COMMAND: capinfos },
  });
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path },
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "artifact_changed",
    });
  expect(Buffer.compare(await readFile(path), before)).toBe(0);
});

it("binds both tools to the snapshot when the original capture changes", async () => {
  const root = await createTestTempDirectory("rea-pcap-identity-");
  const path = join(root, "caller capture.pcap");
  await writeFile(path, "192.0.2.1");
  const capinfos = await nodeTool(
    root,
    "capinfos.cjs",
    `${versionProbe}
const selected = process.argv.at(-1); const bytes = fs.readFileSync(selected);
console.log('File type: pcap\\nFile encapsulation: Raw IP\\nNumber of packets: 1\\nSHA256: ' + crypto.createHash('sha256').update(bytes).digest('hex'));
fs.writeFileSync(${JSON.stringify(path)}, '192.0.2.2');`,
  );
  const tshark = await nodeTool(
    root,
    "tshark.cjs",
    `${versionProbe}
const selected = process.argv[process.argv.indexOf('-r') + 1];
console.log(JSON.stringify([{_source:{layers:{'frame.number':['1'],'frame.protocols':['ip'],'ip.src':[fs.readFileSync(selected,'utf8')]}}}]));`,
  );
  const provider = new PcapProvider({
    environment: { REA_TSHARK_COMMAND: tshark, REA_CAPINFOS_COMMAND: capinfos },
  });
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path },
  });
  if (!result.ok) throw result.error;
  const value = pcapResultSchemas.inspect_pcap_capture.parse(
    result.value.result,
  );
  expect(value.target.sha256).toBe(
    createHash("sha256").update("192.0.2.1").digest("hex"),
  );
  expect(value.endpoints).toEqual([
    { address: "192.0.2.1", port: null, packet_count: 1 },
  ]);
  expect(await readFile(path, "utf8")).toBe("192.0.2.2");
});

it.each(["probe", "capinfos", "tshark"] as const)(
  "preserves in-flight %s cancellation and cleans up",
  async (phase) => {
    const root = await createTestTempDirectory("rea-pcap-cancel-");
    const marker = join(root, "ready");
    const slow = await nodeTool(
      root,
      `slow-${phase}.cjs`,
      `${phase !== "probe" ? versionProbe : ""}
fs.writeFileSync(${JSON.stringify(marker)}, 'ready'); setInterval(() => {}, 1000);`,
    );
    const { capinfos, tshark } = await writeStubTools(root);
    const path = await captureFixture(root);
    const provider = new PcapProvider({
      environment: {
        REA_TSHARK_COMMAND: phase === "capinfos" ? tshark : slow,
        REA_CAPINFOS_COMMAND: phase === "capinfos" ? slow : capinfos,
      },
    });
    onTestFinished(() => provider.close());
    const controller = new AbortController();
    let watcher: ReturnType<typeof watch> | undefined;
    const ready = new Promise<void>((resolve) => {
      watcher = watch(root, (_event, name) => {
        if (name === "ready") resolve();
      });
    });
    const pending = provider.execute(
      { operation: "inspect_pcap_capture", input: { path } },
      { signal: controller.signal },
    );
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(
        ready,
        pending,
        `${phase} tool startup`,
        5_000,
      );
      controller.abort(new Error("caller cancellation"));
      const result = await pending;
      if (result.ok) throw new Error("expected cancellation");
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      await provider.close();
    }, [
      () => controller.abort(),
      async () => {
        await pending;
      },
      () => watcher?.close(),
    ]);
  },
);

it.each(["change", "cancel"] as const)(
  "preserves %s during snapshot acquisition",
  async (action) => {
    const { provider, root } = await providerWith();
    const path = await captureFixture(root);
    const controller = new AbortController();
    const held = await holdFirstFileRead(path);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const pending = provider.execute(
      { operation: "inspect_pcap_capture", input: { path } },
      { signal: controller.signal },
    );
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(held.firstRead, pending, "snapshot read");
      if (action === "cancel") controller.abort();
      else await writeFile(path, "changed source bytes");
      held.release();
      const result = await pending;
      if (result.ok) throw new Error("expected interrupted acquisition");
      expect(result.error._tag).toBe(
        action === "cancel"
          ? "AnalysisCancelledError"
          : "AnalysisArtifactChangedError",
      );
    }, [
      held.release,
      async () => {
        await pending;
      },
    ]);
  },
);

it("admits one capture and drains it before close releases resources", async () => {
  const { provider, root } = await providerWith();
  const path = await captureFixture(root);
  const held = await holdFirstFileRead(path);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const pending = provider.execute({
    operation: "inspect_pcap_capture",
    input: { path },
  });
  let closing: Promise<void> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(held.firstRead, pending, "snapshot read");
    const concurrent = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    expect(concurrent.ok).toBe(false);
    if (!concurrent.ok)
      expect(projectAnalysisError(concurrent.error)).toMatchObject({
        code: "resource_constraint",
        details: { resource: "capacity" },
      });
    let closed = false;
    closing = provider.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    held.release();
    expect((await pending).ok).toBe(true);
    await closing;
    const afterClose = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    expect(afterClose.ok).toBe(false);
  }, [
    held.release,
    async () => {
      await pending;
    },
    async () => {
      await closing;
    },
  ]);
});

it.each([false, true])(
  "retains failed snapshot cleanup after an analysis failure=%s",
  async (failCapinfos) => {
    const { provider, root } = await providerWith({ failCapinfos });
    const path = await captureFixture(root);
    let retained: PrivateRuntimeRoot | undefined;
    const spy = vi
      .spyOn(PrivateRuntimeRoot.prototype, "close")
      .mockImplementation(function (this: PrivateRuntimeRoot) {
        retained = this;
        return Promise.reject(new Error("controlled cleanup failure"));
      });
    const result = await provider.execute({
      operation: "inspect_pcap_capture",
      input: { path },
    });
    try {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Cleanup failure cannot return success");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
      });
      if (failCapinfos)
        expect(projectAnalysisError(result.error)).toMatchObject({
          details: {
            diagnostics: { primary_error: { code: "unsupported_target" } },
          },
        });
      else
        expect(result.error.partialObservation).toMatchObject({
          operation: "inspect_pcap_capture",
          normalized_result: { packet_count: 3 },
        });
      expect(retained).toBeDefined();
      await expect(provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
    } finally {
      spy.mockRestore();
    }
    await provider.close();
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(false);
    await expect(
      readFile(join(retained!.path, "capture.pcap")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("requests HTTP/2 URI facts and projects them through capture inspection", async () => {
  const { provider, root } = await providerWith({ http2Uri: true });
  const path = await captureFixture(root);
  const result = await evidenceResult(provider, {
    operation: "inspect_pcap_capture",
    input: { path },
  });
  expect(result.http_request_uris).toEqual(["http://example.test/h2"]);
  expect(result.http_request_uri_count).toBe(1);
  expect(result.coverage).toBe("complete");
});

it("reports partial DNS coverage when raw extraction fails without selected DNS facts", async () => {
  const base: { _source: { layers: Record<string, unknown> } }[] =
    JSON.parse(TSHARK_JSON);
  for (const packet of base) {
    for (const key of Object.keys(packet._source.layers)) {
      if (key === "dns" || key === "dns_raw" || key.startsWith("dns."))
        delete packet._source.layers[key];
    }
  }
  const { provider, root } = await providerWith({
    malformedDnsJson: true,
    tsharkJson: JSON.stringify(base),
  });
  const result = await provider.execute({
    operation: "inspect_pcap_capture",
    input: { path: await captureFixture(root) },
  });
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    coverage: "partial",
    dns_queries: [],
    dns_query_count: 0,
  });
  expect(result.value.limitations.join(" ")).toContain(
    "DNS wire identity extraction was unavailable",
  );
});
