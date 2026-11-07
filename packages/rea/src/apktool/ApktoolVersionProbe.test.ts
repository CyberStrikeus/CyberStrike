import { ApktoolCommandCleanup } from "./ApktoolCommandCleanup.js";
import { afterEach, expect, it, vi } from "vitest";

import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../process/OwnedCommand.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import { inspectApktoolClient } from "./ApktoolConfiguration.js";
import { ApktoolProvider } from "./ApktoolProvider.js";

vi.mock("../process/OwnedCommand.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../process/OwnedCommand.js")>()),
  runOwnedCommand: vi.fn(),
}));
let commands = new ApktoolCommandCleanup();
afterEach(async () => {
  await commands.close();
  commands = new ApktoolCommandCleanup();
  vi.mocked(runOwnedCommand).mockReset();
});

const selection = {
  command: "/opt/apktool/apktool",
  commandSource: "environment",
} as const;
const owner = {
  stop: vi.fn(async () => ({ status: "verified-cleanup" as const })),
} as unknown as ProviderProcessSupervisor;

it("runs the version probe as an owned interpreter-script process group", async () => {
  vi.mocked(runOwnedCommand).mockImplementationOnce(async (_spawn, limits) => {
    const output = {
      stdout: { text: "2.9.3\n" },
      stderr: { text: "" },
    } as Awaited<ReturnType<typeof runOwnedCommand>>;
    limits.observeCompleted?.(output);
    return output;
  });
  await expect(
    inspectApktoolClient(selection, commands, {
      environment: {},
      platform: "linux",
    }),
  ).resolves.toEqual({
    version: "2.9.3",
    supportsDocumentedVersion: true,
    limitations: [],
  });
  expect(vi.mocked(runOwnedCommand).mock.lastCall?.[0]).toMatchObject({
    command: "/opt/apktool/apktool",
    arguments: ["--version"],
    expectedCommand: null,
  });
  expect(vi.mocked(runOwnedCommand).mock.lastCall?.[1]).toMatchObject({
    timeoutMs: 20_000,
    diagnosticBytes: 64 * 1024,
  });
});

it("reports an expired version probe as a typed timeout", async () => {
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(
    new OwnedCommandFailure("timeout", "Command deadline elapsed."),
  );
  const failure = await inspectApktoolClient(selection, commands, {
    environment: {},
    platform: "linux",
  }).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AnalysisTimeoutError);
  const projected = projectAnalysisError(failure as AnalysisTimeoutError);
  expect(projected).toMatchObject({
    code: "provider_timeout",
    category: "timeout",
    details: { timeout_ms: 20_000 },
  });
  expect(projected.details?.limit).toBeUndefined();
});

it("retains an unresolved probe cleanup owner and reports the cleanup", async () => {
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(
    new OwnedCommandFailure(
      "timeout",
      "Command deadline elapsed.",
      null,
      "cleanup incomplete",
      undefined,
      ["pid:1"],
      owner,
    ),
  );
  const failure = await inspectApktoolClient(selection, commands, {
    environment: {},
    platform: "linux",
  }).catch((cause: unknown) => cause);
  expect((failure as AnalysisTimeoutError).cleanupPrimary).toBeInstanceOf(
    AnalysisTimeoutError,
  );
  expect(projectAnalysisError(failure as AnalysisTimeoutError)).toMatchObject({
    code: "cleanup_incomplete",
  });
  expect(owner.stop).not.toHaveBeenCalled();
  await commands.close();
  expect((failure as AnalysisTimeoutError).cleanupIncomplete).toBe(false);
});

it("reports a cancelled version probe as cancelled", async () => {
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(
    new OwnedCommandFailure("cancelled", "Command cancelled."),
  );
  await expect(
    inspectApktoolClient(selection, commands, {
      environment: {},
      platform: "linux",
    }),
  ).rejects.toBeInstanceOf(AnalysisCancelledError);
});

it("keeps unresolved probe cleanup typed when the launcher overflows its output", async () => {
  const overflow = () =>
    new OwnedCommandFailure(
      "output-limit",
      "Command diagnostic output exceeded its complete-output budget.",
      null,
      "process group still running",
      undefined,
      ["pid:7", "process-group:7"],
      owner,
    );
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(overflow());
  const failure = await inspectApktoolClient(selection, commands, {
    environment: {},
    platform: "linux",
  }).catch((cause: unknown) => cause);
  expect((failure as AnalysisTimeoutError).cleanupResources).toEqual([
    "pid:7",
    "process-group:7",
  ]);

  // Both provider entry points report the unresolved processes as cleanup.
  const provider = new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: "/opt/apktool/apktool" },
  });
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(overflow());
  await expect(provider.inspectAvailability()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(overflow());
  const result = await provider.execute({
    operation: "decode_android_resources",
    input: {},
  } as never);
  expect(result.ok ? null : result.error.cleanupIncomplete).toBe(true);
  expect(result.ok ? null : projectAnalysisError(result.error)).toMatchObject({
    code: "cleanup_incomplete",
    details: { resources: ["pid:7", "process-group:7"] },
  });
  await provider.close();
  expect(result.ok ? null : result.error.cleanupIncomplete).toBe(false);
});

it.each(["linux", "win32"] as const)(
  "interprets advisory applicability using the selected %s host",
  async (platform) => {
    vi.mocked(runOwnedCommand).mockImplementationOnce(
      async (_spawn, limits) => {
        const output = {
          stdout: { text: "2.9.2\n" },
          stderr: { text: "" },
        } as Awaited<ReturnType<typeof runOwnedCommand>>;
        limits.observeCompleted?.(output);
        return output;
      },
    );
    const identity = await inspectApktoolClient(selection, commands, {
      environment: {},
      platform,
    });
    expect(identity.version).toBe("2.9.2");
    expect(
      identity.limitations.some((warning) =>
        warning.includes("GHSA-vgwr-4w3p-xmjv"),
      ),
    ).toBe(platform === "win32");
  },
);

it.each([
  ["EACCES", "command_not_executable"],
  ["ENOENT", "command_missing"],
])("distinguishes launcher spawn %s", async (code, expected) => {
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(
    Object.assign(new Error(code), { code }),
  );
  await expect(
    inspectApktoolClient(selection, commands, {
      environment: {},
      platform: "linux",
    }),
  ).rejects.toMatchObject({
    code: expected,
    diagnostics: {
      filesystem_error: code,
      selected_command: selection.command,
    },
  });
});

it("reports version capture overflow as a resource constraint with the selected launcher", async () => {
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(
    new OwnedCommandFailure("output-limit", "too much output"),
  );
  const failure = await inspectApktoolClient(selection, commands, {
    environment: {},
    platform: "linux",
  }).catch((cause: unknown) => cause);
  expect(projectAnalysisError(failure as AnalysisTimeoutError)).toMatchObject({
    code: "resource_constraint",
    details: {
      operation: "inspect_apktool_client",
      diagnostics: { selected_command: selection.command },
    },
  });
});
