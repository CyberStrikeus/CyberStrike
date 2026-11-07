import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { onTestFinished } from "vitest";
import { JadxProvider } from "../../../src/android/JadxProvider.js";
import { AndroidAnalysisService } from "../../../src/application/android/AndroidAnalysisService.js";
import type { ProviderProcessHandle } from "../../../src/process/ProviderProcess.js";
import { createJadxProtocolFixture } from "./jadx.js";

/** Simulated process events around the real SDK, provider, admission and workspace owners. */
class StartupProcess extends EventEmitter implements ProviderProcessHandle {
  readonly pid = 1;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  exitCode: number | null = null;
  readonly signalCode = null;

  constructor(requested: () => void) {
    super();
    this.stdin = new Writable({
      write: (_chunk, _encoding, complete) => {
        complete();
        requested();
      },
    });
  }

  exit(): void {
    this.exitCode = 17;
    this.emit("exit", 17, null);
  }

  kill(): boolean {
    throw new Error("Fixture cleanup must use its explicit owner");
  }
}

export const createJadxStartupFixture = async () => {
  const base = await createJadxProtocolFixture();
  let requested: () => void = () => {};
  const request = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let cleaning: () => void = () => {};
  const cleanup = new Promise<void>((resolve) => {
    cleaning = resolve;
  });
  let released: () => void = () => {};
  const release = new Promise<void>((resolve) => {
    released = resolve;
  });
  const process = new StartupProcess(requested);
  let workspace: string | undefined;
  let fails = false;
  const provider = new JadxProvider(base.environment, async (options) => {
    workspace = options.cwd;
    return {
      process,
      ownership: {
        runId: options.runId,
        leaderPid: process.pid,
        processGroupId: process.pid,
      },
      cleanup: async () => {
        cleaning();
        await release;
        if (fails)
          return {
            cleaned: false,
            reason: "controlled startup cleanup unavailable",
          };
        process.stderr.end("late startup diagnostic");
        process.stdout.end();
        process.stdin.end();
        if (process.exitCode === null) process.exit();
        process.emit("close", process.exitCode, null);
        return { cleaned: true, signaled: false };
      },
    };
  });
  onTestFinished(async () => {
    fails = false;
    released();
    await provider.close();
    process.stdin.destroy();
    process.stdout.destroy();
    process.stderr.destroy();
  });
  return {
    apk: base.apk,
    provider,
    process,
    request,
    cleanup,
    service: new AndroidAnalysisService(provider),
    release: released,
    failCleanup: (value: boolean) => {
      fails = value;
    },
    workspace: () => workspace,
  };
};
