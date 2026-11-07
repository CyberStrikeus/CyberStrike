import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  resolveWakaruCommand,
  runWakaruCommand,
  type WakaruLauncher,
} from "./WakaruCommand.js";
import { prlimitArgumentVector } from "../../process/LinuxResourceLimits.js";
import { RECOVERY_LIMITS } from "./WakaruRelease.js";

it("names the Wakaru configuration requirement when it is not configured", async () => {
  const refusal: unknown = await resolveWakaruCommand({}).catch(
    (cause: unknown) => cause,
  );

  if (!(refusal instanceof AnalysisCapabilityUnavailableError))
    throw new Error("Expected a capability refusal");
  expect(refusal.reason).toContain("REA_WAKARU_COMMAND");
  expect(projectAnalysisError(refusal)).toMatchObject({
    code: "capability_unavailable",
    message: refusal.reason,
    remediation: { action: refusal.reason },
  });
});

it("rejects an exhausted shared execution budget before launching the next command", async () => {
  await expect(
    runWakaruCommand({
      command: "/selected/wakaru",
      limiter: "/usr/bin/prlimit",
      arguments: ["--version"],
      cwd: "/tmp/unused",
      environment: {},
      deadline: performance.now() - 1,
      launcher: async () => {
        throw new Error("An expired budget must not launch");
      },
    }),
  ).rejects.toMatchObject({
    _tag: "AnalysisTimeoutError",
    operation: "recover_javascript_sources",
    timeoutMs: RECOVERY_LIMITS.timeoutMs,
  });
});

it("projects the fixed Wakaru deadline without an editable setting", async () => {
  const refusal: unknown = await runWakaruCommand({
    command: "/selected/wakaru",
    limiter: "/usr/bin/prlimit",
    arguments: ["--version"],
    cwd: "/tmp/unused",
    environment: {},
    deadline: performance.now() - 1,
    launcher: async () => {
      throw new Error("An expired budget must not launch");
    },
  }).catch((cause: unknown) => cause);
  if (!(refusal instanceof AnalysisTimeoutError))
    throw new Error("Expected the Wakaru deadline");
  const projected = projectAnalysisError(refusal);
  expect(projected).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: RECOVERY_LIMITS.timeoutMs },
    recovery: {
      kind: "inspect_timeout_state",
      operation: "recover_javascript_sources",
      timeout_ms: RECOVERY_LIMITS.timeoutMs,
    },
  });
  expect(projected.details?.limit).toBeUndefined();
});

it("preserves caller cancellation before acquiring an expired execution budget", async () => {
  await expect(
    runWakaruCommand({
      command: "/selected/wakaru",
      limiter: "/usr/bin/prlimit",
      arguments: ["--version"],
      cwd: "/tmp/unused",
      environment: {},
      deadline: performance.now() - 1,
      signal: AbortSignal.abort(),
      launcher: async () => {
        throw new Error("A cancelled request must not launch");
      },
    }),
  ).rejects.toMatchObject({ _tag: "AnalysisCancelledError" });
});

it.each([null, false, { request: "cancel launch" }])(
  "preserves the opaque reason when cancellation interrupts launcher acquisition (%j)",
  async (reason) => {
    const controller = new AbortController();
    await expect(
      runWakaruCommand({
        command: "/selected/wakaru",
        limiter: "/usr/bin/prlimit",
        arguments: ["--version"],
        cwd: "/tmp/unused",
        environment: {},
        deadline: performance.now() + 5_000,
        signal: controller.signal,
        launcher: async () => {
          controller.abort(reason);
          throw new Error("launcher interrupted");
        },
      }),
    ).rejects.toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
  },
);

