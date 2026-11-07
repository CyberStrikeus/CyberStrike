import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { parseConfig } from "../../../../src/config/parseConfig.js";
import { analysisErrorProjectionSchema } from "../../../../src/contracts/errorSchemas.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { elf } from "../../../../src/domain/binaryTarget.fixture.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import { ok } from "../../../../src/domain/result.js";
import { GhidraClient } from "../../../../src/ghidra/GhidraClient.js";
import type { GhidraClientOptions } from "../../../../src/ghidra/GhidraClientTypes.js";
import type { GhidraJavaObservation } from "../../../../src/ghidra/GhidraJavaProbe.js";
import type {
  GhidraLaunchSession,
  GhidraLauncher,
} from "../../../../src/ghidra/GhidraLauncher.js";
import { GhidraProvider } from "../../../../src/ghidra/GhidraProvider.js";
import { silentLogger } from "../../../../src/logger.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { GhidraFixtureLauncher } from "./ghidraClient.fixture.js";

type Mode = ConstructorParameters<typeof GhidraFixtureLauncher>[0];

/** Real provider, client, process capture and projection; only the JVM is simulated. */
const failedOperation = async (
  mode: Mode,
  options: {
    readonly startupTimeoutMs?: number;
    readonly readMemoryCgroup?: GhidraClientOptions["readMemoryCgroup"];
    /** Complete one operation first so the session is known to have run. */
    readonly afterSuccess?: boolean;
  } = {},
) => {
  const fixture = new GhidraFixtureLauncher(mode);
  const launcher: GhidraLauncher = {
    launch: async (session: GhidraLaunchSession) => {
      const launched = await fixture.launch(session);
      if (!launched.ok) return launched;
      return ok({ ...launched.value, configuredMaxHeap: "4G" });
    },
  };
  const directory = await createTestTempDirectory("rea-ghidra-oome-");
  const bytes = elf(2, 1, 62);
  const targetPath = join(directory, "target.elf");
  await writeFile(targetPath, bytes);
  const target: BinaryTarget = {
    path: targetPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "executable",
    format: "elf",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
  };
  const config = parseConfig({
    GHIDRA_INSTALL_DIR: "/fixture/ghidra",
    REA_GHIDRA_STARTUP_TIMEOUT_MS: String(options.startupTimeoutMs ?? 10_000),
  });
  if (!config.ok) throw config.error;
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    {
      platform: process.platform,
      architecture: process.arch,
      readText: () => "application.version=12.1.4\napplication.java.min=21\n",
      executable: () => true,
      probeJava: () =>
        ok<GhidraJavaObservation>({
          osArch: process.arch === "arm64" ? "aarch64" : "amd64",
          osName:
            process.platform === "darwin"
              ? "Mac OS X"
              : process.platform === "win32"
                ? "Windows 11"
                : "Linux",
          version: "21.0.12",
          major: 21,
          home: "/fixture/jdk",
          bits: 64,
          runtime: "jdk",
        }),
    },
    (clientOptions) =>
      new GhidraClient({
        ...clientOptions,
        launcher,
        readMemoryCgroup: options.readMemoryCgroup ?? (async () => undefined),
      }),
  );
  const profile = await provider.resolveAnalysisProfile(target);
  if (!profile.ok) throw profile.error;
  if (profile.value.profile === null)
    throw new Error("Expected Ghidra profile");
  const client = provider.createClient(target, profile.value.profile);
  onTestFinished(async () => {
    await client.close();
  });
  if (options.afterSuccess === true) {
    const earlier = await client.execute("list_documents", {});
    if (!earlier.ok) throw earlier.error;
  }
  const result = await client.execute("list_procedures", {});
  if (result.ok) throw new Error("Expected a Ghidra failure");
  return analysisErrorProjectionSchema.parse(
    JSON.parse(JSON.stringify(projectAnalysisError(result.error))),
  );
};

const confirmedHeapExhaustion = {
  code: "resource_constraint",
  details: {
    resource: "memory",
    reported_limits: { configured_jvm_max_heap: "4G" },
  },
};

