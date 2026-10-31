import { OwnedCommandFailure } from "../../../../src/process/OwnedCommand.js";
import { createHash } from "node:crypto";
import { DarwinProcessOwnershipInspectionError } from "../../../../src/process/DarwinProcessRunTokenReader.js";
import { EventEmitter } from "node:events";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { build } from "plist";
import { withVerifierCleanup } from "../../../../scripts/lib/verifier-cleanup.mjs";

import { awaitAcknowledgement } from "../../../fixtures/lifecycleAcknowledgement.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
  NATIVE_FAILURE_DIAGNOSTIC_BYTES,
  NativeCommandFailure,
  XcrunCommandRunner,
  type NativeCommandLauncher,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { err, ok } from "../../../../src/domain/result.js";
import { parseLipoOutput } from "../../../../src/native/parsers/lipo.js";
import {
  dylibCommand,
  LC,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { inspectionImage } from "../../../../src/native/NativeMachoInspection.fixture.js";
import {
  inspectPlistSchema,
  inspectSignatureSchema,
} from "../../../../src/domain/native/nativeInspection.js";
import { parseCodeSignature } from "../../../../src/native/parsers/codesign.js";
import { prepareProcessOwnershipInspection } from "../../../../src/process/ProcessOwnershipObservation.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
  type ProviderProcessHandle,
  type SpawnedOwnedProviderProcess,
} from "../../../../src/process/ProviderProcess.js";

import {
  NativeFixtureRunner as FixtureRunner,
  nativeFixture as fixture,
  nativeMachoTarget as machoTarget,
  nativeMachoTargetForFile,
  nativeResolvedToolFixture,
} from "../../../fixtures/nativeCommands.js";

/** The file runner identifies selected .plist inputs as XML. */
const writeFixturePlist = async (path: string): Promise<void> => {
  await writeFile(path, build(JSON.parse(await fixture("plist.json"))));
};

const inspectionFixture = async (high = false) => {
  directory = await createTestTempDirectory("rea-native-macho-");
  const path = join(directory, "fixture");
  const segment = Buffer.alloc(152);
  segment.writeUInt32LE(0x19, 0);
  segment.writeUInt32LE(segment.length, 4);
  segment.write("__TEXT", 8);
  segment.writeBigUInt64LE(high ? 0xfffffff007004001n : 0x100000000n, 24);
  segment.writeBigUInt64LE(4096n, 32);
  segment.writeBigUInt64LE(185n, 48);
  segment.writeUInt32LE(7, 56);
  segment.writeUInt32LE(5, 60);
  segment.writeUInt32LE(1, 64);
  segment.write("__text", 72);
  segment.write("__TEXT", 88);
  segment.writeBigUInt64LE(high ? 0xfffffff0070040b9n : 0x1000000b9n, 104);
  segment.writeBigUInt64LE(1n, 112);
  segment.writeUInt32LE(184, 120);
  const uuid = Buffer.alloc(24);
  uuid.writeUInt32LE(0x1b, 0);
  uuid.writeUInt32LE(24, 4);
  Buffer.from("0123456789abcdef0123456789abcdef", "hex").copy(uuid, 8);
  await writeFile(
    path,
    machoImage({
      commands: [
        segment,
        dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
        uuid,
      ],
    }),
  );
  return nativeMachoTargetForFile(path);
};

const cleanupOwner = (runId: string): ProviderProcessSupervisor => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: () => true,
  });
  return new ProviderProcessSupervisor({
    process: child,
    ownsProcessLifetime: true,
    ownership: {
      runId,
      leaderPid: 46_000,
      processGroupId: 46_000,
      expectedParentPid: process.pid,
    },
    cleanup: async () => ({ cleaned: false, reason: "still running" }),
  });
};

beforeAll(() => prepareProcessOwnershipInspection());

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("native macOS provider discovery", () => {
  it.each([
    "ordinary.fixture",
    "  spaced.fixture  ",
    " leading",
    "trailing ",
    "literal\r\nidentifier\r",
  ])(
    "preserves the exact signing identifier %j reported by codesign",
    (identifier) => {
      const parsed = parseCodeSignature(
        `Identifier=${identifier}\nFormat=Mach-O thin (arm64)\nTeamIdentifier=not set\n`,
        false,
      );
      expect(parsed.identifier).toBe(identifier);
      expect(parsed.team_identifier).toBeNull();
      expect(parsed.format).toBe("Mach-O thin (arm64)");
    },
  );

  it.each(["\n", "\r\n"])(
    "separates echoed path and identifier text from signature fields (%j)",
    (newline) => {
      const path = "/apps/x\r\nAuthority=Forged\nIdentifier=forged";
      const identifier = "x\r\nFormat=forged\nAuthority=Forged-5555\r";
      const parsed = parseCodeSignature(
        [
          `Executable=${path}`,
          `Identifier=${identifier}`,
          "Format=Mach-O thin (arm64)",
          "CodeDirectory v=20400 size=342 flags=0x2(adhoc) hashes=2+2",
          "CDHash=6aee90e6",
          "Signature=adhoc",
          "TeamIdentifier=not set",
          "",
        ].join(newline),
        false,
        ["/elsewhere", path],
      );
      expect(parsed).toMatchObject({
        identifier,
        format: "Mach-O thin (arm64)",
        authorities: [],
        cdhashes: ["6aee90e6"],
        team_identifier: null,
      });
    },
  );

  it.each([
    { executable: "", paths: [], newline: "\r\n", identifier: "fixture" },
    {
      executable: "Executable=/apps/fixture\r\n",
      paths: [],
      newline: "\r\n",
      identifier: "fixture\nFormat=payload\r",
    },
    {
      executable: "Executable=/apps/fixture\n",
      paths: ["/elsewhere"],
      newline: "\n",
      identifier: "fixture\r\nFormat=payload\r",
    },
    {
      executable: "Executable=/apps/fixture\r\n",
      paths: ["/elsewhere"],
      newline: "\r\n",
      identifier: "fixture\r",
    },
  ])(
    "frames the identifier without a matching executable path: %j",
    ({ executable, paths, newline, identifier }) => {
      const parsed = parseCodeSignature(
        `${executable}Identifier=${identifier}${newline}Format=Mach-O thin (arm64)${newline}TeamIdentifier=not set${newline}`,
        false,
        paths,
      );
      expect(parsed.identifier).toBe(identifier);
      expect(parsed.format).toBe("Mach-O thin (arm64)");
      expect(parsed.team_identifier).toBeNull();
    },
  );

  it.each(["timeout", "output-limit"] as const)(
    "preserves %s resolution failures with their captured output and cleanup status",
    async (reason) => {
      const failure = new NativeCommandFailure(
        "file",
        reason,
        9,
        undefined,
        {
          stdout: "partial xcrun output",
          stderr: "partial xcrun diagnostic",
          stdoutBytes: 20,
          stderrBytes: 25,
          exitCode: 9,
          signal: null,
          truncated: reason === "output-limit",
        },
        "ownership cleanup was not confirmed",
        ["process-group:1234"],
      );
      const runner = new XcrunCommandRunner({}, () =>
        Promise.resolve(err(failure)),
      );

      const result = await runner.run("file", [], {});

      expect(result).toEqual(err(failure));
      if (result.ok) throw new Error("Resolution failure unexpectedly passed");
      expect(result.error).toMatchObject({
        reason,
        capture: {
          stdout: "partial xcrun output",
          truncated: reason === "output-limit",
        },
        cleanupFailure: "ownership cleanup was not confirmed",
        cleanupResources: ["process-group:1234"],
      });
    },
  );
});