const commandFixture = (
  emit: (producer: ReturnType<typeof createProducer>) => void,
) => {
  const producer = createProducer();
  const launcher: WakaruLauncher = async (options) => {
    setImmediate(() => emit(producer));
    return {
      process: producer,
      ownership: {
        runId: options.runId,
        leaderPid: 12345,
        processGroupId: 12345,
        expectedParentPid: process.pid,
      },
      cleanup: async () => ({ cleaned: true, signaled: false }),
    };
  };
  return {
    producer,
    context: {
      command: "/selected/wakaru",
      limiter: "/usr/bin/prlimit",
      arguments: ["--version"],
      cwd: "/tmp/unused",
      environment: {},
      deadline: performance.now() + 5_000,
      launcher,
    },
  };
};

const createProducer = () =>
  Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });

it("retains stdout and stderr delivered after launcher exit", async () => {
  const { context } = commandFixture((producer) => {
    producer.stdout.write("first");
    producer.emit("exit", 0, null);
    setImmediate(() => {
      producer.stdout.end("last");
      producer.stderr.end("diagnostic");
      producer.emit("close", 0, null);
    });
  });
  await expect(runWakaruCommand(context)).resolves.toMatchObject({
    exit_code: 0,
    signal: null,
    stdout: "firstlast",
    stderr: "diagnostic",
  });
});

it("checks the diagnostic byte limit against output delivered after exit", async () => {
  const { context } = commandFixture((producer) => {
    producer.emit("exit", 0, null);
    setImmediate(() => {
      producer.stderr.end(Buffer.alloc(RECOVERY_LIMITS.reportBytes + 1, 97));
      producer.stdout.end();
      producer.emit("close", 0, null);
    });
  });
  await expect(runWakaruCommand(context)).rejects.toMatchObject({
    _tag: "AnalysisOutputError",
    operation: "recover_javascript_sources",
  });
});

it("enforces the shared deadline while exited output streams remain open", async () => {
  const { context, producer } = commandFixture((process) => {
    process.emit("exit", 0, null);
  });
  try {
    await expect(
      runWakaruCommand({ ...context, deadline: performance.now() + 50 }),
    ).rejects.toMatchObject({
      _tag: "AnalysisTimeoutError",
      operation: "recover_javascript_sources",
    });
    expect(producer.stderr.listenerCount("data")).toBe(0);
  } finally {
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});

it("pins both Wakaru ceilings through the shared prlimit vector", async () => {
  let observed: readonly string[] | undefined;
  const producer = createProducer();
  const command = "/selected/wakaru";
  await expect(
    runWakaruCommand({
      command,
      limiter: "/usr/bin/prlimit",
      arguments: ["--version"],
      cwd: "/tmp/unused",
      environment: {},
      deadline: performance.now() + 5_000,
      launcher: async (options) => {
        observed = options.arguments;
        setImmediate(() => {
          producer.stdout.end();
          producer.stderr.end();
          producer.emit("exit", 0, null);
          producer.emit("close", 0, null);
        });
        return {
          process: producer,
          ownership: {
            runId: options.runId,
            leaderPid: 12345,
            processGroupId: 12345,
            expectedParentPid: process.pid,
          },
          cleanup: async () => ({ cleaned: true, signaled: false }),
        };
      },
    }),
  ).resolves.toMatchObject({ exit_code: 0 });
  expect(observed).toEqual([
    ...prlimitArgumentVector(
      {
        address_space_bytes: RECOVERY_LIMITS.addressSpaceBytes,
        file_bytes: RECOVERY_LIMITS.outputBytes,
        cpu_seconds: RECOVERY_LIMITS.cpuSeconds,
      },
      command,
    ),
    "--version",
  ]);
});

it("honors cancellation while waiting for output after exit", async () => {
  const controller = new AbortController();
  const { context, producer } = commandFixture((process) => {
    process.emit("exit", 0, null);
    setImmediate(() => controller.abort());
  });
  try {
    await expect(
      runWakaruCommand({ ...context, signal: controller.signal }),
    ).rejects.toMatchObject({
      _tag: "AnalysisCancelledError",
    });
    expect(producer.stderr.listenerCount("data")).toBe(0);
  } finally {
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});
