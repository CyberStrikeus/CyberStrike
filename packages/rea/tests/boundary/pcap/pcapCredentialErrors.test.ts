import { z } from "zod";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import {
  runPcapCommand,
  type PcapCommandLauncher,
} from "../../../src/pcap/PcapCommand.js";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessSupervisor,
} from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { offlineHttpCapture } from "../../fixtures/pcap/offlineHttpCapture.js";

const credential = "SYNTHETIC_PCAP_AUTH_83A4";
const uri = `http://user:${credential}@example.test/a/../b?value=keep%2Fthis`;
const authoredJson = JSON.stringify([
  {
    _source: {
      layers: {
        "http.request.full_uri": [uri],
        "dns.qry.name": ["http://caller:keep@label"],
      },
    },
  },
]);
const ownedCommand = (
  code: string,
  options: { signal?: AbortSignal; launcher?: PcapCommandLauncher } = {},
) =>
  runPcapCommand({
    operation: "inspect_pcap_capture",
    command: process.execPath,
    arguments: ["-e", code],
    redactHttpTransportCredentials: true,
    inputPath: "/authored-capture.pcap",
    limits: { timeoutMs: 10_000, maxOutputBytes: 4096 },
    environment: process.env,
    signal: options.signal,
    ...(options.launcher === undefined ? {} : { launcher: options.launcher }),
    retain: (owner) =>
      onTestFinished(async () => {
        expect((await owner.stop()).status).not.toBe("incomplete");
      }),
  });
const print = `process.stdout.write(${JSON.stringify(authoredJson)});`;

it("keeps complete parser input while exposing safe late-failure diagnostics", async () => {
  const result = await ownedCommand(print);
  expect(result.stdout).toBe(authoredJson);
  expect(result.capturedOutput.stdout).not.toContain(credential);
  expect(result.capturedOutput.stdout).toContain("http://caller:keep@label");
  expect(result.capturedOutput.stdout).toContain(
    "http://example.test/a/../b?value=keep%2Fthis",
  );
  expect(result.capturedOutput).toMatchObject({
    exit_code: 0,
    truncated: false,
  });
}, 20_000);

it("preserves producer failure facts while excluding HTTP credentials", async () => {
  const failure: unknown = await ownedCommand(
    `${print}process.exitCode = 7;`,
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AnalysisProtocolError);
  if (!(failure instanceof AnalysisProtocolError)) throw failure;
  expect(failure.capturedOutput).toMatchObject({
    exit_code: 7,
    truncated: false,
  });
  expect(JSON.stringify(projectAnalysisError(failure))).not.toContain(
    credential,
  );
  expect(failure.capturedOutput?.stdout).toContain("http://caller:keep@label");
}, 20_000);

it("excludes HTTP credentials after output-observed cancellation and preserves its reason", async () => {
  const controller = new AbortController();
  const reason = { request: "owned capture cancellation" };
  let observedOutput = false;
  const failure: unknown = await ownedCommand(
    `${print}setInterval(() => {}, 1000);`,
    {
      signal: controller.signal,
      launcher: async (spawn) => {
        const launched = await spawnOwnedProviderProcess(spawn);
        launched.process.stdout?.once("data", () => {
          observedOutput = true;
          queueMicrotask(() => controller.abort(reason));
        });
        return launched;
      },
    },
  ).catch((cause: unknown) => cause);
  expect(observedOutput).toBe(true);
  expect(failure).toBeInstanceOf(AnalysisCancelledError);
  if (!(failure instanceof AnalysisCancelledError)) throw failure;
  expect(failure.cause).toBe(reason);
  expect(failure.capturedOutput?.stdout).toContain("http://example.test/");
  expect(JSON.stringify(projectAnalysisError(failure))).not.toContain(
    credential,
  );
}, 20_000);