describe("native command output collection", () => {
  it("retries discovery and resamples the executable after its tool path is replaced", async () => {
    directory = await createTestTempDirectory("rea-native-tool-identity-");
    const executable = join(directory, "fixture-tool");
    const source = (value: string): string =>
      `#!/bin/sh\nprintf '%s\\n' '${value}'\n`;
    const install = async (value: string): Promise<string> => {
      const contents = source(value);
      await writeFile(executable, contents, { mode: 0o700 });
      await chmod(executable, 0o700);
      return createHash("sha256").update(contents).digest("hex");
    };
    let unavailable = true;
    const runner = new XcrunCommandRunner({}, async (tool) => {
      if (unavailable) {
        unavailable = false;
        return err(new NativeCommandFailure(tool, "unavailable"));
      }
      const digest = createHash("sha256")
        .update(await readFile(executable))
        .digest("hex");
      return ok(nativeResolvedToolFixture(executable, digest));
    });

    const originalDigest = await install("original-tool-output");
    expect(await runner.run("file", [], {})).toMatchObject({
      ok: false,
      error: { reason: "unavailable" },
    });
    const original = await runner.run("file", [], {});
    if (!original.ok) throw original.error;
    expect(original.value.stdout).toBe("original-tool-output\n");
    expect(original.value.executableSha256).toBe(originalDigest);

    const replacementDigest = await install("replacement-tool-output");
    const replacement = await runner.run("file", [], {});
    if (!replacement.ok) throw replacement.error;
    expect(replacement.value.stdout).toBe("replacement-tool-output\n");
    expect(replacement.value.executableSha256).toBe(replacementDigest);
    expect(replacement.value.versionReason).toContain("prelaunch file sample");
    expect(replacement.value.versionReason).toContain(
      "does not prove atomic OS image binding",
    );
  });

  it("retains the complete native command output", async () => {
    const runner = new XcrunCommandRunner({}, () =>
      Promise.resolve(
        ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
      ),
    );
    const output = "x".repeat(4096);
    const captured = await runner.run(
      "file",
      ["-e", `process.stdout.write(${JSON.stringify(output)})`],
      {},
    );

    expect(captured.ok && captured.value.stdout).toBe(output);
  });

  it("retains both output streams and exit status when a command fails", async () => {
    const runner = new XcrunCommandRunner({}, () =>
      Promise.resolve(
        ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
      ),
    );
    const result = await runner.run(
      "file",
      [
        "-e",
        'process.stdout.write("partial stdout"); process.stderr.write("partial stderr"); process.exitCode = 7',
      ],
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      reason: "nonzero-exit",
      exitCode: 7,
      capture: {
        stdout: "partial stdout",
        stderr: "partial stderr",
        stdoutBytes: 14,
        stderrBytes: 14,
        exitCode: 7,
        signal: null,
        truncated: false,
      },
    });
  });

  it("retains accepted nonzero output as a complete command capture", async () => {
    const runner = new XcrunCommandRunner({}, () =>
      Promise.resolve(
        ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
      ),
    );
    const result = await runner.run(
      "file",
      [
        "-e",
        'process.stdout.write("unsigned observation"); process.exitCode = 1',
      ],
      { acceptNonZero: true },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        stdout: "unsigned observation",
        stdoutBytes: 20,
        exitCode: 1,
        signal: null,
      },
    });
  });
});