describe.skipIf(process.platform === "win32")(
  "Ghidra OutOfMemoryError beyond the diagnostic retention budget",
  () => {
    it("reports an OOME that fits in the retained output", async () => {
      const projected = await failedOperation("oom_exit_tools");
      expect(projected).toMatchObject(confirmedHeapExhaustion);
      expect(projected.message).toContain("Java heap space");
    });

    it("reports an OOME printed after more than 8 MiB of earlier output", async () => {
      const projected = await failedOperation("flood_then_oom_exit_tools");
      expect(projected).toMatchObject(confirmedHeapExhaustion);
      expect(projected.message).toContain("Java heap space");
      expect(projected.remediation.action).toContain("GHIDRA_HEADLESS_MAXMEM");
      expect(projected.details).toMatchObject({
        diagnostics: {
          failure_output: {
            complete: false,
            observed_oome: [
              {
                stream: "stderr",
                line: expect.stringContaining("java.lang.OutOfMemoryError"),
              },
            ],
          },
        },
      });
    }, 30_000);

    it.each([
      ["process exit", "flood_then_exit_tools"],
      ["protocol failure", "flood_then_malformed"],
    ] as const)(
      "keeps an unrelated %s after budget-exhausting output",
      async (_kind, mode) => {
        const projected = await failedOperation(mode);
        expect(projected.code).toBe("execution_failure");
        expect(projected.message).toContain(
          "a memory cause cannot be ruled out",
        );
        expect(projected.remediation.action).not.toContain(
          "GHIDRA_HEADLESS_MAXMEM",
        );
        expect(projected.details).toMatchObject({
          diagnostics: { failure_output: { complete: false } },
        });
        expect(projected.details).toMatchObject({
          diagnostics: { failure_output: { observed_oome: [] } },
        });
      },
      30_000,
    );

    it("does not mistake a budget-cut identifier prefix for an OOME", async () => {
      const projected = await failedOperation(
        "prefix_cut_identifier_exit_tools",
      );
      expect(projected.code).toBe("execution_failure");
      expect(projected.message).toContain("a memory cause cannot be ruled out");
      expect(projected).toMatchObject({
        details: {
          diagnostics: {
            failure_output: {
              complete: false,
              observed_oome: [],
              stdout: {
                retained_bytes: 8 * 1024 * 1024,
                bytes: 8 * 1024 * 1024 + "Custom\n".length,
              },
            },
          },
        },
      });
    }, 30_000);

    it("keeps a startup timeout after budget-exhausting output", async () => {
      const projected = await failedOperation("flood_silent", {
        startupTimeoutMs: 4_000,
      });
      expect(projected.code).toBe("provider_timeout");
      expect(projected.message).toContain("a memory cause cannot be ruled out");
      expect(projected.remediation.action).not.toContain(
        "GHIDRA_HEADLESS_MAXMEM",
      );
    }, 30_000);
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra killed by SIGKILL without an OutOfMemoryError",
  () => {
    it("reports a kill during a cgroup OOM kill as a memory constraint", async () => {
      const observations = [0, 1].map((oomKills) => ({
        path: "/",
        oomKills,
        memoryMax: 3_221_225_472,
      }));
      let reads = 0;
      const projected = await failedOperation("sigkill_tools", {
        readMemoryCgroup: async () => observations[reads++],
      });
      expect(reads).toBe(2);
      expect(projected.remediation.action).toMatch(/Then retry\.$/u);
      expect(projected).toMatchObject({
        code: "resource_constraint",
        details: {
          resource: "memory",
          reported_limits: {
            cgroup_memory_max: 3_221_225_472,
            configured_jvm_max_heap: "4G",
          },
          diagnostics: {
            exit_signal: "SIGKILL",
            memory_cgroup: {
              path: "/",
              oom_kill_before: 0,
              oom_kill_after: 1,
              memory_max: 3_221_225_472,
            },
          },
        },
      });
      expect(projected.remediation.action).not.toContain("rea doctor");
    });

    it("names the signal when no cgroup attributes the kill", async () => {
      const projected = await failedOperation("sigkill_tools");
      expect(projected.code).toBe("execution_failure");
      expect(projected.message).toContain("SIGKILL");
      expect(projected.message).not.toContain("rea doctor");
      expect(projected.details).toMatchObject({
        diagnostics: { exit_signal: "SIGKILL" },
      });
      expect(projected.details?.diagnostics).not.toHaveProperty(
        "memory_cgroup",
      );
    });

    it("keeps the reopen guidance when an established session is killed", async () => {
      let reads = 0;
      const projected = await failedOperation("sigkill_after_first_tool", {
        afterSuccess: true,
        readMemoryCgroup: async () => ({
          path: "/",
          oomKills: reads++,
          memoryMax: "max",
        }),
      });
      expect(projected).toMatchObject({
        code: "resource_constraint",
        details: { reported_limits: { cgroup_memory_max: "max" } },
      });
      expect(projected.remediation.action).toContain(
        "Call open_binary for the same target to start a new Ghidra session",
      );
      expect(projected.remediation.action).toContain("GHIDRA_HEADLESS_MAXMEM");
    });
  },
);
