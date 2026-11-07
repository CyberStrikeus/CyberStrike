import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type {
  BridgeLauncher,
  BridgeSession,
} from "../../src/hopper/BridgeLauncher.js";
import { analysisCliErrorEnvelopeSchema } from "../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { waitForExit } from "../support/process/processFixture.js";
import { HopperFixtureLauncher } from "../boundary/providers/hopper/hopperClient.fixture.js";
import { serveCli } from "../boundary/cli/cliServeHarness.js";

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
});

const fixture = vi.hoisted(() => ({
  launcher: undefined as BridgeLauncher | undefined,
}));

// Substitute only process admission. CLI composition, provider, regex search,
// socket protocol, Evidence and error projection all use production code.
// The compiled CLI separately verifies refusal of an unauthenticated launcher.
vi.mock("../../src/hopper/BridgeLauncher.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/hopper/BridgeLauncher.js")
  >()),
  HopperApplicationLauncher: class implements BridgeLauncher {
    launch(session: BridgeSession) {
      if (fixture.launcher === undefined)
        throw new Error("Missing fixture launcher");
      return fixture.launcher.launch(session);
    }
  },
}));

it
  .skipIf(process.platform === "win32")
  .each(
    (["strings", "procedures"] as const).flatMap((kind) =>
      (["capability_unavailable", "bridge_exception", "valid"] as const).map(
        (mode) => ({ kind, mode }),
      ),
    ),
  )(
  "projects $kind regex $mode through CLI with exact wire identity",
  async ({ kind, mode }) => {
    process.exitCode = undefined;
    const home = await createTestTempDirectory("rea-hopper-regex-cli-");
    const target = join(home, "sample");
    await copyFile("/usr/bin/true", target);
    const launcher = new HopperFixtureLauncher(
      undefined,
      "quiet",
      "ready",
      "acknowledge",
      mode === "valid" ? "none" : mode,
    );
    fixture.launcher = launcher;
    onTestFinished(async () => {
      fixture.launcher = undefined;
      for (const child of launcher.processes) {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        await waitForExit(child, 5_000);
      }
    });
    const run = await serveCli(
      [
        "search",
        target,
        "fixture",
        "--provider",
        "hopper",
        "--kind",
        kind,
        "--mode",
        "regex",
        "--json",
      ],
      {
        HOME: home,
        HOPPER_LAUNCHER_PATH: process.execPath,
        REA_LOG_LEVEL: "silent",
      },
    );
    const output: unknown = JSON.parse(run.stdout);
    if (mode === "valid") {
      expect(process.exitCode ?? run.exitCode, run.stdout).toBe(0);
      const evidence = parseEvidence(output);
      expect(evidence.operation).toBe(`search_${kind}`);
      expect(evidence.normalized_result).toEqual([
        { address: "0x1000", value: "fixture" },
      ]);
    } else {
      expect(process.exitCode ?? run.exitCode, run.stdout).toBe(1);
      const error = analysisCliErrorEnvelopeSchema.parse(output);
      const request = await launcher.waitForRequest(`list_${kind}`);
      expect(error.code, run.stdout).toBe(
        mode === "capability_unavailable"
          ? "capability_unavailable"
          : "execution_failure",
      );
      expect(error.details).toMatchObject({
        operation: `search_${kind}`,
        diagnostics: {
          provider_request: {
            operation: request.method,
            request_id: request.id,
            provider_code: -32000,
            diagnostic_type: mode,
          },
        },
      });
      if (mode === "bridge_exception")
        expect(error.message).toContain(`search_${kind}`);
    }
    expect(launcher.requests.map(({ method }) => method)).toEqual([
      "health",
      `list_${kind}`,
      "shutdown",
    ]);
    expect(launcher.processes).toHaveLength(1);
    const child = launcher.processes[0];
    if (child === undefined) throw new Error("Missing fixture process");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  },
);