describe("native command failure capture and limits", () => {
  it("projects captured diagnostics from a failed native provider command", async () => {
    const runner = new XcrunCommandRunner({}, () =>
      Promise.resolve(
        ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
      ),
    );
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(machoTarget("/private/fixture"))
      .execute("demangle_swift", { symbols: ["fixture-symbol"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("ProviderAdapterError");
    expect(result.error.capturedOutput?.stderr).toContain("Cannot find module");
    expect(result.error.capturedOutput?.stderr_bytes).toBeGreaterThan(0);
    expect(result.error.capturedOutput?.exit_code).not.toBe(0);
    expect(projectAnalysisError(result.error).details).toMatchObject({
      captured_output: {
        stderr: expect.stringContaining("Cannot find module"),
        stderr_bytes: expect.any(Number),
        exit_code: expect.any(Number),
      },
      diagnostics: {
        reason: "nonzero-exit",
        stderr_bytes: expect.any(Number),
      },
    });
    expect(projectAnalysisError(result.error).details).not.toHaveProperty(
      "diagnostics.detail",
    );
  });

  it("projects the ownership helper prerequisite when a command cannot be supervised", async () => {
    const inspection = new DarwinProcessOwnershipInspectionError(
      "Direct Darwin helper compilation requires absolute REA_DARWIN_SWIFTC_PATH and SDKROOT paths.",
    );
    const runner = new XcrunCommandRunner(
      {},
      () =>
        Promise.resolve(
          ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
        ),
      () => Promise.reject(inspection),
    );
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(machoTarget("/private/fixture"))
      .execute("demangle_swift", { symbols: ["fixture-symbol"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).details).toMatchObject({
      diagnostics: {
        phase: "process-preparation",
        reason: "io",
        detail: inspection.message,
      },
    });
    expect(result.error.capturedOutput).toBeUndefined();
  });

  it("retains output written before cancellation and reaps the stalled command", async () => {
    let outputReady!: () => void;
    let handshakeFailed!: (cause: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      outputReady = resolve;
      handshakeFailed = reject;
    });
    const launcher: NativeCommandLauncher = async (options) => {
      const launched = await spawnOwnedProviderProcess({
        ...options,
        stdin: "pipe",
      });
      // The awaiting runner installs its supervisor in a microtask before this
      // callback. Hold child output until its capture listeners are in place.
      setImmediate(() => {
        const { stdin, stdout, stderr } = launched.process;
        if (stdin == null || stdout === null || stderr === null) {
          handshakeFailed(new Error("Missing command handshake streams"));
          return;
        }
        let out = "";
        let err = "";
        const observe = () => {
          if (out === "started" && err === "warning") outputReady();
        };
        stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          observe();
        });
        stderr.on("data", (chunk: Buffer) => {
          err += chunk.toString();
          observe();
        });
        stdin.end("go");
      });
      return launched;
    };
    const runner = new XcrunCommandRunner(
      {},
      () =>
        Promise.resolve(
          ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
        ),
      launcher,
    );
    const controller = new AbortController();
    const pending = runner.run(
      "file",
      [
        "-e",
        'process.stdin.once("data", () => { process.stdout.write("started"); process.stderr.write("warning"); }); setInterval(() => {}, 1000)',
      ],
      { signal: controller.signal },
    );
    const result = await withVerifierCleanup(async () => {
      await awaitAcknowledgement(ready, pending, "command output", 10_000);
      controller.abort();
      return await pending;
    }, [
      () => controller.abort(),
      async () => {
        await pending;
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      reason: "cancelled",
      capture: {
        stdout: "started",
        stderr: "warning",
        stdoutBytes: 7,
        stderrBytes: 7,
        truncated: false,
      },
    });
  });
});

describe("native owned cancellation boundary", () => {
  it.skipIf(process.platform === "win32")(
    "projects an owned Node command cancellation with its exact reason and captured output",
    async () => {
      directory = await createTestTempDirectory("rea-native-cancel-boundary-");
      const ready = join(directory, "ready");
      const nodeSource = [
        'process.stdout.write("native output before cancellation", () => {',
        'process.stderr.write("native diagnostic before cancellation", () => {',
        `require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready");`,
        "}); });",
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const executable = join(directory, "native-tool");
      await writeFile(executable, `#!${process.execPath}\n${nodeSource}\n`, {
        mode: 0o700,
      });
      await chmod(executable, 0o700);
      const executableSha256 = createHash("sha256")
        .update(await readFile(executable))
        .digest("hex");
      const launcher: NativeCommandLauncher = (options) =>
        spawnOwnedProviderProcess({ ...options, expectedCommand: null });
      const runner = new XcrunCommandRunner(
        {},
        async () => ok(nativeResolvedToolFixture(executable, executableSha256)),
        launcher,
      );
      const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
        machoTarget("/private/fixture"),
      );
      const controller = new AbortController();
      const cancellationReason = {
        source: "test caller",
        operation: "native command cancellation",
      };
      try {
        const pending = client.execute(
          "list_architectures",
          {},
          { signal: controller.signal },
        );
        const deadline = Date.now() + 5_000;
        let readyObserved = false;
        while (Date.now() < deadline) {
          try {
            readyObserved = (await readFile(ready, "utf8")) === "ready";
          } catch (cause: unknown) {
            if (
              !(
                cause instanceof Error &&
                "code" in cause &&
                cause.code === "ENOENT"
              )
            )
              throw cause;
          }
          if (readyObserved) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        expect(
          readyObserved,
          "the owned Node process reached its output barrier",
        ).toBe(true);
        controller.abort(cancellationReason);

        const result = await pending;
        if (result.ok) throw new Error("Expected owned command cancellation");
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(cancellationReason);
        expect(result.error.capturedOutput).toMatchObject({
          stdout: "native output before cancellation",
          stderr: "native diagnostic before cancellation",
          truncated: false,
        });
        expect(result.error.cleanupIncomplete).toBe(false);
        await expect(client.close()).resolves.toMatchObject({ ok: true });
      } finally {
        await client.close();
      }
    },
  );
});

describe("native cancellation cleanup provenance", () => {
  it.skipIf(process.platform === "win32")(
    "resolves only the owners that succeed when cleanup retries cover multiple native commands",
    async () => {
      directory = await createTestTempDirectory("rea-native-mixed-cleanup-");
      const executable = join(directory, "native-tool");
      const nodeSource =
        'require("node:fs").writeFileSync(require("node:path").join(' +
        JSON.stringify(directory) +
        ', process.env.REA_PROCESS_RUN_ID), "ready"); setInterval(() => {}, 1000);\n';
      await writeFile(executable, "#!" + process.execPath + "\n" + nodeSource, {
        mode: 0o700,
      });
      await chmod(executable, 0o700);
      const executableSha256 = createHash("sha256")
        .update(await readFile(executable))
        .digest("hex");
      const owners: Array<{
        readonly runId: string;
        attempts: number;
        cleanupVerified: boolean;
        process: SpawnedOwnedProviderProcess["process"] | undefined;
      }> = [];
      const launcher: NativeCommandLauncher = async (options) => {
        const owner: (typeof owners)[number] = {
          runId: options.runId,
          attempts: 0,
          cleanupVerified: false,
          process: undefined,
        };
        owners.push(owner);
        const launched = await spawnOwnedProviderProcess({
          ...options,
          expectedCommand: null,
        });
        owner.process = launched.process;
        return {
          ...launched,
          cleanup: async () => {
            owner.attempts += 1;
            if (
              owner.attempts === 1 ||
              (owner === owners[1] && owner.attempts === 2)
            )
              return {
                cleaned: false,
                reason: `controlled owner ${owner.runId} refusal ${owner.attempts}`,
              };
            const cleanup = await cleanupOwnedProcessGroup(launched.ownership);
            owner.cleanupVerified = cleanup.cleaned;
            return cleanup;
          },
        };
      };
      const runner = new XcrunCommandRunner(
        {},
        async () => ok(nativeResolvedToolFixture(executable, executableSha256)),
        launcher,
      );
      const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
        machoTarget("/private/fixture"),
      );
      const controllers = [new AbortController(), new AbortController()];
      const cancellationReason = { source: "mixed native owner retry" };
      try {
        const pending = controllers.map((controller) =>
          client.execute(
            "list_architectures",
            {},
            { signal: controller.signal },
          ),
        );
        const deadline = Date.now() + 5_000;
        let ready = false;
        while (Date.now() < deadline && !ready) {
          if (owners.length === 2) {
            const markers = await Promise.all(
              owners.map(async ({ runId }) => {
                try {
                  return (
                    (await readFile(join(directory!, runId), "utf8")) ===
                    "ready"
                  );
                } catch (cause: unknown) {
                  if (
                    !(
                      cause instanceof Error &&
                      "code" in cause &&
                      cause.code === "ENOENT"
                    )
                  )
                    throw cause;
                  return false;
                }
              }),
            );
            ready = markers.every(Boolean);
          }
          if (!ready)
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        expect(
          ready,
          "both owned processes reached their filesystem barriers",
        ).toBe(true);
        for (const controller of controllers)
          controller.abort(cancellationReason);
        const results = await Promise.all(pending);
        const failures = results.map((result) => {
          if (result.ok) throw new Error("Expected command cancellation");
          expect(result.error.cleanupIncomplete).toBe(true);
          return result.error;
        });

        const failuresByOwner = owners.map((owner) => {
          const failure = failures.find((error) =>
            error.cleanupResources.includes(owner.runId),
          );
          if (failure === undefined)
            throw new Error("Missing error for retained native owner");
          return failure;
        });
        await runner.retryCleanup?.();
        expect(failuresByOwner[0]?.cleanupIncomplete).toBe(false);
        expect(failuresByOwner[0]?.cleanupResources).toEqual([]);
        expect(owners[0]?.cleanupVerified).toBe(true);
        expect(
          owners[0]?.process !== undefined &&
            (owners[0].process.exitCode !== null ||
              owners[0].process.signalCode !== null),
        ).toBe(true);
        expect(failuresByOwner[1]?.cleanupIncomplete).toBe(true);
        expect(failuresByOwner[1]?.cleanupResources.length).toBeGreaterThan(0);
        await runner.retryCleanup?.();
        expect(failuresByOwner[1]?.cleanupIncomplete).toBe(false);
        expect(failuresByOwner[1]?.cleanupResources).toEqual([]);
        expect(owners[1]?.cleanupVerified).toBe(true);
        expect(
          owners[1]?.process !== undefined &&
            (owners[1].process.exitCode !== null ||
              owners[1].process.signalCode !== null),
        ).toBe(true);
      } finally {
        for (const { process: child } of owners)
          if (child?.exitCode === null) child.kill("SIGKILL");
        await client.close();
      }
    },
  );
});

describe("native returned cleanup ownership", () => {
  it.skipIf(process.platform === "win32")(
    "resolves a returned command error when its exact retained owner later stops",
    async () => {
      directory = await createTestTempDirectory("rea-native-cleanup-retry-");
      const ready = join(directory, "ready");
      const executable = join(directory, "native-tool");
      await writeFile(
        executable,
        `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready"); setInterval(() => {}, 1000);\n`,
        { mode: 0o700 },
      );
      await chmod(executable, 0o700);
      const executableSha256 = createHash("sha256")
        .update(await readFile(executable))
        .digest("hex");
      let cleanupCalls = 0;
      let verifiedCleanup = false;
      let ownedProcess: ProviderProcessHandle | undefined;
      const launcher: NativeCommandLauncher = async (options) => {
        const launched = await spawnOwnedProviderProcess({
          ...options,
          expectedCommand: null,
        });
        ownedProcess = launched.process;
        return {
          ...launched,
          cleanup: async () => {
            cleanupCalls += 1;
            if (cleanupCalls < 3)
              return {
                cleaned: false,
                reason: "controlled first cleanup refusal",
              };
            const cleanup = await cleanupOwnedProcessGroup(launched.ownership);
            verifiedCleanup = cleanup.cleaned;
            return cleanup;
          },
        };
      };
      const runner = new XcrunCommandRunner(
        {},
        async () => ok(nativeResolvedToolFixture(executable, executableSha256)),
        launcher,
      );
      const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
        machoTarget("/private/fixture"),
      );
      const controller = new AbortController();
      const cancellationReason = { source: "native cleanup retry regression" };
      try {
        const pending = client.execute(
          "list_architectures",
          {},
          { signal: controller.signal },
        );
        const deadline = Date.now() + 5_000;
        let readyObserved = false;
        while (Date.now() < deadline) {
          try {
            readyObserved = (await readFile(ready, "utf8")) === "ready";
          } catch (cause: unknown) {
            if (
              !(
                cause instanceof Error &&
                "code" in cause &&
                cause.code === "ENOENT"
              )
            )
              throw cause;
          }
          if (readyObserved) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        expect(
          readyObserved,
          "owned Node process reached filesystem barrier",
        ).toBe(true);
        controller.abort(cancellationReason);
        const original = await pending;
        if (original.ok) throw new Error("Expected command cancellation");
        expect(original.error.cause).toBe(cancellationReason);
        expect(original.error.cleanupIncomplete).toBe(true);
        expect(
          original.error.cleanupResources.some((resource) =>
            resource.startsWith("process-group:"),
          ),
        ).toBe(true);
        expect(cleanupCalls).toBe(1);

        // Client close retries the same retained owner and returns a live
        // aggregate marker when that retry is still incomplete.
        const closed = await client.close();
        expect(cleanupCalls).toBe(2);
        expect(closed.ok).toBe(false);
        if (closed.ok) throw new Error("Expected cleanup to remain incomplete");
        expect(closed.error.cleanupIncomplete).toBe(true);
        expect(closed.error.cleanupResources).toEqual(
          original.error.cleanupResources,
        );

        await runner.retryCleanup?.();
        expect(cleanupCalls).toBe(3);
        expect(verifiedCleanup).toBe(true);
        expect(
          ownedProcess !== undefined &&
            (ownedProcess.exitCode !== null ||
              ownedProcess.signalCode !== null),
        ).toBe(true);
        expect(original.error.cleanupIncomplete).toBe(false);
        expect(original.error.cleanupResources).toEqual([]);
        expect(closed.error.cleanupIncomplete).toBe(false);
        expect(closed.error.cleanupResources).toEqual([]);
        await expect(client.close()).resolves.toMatchObject({ ok: true });
      } finally {
        if (ownedProcess !== undefined && ownedProcess.exitCode === null)
          ownedProcess.kill("SIGKILL");
        await client.close();
      }
    },
  );
});

describe("native late cancellation with cleanup", () => {
  it("keeps a late cancellation fact with the physical command failure and retries its retained owner", async () => {
    const cancellationReason = { caller: "stop after process failure" };
    const controller = new AbortController();
    let commandStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commandStarted = resolve;
    });
    let cleanupStarted!: () => void;
    const cleanupAttempt = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    let releaseFirstCleanup!: () => void;
    const firstCleanup = new Promise<void>((resolve) => {
      releaseFirstCleanup = resolve;
    });
    let cleanupCalls = 0;
    let launches = 0;
    const launcher: NativeCommandLauncher = async (options) => {
      launches += 1;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: () => true,
      });
      setImmediate(() => {
        child.stdout.write("partial native output");
        child.stderr.write("native diagnostic");
        child.stdout.end();
        child.stderr.end();
        child.exitCode = 7;
        child.emit("exit", 7, null);
        child.emit("close", 7, null);
        commandStarted();
      });
      return {
        process: child,
        ownership: {
          runId: options.runId,
          leaderPid: 47_100 + launches,
          processGroupId: 47_100 + launches,
          expectedParentPid: process.pid,
        },
        cleanup: async () => {
          cleanupCalls += 1;
          if (cleanupCalls === 1) {
            cleanupStarted();
            await firstCleanup;
            return {
              cleaned: false,
              reason: "controlled cleanup remains incomplete",
            };
          }
          return { cleaned: true, signaled: false };
        },
      };
    };
    const runner = new XcrunCommandRunner(
      {},
      async () =>
        ok(
          nativeResolvedToolFixture("/controlled/native-tool", "a".repeat(64)),
        ),
      launcher,
    );
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      machoTarget("/private/fixture"),
    );
    try {
      const pending = client.execute(
        "list_architectures",
        {},
        { signal: controller.signal },
      );
      await started;
      await cleanupAttempt;
      controller.abort(cancellationReason);
      releaseFirstCleanup();

      const result = await pending;
      if (result.ok)
        throw new Error("Expected the process failure to remain primary");
      expect(result.error._tag).toBe("ProviderAdapterError");
      expect(result.error.cause).toMatchObject({
        reason: "nonzero-exit",
        capture: {
          stdout: "partial native output",
          stderr: "native diagnostic",
          exitCode: 7,
        },
        cleanupFailure: "controlled cleanup remains incomplete",
      });
      expect(result.error.cause).toMatchObject({
        cancellation: { reason: cancellationReason },
      });
      expect(result.error.cause).toHaveProperty("cleanupOwner");
      expect(result.error.cleanup).toMatchObject({
        reason: "controlled cleanup remains incomplete",
      });
      expect(cleanupCalls).toBe(1);
      expect(launches).toBe(1);

      await expect(client.close()).resolves.toMatchObject({ ok: true });
      expect(cleanupCalls).toBe(2);
      expect(launches).toBe(1);
    } finally {
      releaseFirstCleanup();
      await client.close();
    }
  });
});

