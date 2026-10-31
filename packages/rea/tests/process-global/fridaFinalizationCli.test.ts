import { expect, it } from "vitest";
import { createCli } from "../../src/cli.js";
import { FridaInstrumentationManager } from "../../src/frida/FridaInstrumentationManager.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { ok } from "../../src/domain/result.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { jsonObjectSchema } from "../../src/domain/jsonValue.js";

it.each([
  ["list-frida-devices", "SIGINT", false],
  ["list-frida-processes", "SIGTERM", true],
  ["instrument-with-frida", "SIGINT", true],
] as const)(
  "retains completed %s output when %s arrives during final close (failure=%s)",
  async (command, interrupt, cleanupFails) => {
    const initialListeners = new Set(process.listeners(interrupt));
    const originalExitCode = process.exitCode;
    const provider = new FridaInstrumentationManager();
    provider.listDevices = async () => ok({ devices: [], cleanupError: null });
    provider.listProcesses = async () =>
      ok({
        deviceId: "local",
        processes: [{ pid: 71, name: "observed", identifier: null }],
        cleanupError: null,
      });
    provider.startSession = async () =>
      ok({
        sessionId: "00000000-0000-4000-8000-000000000001",
        deviceId: "local",
        target: "observed",
        pid: 71,
        mode: "attach",
        state: "running",
      });
    provider.loadScript = async () =>
      ok({
        scriptId: "00000000-0000-4000-8000-000000000002",
        sourceKind: "inline",
        sourcePath: null,
        sourceSha256: "a".repeat(64),
        messages: [{ type: "send", payload: "completed" }],
        messagesTruncated: false,
      });
    provider.closeSession = async () => ok({ targetResumeObserved: false });
    const cleanup = new ProviderCleanupError("frida", ["retained connection"], {
      reason: "final close denied",
    });
    let closes = 0;
    provider.closeAll = async () => {
      closes += 1;
      const listeners = process
        .listeners(interrupt)
        .filter((listener) => !initialListeners.has(listener));
      expect(listeners).toHaveLength(1);
      listeners[0]?.call(process, interrupt);
      if (cleanupFails) throw cleanup;
    };
    const args =
      command === "instrument-with-frida"
        ? [
            command,
            "attach",
            "71",
            "--script",
            "send('completed')",
            "--duration-ms",
            "0",
            "--json",
          ]
        : [command, "--json"];
    let stdout = "";
    try {
      await createCli({}, undefined, provider).serve(args, {
        env: {},
        exit: () => {},
        stdout: (text) => {
          stdout += text;
        },
      });
      const output: unknown = JSON.parse(stdout);
      expect(output).toMatchObject({
        code: cleanupFails ? "cleanup_incomplete" : "cancelled",
        details: cleanupFails
          ? {
              resources: ["retained connection"],
              diagnostics: { primary_error: { code: "cancelled" } },
            }
          : {},
      });
      const observation = jsonObjectSchema.parse(
        jsonObjectSchema.parse(output).details,
      ).partial_observation;
      const name =
        command === "list-frida-devices"
          ? "list_frida_devices"
          : command === "list-frida-processes"
            ? "list_frida_processes"
            : "instrument_with_frida";
      expect(() =>
        toolContract(name).outputSchema.parse(observation),
      ).not.toThrow();
      if (command === "instrument-with-frida")
        expect(observation).toMatchObject({
          normalized_result: { messages: [{ payload: "completed" }] },
        });
      expect(closes).toBe(1);
      expect(process.exitCode).toBe(interrupt === "SIGINT" ? 130 : 143);
      expect(process.listeners(interrupt)).toEqual([...initialListeners]);
    } finally {
      process.exitCode = originalExitCode;
    }
  },
);