it("retains safe cleanup observations and retries their original owner", async () => {
  let mayClean = false;
  let retained = false;
  const output = await runPcapCommand({
    operation: "inspect_pcap_capture",
    command: process.execPath,
    arguments: ["-e", print],
    redactHttpTransportCredentials: true,
    inputPath: "/authored-capture.pcap",
    limits: { timeoutMs: 10_000, maxOutputBytes: 4096 },
    environment: process.env,
    signal: undefined,
    launcher: async (spawn) => {
      const launched = await spawnOwnedProviderProcess(spawn);
      const cleanup =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          const result = await cleanup();
          if (!mayClean) throw new Error("injected cleanup uncertainty");
          return result;
        },
      };
    },
    retain: (owner, resources, _reason, capturedOutput) => {
      retained = true;
      onTestFinished(async () => {
        mayClean = true;
        expect((await owner.stop()).status).not.toBe("incomplete");
      });
      expect(resources.length).toBeGreaterThan(0);
      expect(capturedOutput.stdout).not.toContain(credential);
    },
  });
  expect(retained).toBe(true);
  expect(output.stdout).toBe(authoredJson);
  expect(output.cleanup?.capturedOutput.stdout).not.toContain(credential);
  expect(output.cleanup?.capturedOutput.stdout).toContain(
    "http://caller:keep@label",
  );
}, 20_000);

const nativeOptions = (
  path: string,
): Omit<Parameters<typeof runPcapCommand>[0], "limits"> => ({
  operation: "inspect_pcap_capture",
  command: "/usr/bin/tshark",
  arguments: [
    "-n",
    "-r",
    path,
    "-T",
    "json",
    "--no-duplicate-keys",
    "-e",
    "frame.number",
    "-e",
    "frame.protocols",
    "-e",
    "ip.src",
    "-e",
    "ip.dst",
    "-e",
    "http.request.full_uri",
    "-e",
    "http.request.uri",
  ],
  redactHttpTransportCredentials: true,
  inputPath: path,
  environment: process.env,
  signal: undefined,
  retain: (owner: ProviderProcessSupervisor) =>
    onTestFinished(async () => {
      expect((await owner.stop()).status).not.toBe("incomplete");
    }),
});

it.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/tshark"))(
  "excludes recorded HTTP credentials when real TShark exceeds the output allowance",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-private-native-");
    const path = join(root, "http.pcap");
    await writeFile(path, offlineHttpCapture(uri));
    const options = nativeOptions(path);
    const full = await runPcapCommand({
      ...options,
      limits: { timeoutMs: 10_000, maxOutputBytes: 65536 },
    });
    expect(full.stdout).toContain(uri);
    const budget =
      Buffer.from(full.stdout).lastIndexOf(credential) +
      Buffer.byteLength(credential) +
      20;
    expect(budget).toBeLessThan(Buffer.byteLength(full.stdout));
    const failure: unknown = await runPcapCommand({
      ...options,
      limits: { timeoutMs: 10_000, maxOutputBytes: budget },
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(failure instanceof AnalysisResourceConstraintError)) throw failure;
    expect(failure).toMatchObject({
      resource: "memory",
      retryable: false,
      reportedLimits: { max_output_bytes: budget },
    });
    expect(failure.capturedOutput?.truncated).toBe(true);
    expect(JSON.stringify(projectAnalysisError(failure))).not.toContain(
      credential,
    );
  },
  20_000,
);

it.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/tshark"))(
  "preserves origin-form request-target bytes in real TShark diagnostics",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-path-native-");
    const path = join(root, "origin-form.pcap");
    const target = "//caller:keep@path/a?value=%2F";
    await writeFile(path, offlineHttpCapture(target));
    const result = await runPcapCommand({
      ...nativeOptions(path),
      limits: { timeoutMs: 10_000, maxOutputBytes: 65536 },
    });
    const frames = z
      .array(
        z.object({
          _source: z.object({
            layers: z.record(z.string(), z.array(z.string())),
          }),
        }),
      )
      .parse(JSON.parse(result.capturedOutput.stdout));
    expect(frames[0]?._source.layers["http.request.uri"]).toEqual([target]);
    expect(result.capturedOutput.truncated).toBe(false);
  },
  20_000,
);