describe("native command failure capture and limits", () => {
  it("bounds both failure streams at a UTF-8 boundary while keeping their totals", async () => {
    const runner = new XcrunCommandRunner({}, () =>
      Promise.resolve(
        ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
      ),
    );
    // "é" is two bytes and straddles the excerpt boundary, so it is dropped whole.
    const stdout = `${"x".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES - 1)}é${"y".repeat(1024)}`;
    const stderr = "z".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES + 1024);
    // Build the output in the child: one Linux argument is limited to 128 KiB.
    const result = await runner.run(
      "file",
      [
        "-e",
        `const stdout = "x".repeat(${String(NATIVE_FAILURE_DIAGNOSTIC_BYTES - 1)}) + "\u00e9" + "y".repeat(1024); const stderr = "z".repeat(${String(NATIVE_FAILURE_DIAGNOSTIC_BYTES + 1024)}); process.stdout.write(stdout, () => process.stderr.write(stderr, () => process.exit(3)));`,
      ],
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("nonzero-exit");
    expect(result.error.capture).toMatchObject({
      stdout: "x".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES - 1),
      stderr: "z".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES),
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr),
      exitCode: 3,
      truncated: true,
    });
  });

  it("rejects output beyond the complete native-command budget", async () => {
    const runner = new XcrunCommandRunner({}, () =>
      Promise.resolve(
        ok(nativeResolvedToolFixture(process.execPath, "a".repeat(64))),
      ),
    );
    const megabytesOverBudget =
      Math.ceil(NATIVE_COMMAND_OUTPUT_BUDGET_BYTES / (1024 * 1024)) + 1;
    const result = await runner.run(
      "file",
      [
        "-e",
        `async function main() { const chunk = "x".repeat(1024 * 1024); for (let i = 0; i < ${String(megabytesOverBudget)}; i += 1) await new Promise((resolve) => process.stdout.write(chunk, resolve)); } void main()`,
      ],
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("output-limit");
    expect(result.error.capture?.truncated).toBe(true);
    expect(
      (result.error.capture?.stdoutBytes ?? 0) +
        (result.error.capture?.stderrBytes ?? 0),
    ).toBeLessThanOrEqual(NATIVE_COMMAND_OUTPUT_BUDGET_BYTES);
    // The failure carries an excerpt, not the whole retained output budget.
    expect(result.error.capture?.stdout.length).toBe(
      NATIVE_FAILURE_DIAGNOSTIC_BYTES,
    );
    expect(result.error.capture?.stdoutBytes).toBeGreaterThan(
      NATIVE_FAILURE_DIAGNOSTIC_BYTES,
    );
  });
});

describe("native command cleanup lifecycle", () => {
  it("keeps a not-owned retry unresolved instead of discarding its marker", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: () => true,
    });
    const owner = new ProviderProcessSupervisor({
      process: child,
      ownsProcessLifetime: false,
    });
    let resolveCalls = 0;
    const runner = new XcrunCommandRunner({}, async (tool) => {
      resolveCalls += 1;
      return err(
        new NativeCommandFailure(
          tool,
          "io",
          null,
          { cleanupOwner: owner },
          null,
          "initial cleanup remains unresolved",
          ["run:unowned"],
        ),
      );
    });

    const initial = await runner.run("file", [], {});
    if (initial.ok) throw new Error("Expected resolver failure");
    expect(initial.error.cleanupMarker?.cleanupIncomplete).toBe(true);
    const blocked = await runner.run("file", [], {});
    if (blocked.ok)
      throw new Error("Expected unresolved cleanup to block launch");
    expect(blocked.error.cleanupFailures).toHaveLength(1);
    expect(blocked.error.cleanupFailures[0]?.reason).toBe(
      "native command ownership remains unresolved",
    );
    expect(await runner.retryCleanup()).toHaveLength(1);
    expect(initial.error.cleanupMarker?.cleanupIncomplete).toBe(true);
    expect(resolveCalls).toBe(1);
  });

  it("waits for an active command before retrying its failed owner at close", async () => {
    let finishCommand!: (
      result: Awaited<ReturnType<NativeCommandRunner["run"]>>,
    ) => void;
    let commandStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commandStarted = resolve;
    });
    const command = new Promise<
      Awaited<ReturnType<NativeCommandRunner["run"]>>
    >((resolve) => {
      finishCommand = resolve;
    });
    let cleanupRetries = 0;
    const runner: NativeCommandRunner = {
      run: () => {
        commandStarted();
        return command;
      },
      retryCleanup: async () => {
        cleanupRetries += 1;
        return cleanupRetries === 1
          ? [
              {
                owner: cleanupOwner("run:first"),
                reason: "first process group remains live",
                resources: ["run:first", "process-group:1234"],
              },
              {
                owner: cleanupOwner("run:second"),
                reason: "second process group remains live",
                resources: ["run:second", "process-group:5678"],
              },
            ]
          : [];
      },
    };
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      machoTarget("/private/fixture"),
    );

    const execution = client.execute("list_architectures", {});
    await started;
    const closing = client.close();
    await Promise.resolve();
    expect(cleanupRetries).toBe(0);
    finishCommand(
      err(
        new NativeCommandFailure("lipo", "timeout", null, undefined, {
          stdout: "partial architecture output",
          stderr: "partial diagnostic",
          stdoutBytes: 27,
          stderrBytes: 19,
          exitCode: null,
          signal: null,
          truncated: false,
        }),
      ),
    );

    const [observed, closed] = await Promise.all([execution, closing]);
    expect(observed.ok).toBe(false);
    expect(closed.ok).toBe(false);
    expect(cleanupRetries).toBe(1);
    if (!closed.ok) {
      expect(closed.error.cleanupResources).toEqual([
        "run:first",
        "process-group:1234",
        "run:second",
        "process-group:5678",
      ]);
      expect(closed.error).toHaveProperty("diagnostics", {
        reason: "Native command process cleanup remains incomplete",
        failures: [
          {
            reason: "first process group remains live",
            resources: ["run:first", "process-group:1234"],
          },
          {
            reason: "second process group remains live",
            resources: ["run:second", "process-group:5678"],
          },
        ],
      });
    }
    await expect(client.close()).resolves.toMatchObject({ ok: true });
    expect(cleanupRetries).toBe(2);
  });
});

describe("native command failure projection", () => {
  it("does not clear mixed cleanup facts when one injected owner has no marker", async () => {
    const marker = new ProviderCleanupError("native-macos", ["run:known"], {
      reason: "known owner remains incomplete",
    });
    const failures = [
      {
        owner: cleanupOwner("run:known"),
        reason: "known owner remains incomplete",
        resources: ["run:known"],
        marker,
      },
      {
        owner: cleanupOwner("run:unknown"),
        reason: "unknown owner remains incomplete",
        resources: ["run:unknown"],
      },
    ];
    const runner: NativeCommandRunner = {
      run: async (tool) =>
        err(
          new NativeCommandFailure(
            tool,
            "io",
            null,
            { cleanupFailures: failures },
            null,
            "mixed cleanup remains incomplete",
            ["run:known", "run:unknown"],
          ),
        ),
      retryCleanup: async () => failures,
    };
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      machoTarget("/private/fixture"),
    );
    try {
      const result = await client.execute("list_architectures", {});
      if (result.ok) throw new Error("Expected native command failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      marker.resolveCleanup();
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([
        "run:known",
        "run:unknown",
      ]);

      const closed = await client.close();
      expect(closed.ok).toBe(false);
      if (closed.ok) throw new Error("Expected unknown owner cleanup facts");
      expect(closed.error.cleanupIncomplete).toBe(true);
      expect(closed.error.cleanupResources).toEqual([
        "run:known",
        "run:unknown",
      ]);
    } finally {
      await client.close();
    }
  });

  it("projects native cancellation output and incomplete cleanup to callers", async () => {
    const cancellationReason = { source: "caller", token: "exact reason" };
    const capture = {
      stdout: "partial output",
      stderr: "partial diagnostic",
      stdoutBytes: 14,
      stderrBytes: 19,
      exitCode: null,
      signal: "SIGKILL",
      truncated: false,
    };
    const runner: NativeCommandRunner = {
      async run(tool) {
        return err(
          new NativeCommandFailure(
            tool,
            "cancelled",
            null,
            { cancellation: { reason: cancellationReason } },
            capture,
            "process group cleanup was not confirmed",
            ["process-group:1234"],
          ),
        );
      },
    };
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(machoTarget("/private/fixture"))
      .execute("list_architectures", {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cause).toBe(cancellationReason);
    expect(result.error.capturedOutput).toMatchObject({
      stdout: "partial output",
      stderr: "partial diagnostic",
      stdout_bytes: 14,
      stderr_bytes: 19,
      signal: "SIGKILL",
      truncated: false,
    });
    expect(result.error.cleanup).toEqual({
      reason: "process group cleanup was not confirmed",
      resources: ["process-group:1234"],
    });
    expect(projectAnalysisError(result.error).details).toMatchObject({
      captured_output: {
        stdout_bytes: 14,
        stderr_bytes: 19,
        signal: "SIGKILL",
      },
      cleanup: "incomplete",
      resources: ["process-group:1234"],
    });
  });

  it.each([
    ["timeout", "AnalysisTimeoutError", "provider_timeout"],
    ["output-limit", "AnalysisResourceConstraintError", "resource_constraint"],
  ] as const)(
    "projects native command %s as a typed resource failure",
    async (reason, tag, code) => {
      const runner: NativeCommandRunner = {
        async run(tool) {
          return err(new NativeCommandFailure(tool, reason));
        },
      };
      const result = await new NativeMacOSProvider({}, runner, "darwin")
        .createClient(machoTarget("/private/fixture"))
        .execute("list_architectures", {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error._tag).toBe(tag);
      expect(projectAnalysisError(result.error).code).toBe(code);
    },
  );
});

describe("native macOS provider inspection", () => {
  it("normalizes comprehensive Mach-O inspection with exact bounded provenance", async () => {
    const target = await inspectionFixture();
    const runner = new FixtureRunner({ lipo: await fixture("lipo-thin.txt") });
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      target,
    );
    const execution = await client.execute("inspect_macho", {});
    if (!execution.ok) throw execution.error;
    expect(execution.value.provider.id).toBe("native-macos");
    expect(execution.value.result).toMatchObject({
      format: "mach-o",
      word_size: 64,
      uuid: "01234567-89AB-CDEF-0123-456789ABCDEF",
      architectures: { total: 1, exhaustive: true },
      dependencies: {
        items: [{ path: "/usr/lib/libSystem.B.dylib", kind: "LC_LOAD_DYLIB" }],
      },
      segments: {
        items: [
          {
            name: "__TEXT",
            initial_permissions: { read: true, write: false, execute: true },
            sections: { items: [{ segment: "__TEXT", name: "__text" }] },
          },
        ],
      },
      imports: { exhaustive: false },
      exports: { exhaustive: false },
    });
    expect(JSON.stringify(execution.value.result)).not.toContain(target.path);
  });

  it("preserves 64-bit addresses and alignment from binary section fields", async () => {
    const runner = new FixtureRunner({
      lipo: await fixture("lipo-thin.txt"),
    });
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      await inspectionFixture(true),
    );

    const execution = await client.execute("inspect_macho", {});

    if (!execution.ok) throw execution.error;
    expect(execution.value.result).toMatchObject({
      segments: {
        items: [
          {
            vm_address: "0xfffffff007004001",
            vm_size: 4096,
            file_offset: 0,
            file_size: 185,
            sections: {
              items: [
                {
                  address: "0xfffffff0070040b9",
                  size: 1,
                  file_offset: 184,
                  alignment: 1,
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("keeps Mach-O inspection available when optional vtool is unavailable", async () => {
    const client = new NativeMacOSProvider(
      {},
      new VtoolFailingRunner("unavailable"),
      "darwin",
    ).createClient(await inspectionFixture());

    const execution = await client.execute("inspect_macho", {});

    if (!execution.ok) throw execution.error;
    expect(execution.value.limitations).toEqual(
      expect.arrayContaining([expect.stringMatching(/vtool.*unavailable/iu)]),
    );
    expect(execution.value.result).toMatchObject({
      architectures: { total: 1 },
      provenance: expect.not.arrayContaining([
        expect.objectContaining({ tool: "vtool" }),
      ]),
    });
  });

  it("propagates optional vtool failures other than unavailability", async () => {
    const client = new NativeMacOSProvider(
      {},
      new VtoolFailingRunner("io"),
      "darwin",
    ).createClient(machoTarget("/private/fixture"));

    const execution = await client.execute("inspect_macho", {});

    expect(execution).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });
  });

  it("supports architectures, signatures, plists, and ordered demangling", async () => {
    directory = await createTestTempDirectory("rea-native-");
    const app = join(directory, "Fixture.app");
    const executable = join(app, "Contents/MacOS/Fixture");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await writeFile(executable, "fixture");
    await writeFixturePlist(join(app, "Contents/Info.plist"));
    const externalPlist = join(directory, "Outside.plist");
    await writeFixturePlist(externalPlist);
    const client = new NativeMacOSProvider(
      {},
      new FixtureRunner(),
      "darwin",
    ).createClient(await nativeMachoTargetForFile(executable, app));

    const architectures = await client.execute("list_architectures", {});
    expect(architectures.ok && architectures.value.result).toMatchObject({
      architectures: { total: 2 },
    });
    const signature = await client.execute("inspect_signature", {});
    expect(signature.ok && signature.value.result).toMatchObject({
      signed: true,
      identifier: "com.example.fixture",
      hardened_runtime: true,
      entitlements: { "com.apple.security.app-sandbox": true },
    });
    const defaultPlist = await client.execute("inspect_plist", {});
    expect(defaultPlist.ok && defaultPlist.value.result).toMatchObject({
      source_path: join(app, "Contents/Info.plist"),
    });
    const plist = await client.execute("inspect_plist", {
      path: externalPlist,
    });
    expect(plist.ok && plist.value.result).toMatchObject({
      bundle: { identifier: "com.example.fixture", version: "42" },
      source_path: externalPlist,
    });
    const demangled = await client.execute("demangle_swift", {
      symbols: ["$s4Test3fooyyF", "plain_symbol"],
    });
    expect(demangled.ok && demangled.value.result).toMatchObject({
      symbols: [
        { input: "$s4Test3fooyyF", status: "demangled" },
        { input: "plain_symbol", status: "unchanged" },
      ],
    });
  });
});

describe("native macOS provider raw results", () => {
  it("records command provenance once, in the normalized result", async () => {
    directory = await createTestTempDirectory("rea-native-");
    const app = join(directory, "Fixture.app");
    const executable = join(app, "Contents/MacOS/Fixture");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await writeFile(executable, inspectionImage());
    await writeFixturePlist(join(app, "Contents/Info.plist"));
    const client = new NativeMacOSProvider(
      {},
      new FixtureRunner({ lipo: await fixture("lipo-thin.txt") }),
      "darwin",
    ).createClient(await nativeMachoTargetForFile(executable, app));
    const requests: readonly (readonly [
      Parameters<typeof client.execute>[0],
      Parameters<typeof client.execute>[1],
    ])[] = [
      ["inspect_macho", {}],
      ["list_architectures", {}],
      ["inspect_signature", {}],
      ["inspect_plist", {}],
      ["demangle_swift", { symbols: ["$s4Test3fooyyF", "plain_symbol"] }],
    ];

    for (const [operation, parameters] of requests) {
      const execution = await client.execute(operation, parameters);
      if (!execution.ok) throw execution.error;
      expect(execution.value.rawResult, operation).toBeNull();
      expect(execution.value.result, operation).toMatchObject({
        provenance: expect.arrayContaining([
          expect.objectContaining({ tool: expect.any(String) }),
        ]),
      });
      if (operation === "inspect_plist") {
        const plist = inspectPlistSchema.parse(execution.value.result);
        expect(plist.provenance.map(({ command }) => command)).toEqual([
          ["/usr/bin/file", "-b", "$PLIST"],
          ["/usr/bin/plutil", "-lint", "--", "$PLIST"],
        ]);
      }
    }
  });
});

describe("native plist defaults for iOS-style bundles", () => {
  it("defaults to the Info.plist the bundle program was resolved from", async () => {
    directory = await createTestTempDirectory("rea-native-flat-");
    const app = join(directory, "Flat.app");
    const executable = join(app, "Flat");
    await mkdir(app, { recursive: true });
    await writeFile(executable, "fixture");
    await writeFixturePlist(join(app, "Info.plist"));
    const client = new NativeMacOSProvider(
      {},
      new FixtureRunner(),
      "darwin",
    ).createClient({
      ...(await nativeMachoTargetForFile(executable, app)),
      bundleInfoPlist: join(app, "Info.plist"),
    });

    const plist = await client.execute("inspect_plist", {});
    expect(plist.ok && plist.value.result).toMatchObject({
      source_path: join(app, "Info.plist"),
    });
  });
});

it("rejects malformed selected plist bytes before mocked conversion can invent facts", async () => {
  directory = await createTestTempDirectory("rea-native-malformed-plist-");
  const app = join(directory, "Malformed.app");
  const path = join(app, "Contents/Info.plist");
  await mkdir(join(app, "Contents"), { recursive: true });
  await writeFile(path, "fixture");
  const tools: string[] = [];
  const replay = new FixtureRunner();
  const runner: NativeCommandRunner = {
    run(tool, arguments_, options) {
      tools.push(tool);
      return replay.run(tool, arguments_, options);
    },
  };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    machoTarget(join(app, "Contents/MacOS/Fixture"), app),
  );
  for (const [parameters, tag] of [
    [{}, "AnalysisCapabilityUnavailableError"],
    [{ path }, "AnalysisInputError"],
  ] as const) {
    const result = await client.execute("inspect_plist", parameters);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: tag, operation: "inspect_plist" },
    });
  }
  expect(tools).toEqual(["file", "file"]);
  expect(await readFile(path, "utf8")).toBe("fixture");
});

/** Emit entitlements whose dictionary also holds a legal `__proto__` key. */
class PrototypeEntitlementsRunner extends FixtureRunner {
  override async run(tool: string, arguments_: readonly string[]) {
    const result = await super.run(tool, arguments_);
    if (!result.ok || !arguments_.includes("--entitlements")) return result;
    const stdout =
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>__proto__</key><dict><key>com.apple.security.get-task-allow</key><true/></dict></dict></plist>';
    return ok({
      ...result.value,
      stdout,
      stdoutBytes: Buffer.byteLength(stdout),
    });
  }
}

describe("native signature entitlements", () => {
  it("retains own entitlement dictionary keys through signature Evidence", async () => {
    directory = await createTestTempDirectory("rea-signature-entitlements-");
    const executable = join(directory, "fixture");
    await writeFile(executable, "fixture");
    const client = new NativeMacOSProvider(
      {},
      new PrototypeEntitlementsRunner(),
      "darwin",
    ).createClient(await nativeMachoTargetForFile(executable));

    const signature = await client.execute("inspect_signature", {});

    if (!signature.ok) throw signature.error;
    expect(signature.value.result).toMatchObject({
      entitlements: {
        "com.apple.security.app-sandbox": true,
        ["__proto__"]: { "com.apple.security.get-task-allow": true },
      },
    });
    const observed = inspectSignatureSchema.parse(signature.value.result);
    expect(
      Object.prototype.hasOwnProperty.call(observed.entitlements, "__proto__"),
    ).toBe(true);
    expect(signature.value.limitations).not.toContainEqual(
      expect.stringContaining("omitted"),
    );
  });
});

/** Fail every codesign call nonzero after writing more than one excerpt. */
class VerboseCodeSignFailureRunner extends FixtureRunner {
  override async run(tool: string, arguments_: readonly string[]) {
    const result = await super.run(tool, arguments_);
    if (!result.ok || tool !== "codesign") return result;
    const stderr = "e".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES * 2);
    return ok({
      ...result.value,
      stderr,
      stderrBytes: Buffer.byteLength(stderr),
      exitCode: 1,
    });
  }
}

describe("native signature failure diagnostics", () => {
  it("bounds accepted nonzero codesign output once it becomes a failure", async () => {
    directory = await createTestTempDirectory("rea-signature-failure-");
    const executable = join(directory, "fixture");
    await writeFile(executable, "fixture");
    const client = new NativeMacOSProvider(
      {},
      new VerboseCodeSignFailureRunner(),
      "darwin",
    ).createClient(await nativeMachoTargetForFile(executable));

    const signature = await client.execute("inspect_signature", {});

    if (signature.ok) throw new Error("A failed codesign run must fail");
    expect(signature.error.capturedOutput).toMatchObject({
      stderr: "e".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES),
      stderr_bytes: NATIVE_FAILURE_DIAGNOSTIC_BYTES * 2,
      truncated: true,
    });
  });
});

describe("native dispatch metadata error results", () => {
  it("preserves tagged cancellation and integrity failures", async () => {
    directory = await createTestTempDirectory("rea-dispatch-errors-");
    const targetPath = join(directory, "fixture.macho");
    await writeFile(targetPath, "bound target bytes");
    const client = new NativeMacOSProvider(
      {},
      new FixtureRunner(),
      "darwin",
    ).createClient(machoTarget(targetPath));
    const controller = new AbortController();
    const cancelled = client.execute(
      "inspect_native_dispatch_metadata",
      {},
      { signal: controller.signal },
    );
    controller.abort();
    const cancellationResult = await cancelled;
    expect(!cancellationResult.ok && cancellationResult.error._tag).toBe(
      "AnalysisCancelledError",
    );

    const mismatchedClient = new NativeMacOSProvider(
      {},
      new FixtureRunner(),
      "darwin",
    ).createClient({ ...machoTarget(targetPath), sha256: "f".repeat(64) });
    const integrityResult = await mismatchedClient.execute(
      "inspect_native_dispatch_metadata",
      {},
    );
    expect(!integrityResult.ok && integrityResult.error._tag).toBe(
      "EvidenceIntegrityError",
    );
  });
});

describe("native macOS provider failures and parsing", () => {
  it("classifies unavailable, malformed, command failure, and cancellation", async () => {
    const unavailable = new NativeMacOSProvider(
      {},
      new FailingRunner("unavailable"),
      "darwin",
    ).createClient(machoTarget("/fixture"));
    const unavailableResult = await unavailable.execute(
      "list_architectures",
      {},
    );
    expect(!unavailableResult.ok && unavailableResult.error._tag).toBe(
      "AnalysisCapabilityUnavailableError",
    );
    if (unavailableResult.ok) throw new Error("Expected an unavailable tool");
    expect(projectAnalysisError(unavailableResult.error).message).toBe(
      "lipo is unavailable through xcrun.",
    );

    const malformed = new NativeMacOSProvider(
      {},
      new FixtureRunner({ lipo: "malformed" }),
      "darwin",
    ).createClient(machoTarget("/fixture"));
    const malformedResult = await malformed.execute("list_architectures", {});
    expect(!malformedResult.ok && malformedResult.error._tag).toBe(
      "AnalysisOutputError",
    );

    for (const [reason, tag] of [
      ["io", "ProviderAdapterError"],
      ["cancelled", "AnalysisCancelledError"],
    ] as const) {
      const client = new NativeMacOSProvider(
        {},
        new FailingRunner(reason),
        "darwin",
      ).createClient(machoTarget("/fixture"));
      const result = await client.execute("list_architectures", {});
      expect(!result.ok && result.error._tag).toBe(tag);
    }
  });

  it.each([
    {
      ...machoTarget("/fixture.dll"),
      format: "pe" as const,
      executableRole: "shared-library" as const,
      managed: false,
    },
    { ...machoTarget("/fixture.elf"), format: "elf" as const },
  ])(
    "refuses to list architectures of a $format target without running lipo",
    async (target) => {
      const runner = new CountingRunner();
      const result = await new NativeMacOSProvider({}, runner, "darwin")
        .createClient(target)
        .execute("list_architectures", {});
      if (result.ok) throw new Error("Expected a non-Mach-O refusal");
      expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "capability_unavailable",
        details: { reason: "Active artifact is not Mach-O." },
      });
      expect(runner.calls).toBe(0);
    },
  );

  it("classifies pre-aborted requests before operation or runner discovery", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = new CountingRunner();
    const client = new NativeMacOSProvider({}, runner, "linux").createClient(
      machoTarget("/fixture"),
    );

    const result = await client.execute(
      "list_architectures",
      {},
      {
        signal: controller.signal,
      },
    );

    expect(!result.ok && result.error._tag).toBe("AnalysisCancelledError");
    expect(runner.calls).toBe(0);
  });

  it("parses thin and universal lipo fixtures", async () => {
    expect(parseLipoOutput(await fixture("lipo-thin.txt"))).toMatchObject({
      format: "thin",
      architectures: [{ name: "arm64" }],
    });
    expect(parseLipoOutput(await fixture("lipo-fat.txt"))).toMatchObject({
      format: "fat",
      architectures: [
        { name: "x86_64", file_offset: 16384, size: 4096 },
        { name: "arm64", file_offset: 32768, size: 8192 },
      ],
    });
  });

  it("rejects trailing text in lipo numeric fields instead of truncating", () => {
    const output = [
      "architecture arm64",
      "    cputype CPU_TYPE_ARM64",
      "    cpusubtype CPU_SUBTYPE_ARM64_ALL",
      "    offset 16384 trailing-junk",
      "    size 0x10",
      "    align 2^14 (16384)",
    ].join("\n");
    expect(parseLipoOutput(output).architectures).toMatchObject([
      { name: "arm64", file_offset: null, size: null, alignment: 16384 },
    ]);
  });

  it("requires the full alignment field to use a recognized spelling", () => {
    const output = [
      "architecture arm64",
      "    offset 0",
      "    size 16",
      "    align 2^14 (16384)",
    ].join("\n");
    expect(
      parseLipoOutput(output.replace("(16384)", "(8192)")).architectures[0]
        ?.alignment,
    ).toBeNull();
    expect(
      parseLipoOutput(output.replace("2^14 (16384)", "2^14")).architectures[0]
        ?.alignment,
    ).toBe(16384);
  });

  it("reads hardened runtime only from CodeDirectory flags", () => {
    expect(
      parseCodeSignature("Diagnostic: runtime policy unavailable", false)
        .hardened_runtime,
    ).toBeNull();
    expect(
      parseCodeSignature(
        "CodeDirectory v=20500 flags=0x10000(runtime) hashes=10+7",
        false,
      ).hardened_runtime,
    ).toBe(true);
    expect(
      parseCodeSignature(
        "CodeDirectory v=20500 flags=0x2(adhoc,hard) runtime=1",
        false,
      ).hardened_runtime,
    ).toBe(false);
  });
});

describe("native signature inspection target scope", () => {
  // This provider's inspect_signature path is scoped to Mach-O targets; on
  // another container a codesign verdict cannot see a format-level signature
  // such as a xar pkg signature.
  it.each([
    {
      path: "/fixture.pkg",
      sha256: "0".repeat(64),
      kind: "archive" as const,
      format: "pkg" as const,
    },
    {
      ...machoTarget("/fixture.elf"),
      format: "elf" as const,
    },
  ])(
    "refuses inspect_signature on a $format target without running codesign",
    async (target) => {
      const runner = new CountingRunner();
      const result = await new NativeMacOSProvider({}, runner, "darwin")
        .createClient(target)
        .execute("inspect_signature", {});
      if (result.ok) throw new Error("Expected a non-Mach-O refusal");
      expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "capability_unavailable",
      });
      expect(runner.calls).toBe(0);
    },
  );
});

class FailingRunner implements NativeCommandRunner {
  constructor(private readonly reason: NativeCommandFailure["reason"]) {}

  run(tool: string) {
    return Promise.resolve(err(new NativeCommandFailure(tool, this.reason)));
  }
}

class VtoolFailingRunner implements NativeCommandRunner {
  readonly #fixture = new FixtureRunner({
    lipo: "Non-fat file: fixture is architecture: arm64\n",
  });

  constructor(private readonly reason: NativeCommandFailure["reason"]) {}

  run(tool: string, arguments_: readonly string[]) {
    return tool === "vtool"
      ? Promise.resolve(err(new NativeCommandFailure(tool, this.reason)))
      : this.#fixture.run(tool, arguments_);
  }
}

class CountingRunner implements NativeCommandRunner {
  calls = 0;

  run(tool: string) {
    this.calls += 1;
    return Promise.resolve(err(new NativeCommandFailure(tool, "unavailable")));
  }
}

it("does not reopen a resolved preparation cleanup marker or invent absent compiler output facts", async () => {
  const marker = new ProviderCleanupError(
    "process-ownership",
    ["owned helper root"],
    { reason: "controlled close failure" },
  );
  const capturedOutput = {
    stdout: "compiler output",
    stderr: "�",
    stderr_bytes: 1,
    truncated: false,
  };
  const inspection = new DarwinProcessOwnershipInspectionError(
    "controlled preparation failure",
    { capturedOutput, cleanupFailure: marker },
  );
  marker.resolveCleanup();
  const failure = new NativeCommandFailure("swift-demangle", "io", null, {
    cause: inspection,
  });
  const runner: NativeCommandRunner = { run: async () => err(failure) };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    machoTarget("/fixture"),
  );
  try {
    const result = await client.execute("demangle_swift", {
      symbols: ["fixture"],
    });
    if (result.ok) throw new Error("Expected preparation failure");
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.capturedOutput).toEqual(capturedOutput);
    expect(result.error.capturedOutput).not.toHaveProperty("stdout_bytes");
    expect(result.error.capturedOutput).not.toHaveProperty("exit_code");
  } finally {
    await client.close();
  }
});

it("retains an owned preparation cleanup marker when the command deadline expires", async () => {
  const marker = new ProviderCleanupError(
    "process-ownership",
    ["owned helper root"],
    { reason: "controlled cleanup failure" },
  );
  const reason = new Error("command deadline");
  const inspection = new DarwinProcessOwnershipInspectionError(
    "cancelled preparation",
    { cancellation: { reason }, cleanupFailure: marker },
  );
  const owned = new OwnedCommandFailure(
    "timeout",
    "command preparation timed out",
    null,
    null,
    { cause: inspection, preparationFailure: inspection },
  );
  const failure = new NativeCommandFailure("swift-demangle", "timeout", null, {
    cause: owned,
  });
  const runner: NativeCommandRunner = { run: async () => err(failure) };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    machoTarget("/fixture"),
  );
  try {
    const result = await client.execute("demangle_swift", {
      symbols: ["fixture"],
    });
    if (result.ok) throw new Error("Expected preparation timeout");
    expect(result.error).toMatchObject({
      _tag: "AnalysisTimeoutError",
      cleanupIncomplete: true,
    });
    expect(result.error.cause).toBe(reason);
    marker.resolveCleanup();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await client.close();
  }
});

it("reports the selected command deadline when preparation times out", async () => {
  const marker = new ProviderCleanupError(
    "process-ownership",
    ["owned helper root"],
    { reason: "controlled cleanup failure" },
  );
  const reason = new Error("command deadline");
  const inspection = new DarwinProcessOwnershipInspectionError(
    "cancelled preparation",
    { cancellation: { reason }, cleanupFailure: marker },
  );
  const owned = new OwnedCommandFailure(
    "timeout",
    "command preparation timed out",
    null,
    null,
    { cause: inspection, preparationFailure: inspection },
  );
  const failure = new NativeCommandFailure("swift-demangle", "timeout", null, {
    cause: owned,
  });
  const runner: NativeCommandRunner = { run: async () => err(failure) };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    machoTarget("/fixture"),
  );
  try {
    const result = await client.execute("demangle_swift", {
      symbols: ["fixture"],
      native_command_timeout_ms: 1_500,
    });
    if (result.ok) throw new Error("Expected preparation timeout");
    expect(result.error).toMatchObject({
      _tag: "AnalysisTimeoutError",
      cleanupIncomplete: true,
    });
    expect(result.error.cause).toBe(reason);
    const projected = projectAnalysisError(result.error);
    expect(projected.message).toContain("of 1500 ms");
    expect(projected.message).toContain("native_command_timeout_ms");
    expect(projected.remediation.action).toContain("above 1500");
    expect(projected.remediation.action).not.toContain("above 60000");
    expect(projected.remediation.action).toContain(
      `${String(NATIVE_COMMAND_OUTPUT_BUDGET_BYTES)}-byte command output allowance`,
    );
    marker.resolveCleanup();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await client.close();
  }
});
