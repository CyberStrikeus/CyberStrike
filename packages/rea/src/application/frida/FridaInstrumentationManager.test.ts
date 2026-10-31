import { describe, expect, it, onTestFinished } from "vitest";
import { createDeferred } from "../../../tests/fixtures/binarySession.js";

import type {
  Device,
  DeviceManager,
  FridaMessage,
  Process,
  Script,
  Session,
  Signal,
} from "frida";
import { jsonObjectSchema } from "../../domain/jsonValue.js";
import { FridaScriptLoadCancelledError } from "./FridaInstrumentationPort.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import { FridaInstrumentationManager } from "../../frida/FridaInstrumentationManager.js";
import { fridaCaptureLimitations } from "../../frida/fridaCaptureLimits.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { FridaInstrumentationService } from "./FridaInstrumentationService.js";

const signal = <Handler extends (...args: never[]) => void>() => {
  let connected: Handler | undefined;
  const value: Signal<Handler> & {
    emit: (...args: Parameters<Handler>) => void;
  } = {
    connect: (handler) => {
      connected = handler;
    },
    disconnect: (handler) => {
      if (connected === handler) connected = undefined;
    },
    emit: (...args) => connected?.(...args),
  };
  return value;
};

class FakeScript implements Script {
  readonly message =
    signal<(message: FridaMessage, data: Buffer | null) => void>();
  isDestroyed = false;
  loadFailure: Error | undefined;
  unloadFailureCount = 0;
  unloadCalls = 0;

  constructor(
    readonly payload: unknown = { event: "loaded" },
    readonly beforeLoad: () => Promise<void> = async () => {},
    readonly description = "script loaded",
    readonly stack = "",
    readonly messageValue?: FridaMessage,
  ) {}

  async load(): Promise<void> {
    await this.beforeLoad();
    if (this.loadFailure !== undefined) throw this.loadFailure;
    this.message.emit(
      this.messageValue ?? {
        type: "send",
        payload: this.payload,
        description: this.description,
        stack: this.stack,
      },
      null,
    );
  }

  async unload(): Promise<void> {
    this.unloadCalls += 1;
    if (this.unloadFailureCount > 0) {
      this.unloadFailureCount -= 1;
      throw new Error("script unload failed");
    }
    if (this.isDestroyed) throw new Error("Script is destroyed");
    this.isDestroyed = true;
  }
}

class FakeSession implements Session {
  readonly detached = signal<() => void>();
  readonly scripts: FakeScript[] = [];
  nextPayload: unknown = { event: "loaded" };
  nextDescription = "script loaded";
  nextStack = "";
  nextMessage: FridaMessage | undefined;
  nextLoadFailure: Error | undefined;
  nextUnloadFailureCount = 0;
  detachFailureCount = 0;
  scriptLoadGate: Promise<void> | undefined;
  onScriptLoadStarted: (() => void) | undefined;
  private detachedState = false;
  readonly pid = 512;

  isDetached(): boolean {
    return this.detachedState;
  }

  async createScript(): Promise<Script> {
    const script = new FakeScript(
      this.nextPayload,
      async () => {
        this.onScriptLoadStarted?.();
        await this.scriptLoadGate;
      },
      this.nextDescription,
      this.nextStack,
      this.nextMessage,
    );
    script.loadFailure = this.nextLoadFailure;
    script.unloadFailureCount = this.nextUnloadFailureCount;
    this.nextPayload = { event: "loaded" };
    this.nextDescription = "script loaded";
    this.nextStack = "";
    this.nextMessage = undefined;
    this.nextLoadFailure = undefined;
    this.nextUnloadFailureCount = 0;
    this.scripts.push(script);
    return script;
  }

  async detach(): Promise<void> {
    if (this.detachFailureCount > 0) {
      this.detachFailureCount -= 1;
      throw new Error("session detach failed");
    }
    for (const script of this.scripts) script.isDestroyed = true;
    this.markDetached();
  }

  markDetached(): void {
    this.detachedState = true;
    this.detached.emit();
  }

  markDetachedWithoutSignal(): void {
    this.detachedState = true;
  }
}

class FakeDevice implements Device {
  readonly id = "local";
  readonly name = "Local System";
  readonly type = "local";
  readonly process = { pid: 512, name: "fixture" } satisfies Process;
  readonly session = new FakeSession();
  resumed: number[] = [];
  attachedTargets: Array<number | string> = [];
  resumeFailureCount = 0;
  readonly spawned: string[] = [];

  async enumerateProcesses(): Promise<Process[]> {
    return [this.process];
  }

  async getProcessByPid(): Promise<Process> {
    return this.process;
  }

  async spawn(program: string): Promise<number> {
    this.spawned.push(program);
    return this.process.pid;
  }

  async resume(pid: number): Promise<void> {
    if (this.resumeFailureCount > 0) {
      this.resumeFailureCount -= 1;
      throw new Error("target resume failed");
    }
    this.resumed.push(pid);
  }

  async attach(target: number | string): Promise<Session> {
    this.attachedTargets.push(target);
    return this.session;
  }
}

class FakeDeviceManager implements DeviceManager {
  readonly device = new FakeDevice();
  removedRemote: string[] = [];
  removeRemoteFailureCount = 0;
  removeRemoteFailureMessage = "remote device removal failed";

  async enumerateDevices(): Promise<Device[]> {
    return [this.device];
  }

  async getDeviceById(): Promise<Device> {
    return this.device;
  }

  async addRemoteDevice(): Promise<Device> {
    return this.device;
  }

  async removeRemoteDevice(address: string): Promise<void> {
    if (this.removeRemoteFailureCount > 0) {
      this.removeRemoteFailureCount -= 1;
      throw new Error(this.removeRemoteFailureMessage);
    }
    this.removedRemote.push(address);
  }
}

const startLocalAttachedSession = async (
  bindings = new FakeDeviceManager(),
) => {
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const started = await manager.startSession({
    mode: "attach",
    deviceId: "local",
    pid: 512,
  });
  return { bindings, manager, started };
};

// eslint-disable-next-line max-lines-per-function -- related manager lifecycle cases share the same focused fake provider.
describe("FridaInstrumentationManager", () => {
  it("reports a fixed device-lookup deadline when Frida's lookup times out", async () => {
    const bindings = new FakeDeviceManager();
    bindings.getDeviceById = async () => {
      throw new Error("Device not found");
    };
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const listed = await manager.listProcesses({ deviceId: "local" });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.error).toBeInstanceOf(AnalysisTimeoutError);
    expect(listed.error).toMatchObject({
      operation: "list_frida_processes",
      timeoutMs: 1_000,
    });
    if (!(listed.error instanceof AnalysisTimeoutError)) return;
    expect(listed.error.userMessage).toContain("1000 ms");
    expect(listed.error.userMessage).toContain("no runtime override");
    expect(listed.error.remediationAction).toContain("no runtime override");
  });

  it("preserves a Frida device-manager failure instead of claiming the lookup deadline expired", async () => {
    const bindings = new FakeDeviceManager();
    bindings.getDeviceById = async () => {
      throw new Error("Device manager is closed");
    };
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const listed = await manager.listProcesses({ deviceId: "local" });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
    expect(listed.error).not.toBeInstanceOf(AnalysisTimeoutError);
    expect(listed.error).toMatchObject({
      providerId: "frida",
      operation: "list_frida_processes",
      reason: "Device manager is closed",
    });
    expect(listed.error.message).toContain("Device manager is closed");
    expect(listed.error.message).not.toContain("deadlineExpired");
  });

  it("names a capture cap only after that observation dropped data", () => {
    expect(fridaCaptureLimitations({ messages_truncated: false })).toEqual([]);
    expect(
      fridaCaptureLimitations({ messages_truncated: true }).join("\n"),
    ).toContain("16777216");
    const field = fridaCaptureLimitations({
      messages: [{ type_truncated: true }],
    }).join("\n");
    expect(field).toContain("4096");
    expect(field).not.toContain("16777216");
    const text = fridaCaptureLimitations({
      messages: [
        {
          description_truncated: true,
          payload: { messages_truncated: true, type_truncated: true },
        },
      ],
    }).join("\n");
    expect(text).toContain("32768");
    expect(text).not.toContain("16777216");
    expect(text).not.toContain("4096");
    expect(
      fridaCaptureLimitations({
        messages: [{ payload: { messages_truncated: true } }],
      }),
    ).toEqual([]);
  });

  it("attaches by PID when Frida omits the target from process lookup", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.getProcessByPid = async () => {
      throw new Error("Process not found");
    };
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      deviceId: "local",
      pid: 512,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.pid).toBe(512);
    expect(bindings.device.attachedTargets).toEqual([512]);
    expect(started.value.target).toBe("pid 512");
    expect(bindings.device.session.isDetached()).toBe(false);
    await manager.closeAll();
    expect(bindings.device.session.isDetached()).toBe(true);
  });

  it("keeps the caller PID when Frida resolves a different process", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.getProcessByPid = async () => ({
      ...bindings.device.process,
      pid: 513,
    });
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      deviceId: "local",
      pid: 512,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.pid).toBe(512);
    expect(started.value.target).toBe("fixture (pid 512)");
    expect(bindings.device.attachedTargets).toEqual([512]);
    await manager.closeSession(started.value.sessionId);
  });

  it("records a session already detached during process metadata lookup", async () => {
    const bindings = new FakeDeviceManager();
    let lookupStarted!: () => void;
    const lookupEntered = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    let finishLookup!: () => void;
    const lookupGate = new Promise<void>((resolve) => {
      finishLookup = resolve;
    });
    bindings.device.getProcessByPid = async () => {
      lookupStarted();
      await lookupGate;
      return bindings.device.process;
    };
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const starting = manager.startSession({
      mode: "attach",
      deviceId: "local",
      pid: 512,
    });
    await lookupEntered;
    bindings.device.session.markDetached();
    finishLookup();

    const started = await starting;
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.pid).toBe(512);
    expect(bindings.device.attachedTargets).toEqual([512]);
    expect(started.value.state).toBe("detached");
    expect(manager.status(started.value.sessionId)?.state).toBe("detached");
    await manager.closeSession(started.value.sessionId);
  });

  it("still reports a real attach failure when process lookup is unavailable", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.getProcessByPid = async () => {
      throw new Error("Process not found");
    };
    bindings.device.attach = async () => {
      throw new Error("attach denied");
    };
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      deviceId: "local",
      pid: 512,
    });
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(JSON.stringify(started.error)).toContain("attach denied");
    await manager.closeAll();
  });

  it("retains a failed startup's spawn and remote lease until cleanup succeeds", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.attach = async () => {
      throw new Error("attach failed after spawn");
    };
    bindings.device.resumeFailureCount = 2;
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });

    const started = await manager.startSession({
      mode: "spawn",
      remote: { address: "127.0.0.1:27042" },
      program: "/tmp/fixture",
    });
    if (started.ok) throw new Error("Attach unexpectedly succeeded");
    expect(started.error.cleanupIncomplete).toBe(true);
    expect(bindings.device.resumed).toEqual([]);
    expect(bindings.removedRemote).toEqual([]);

    const closing = await manager.closeAll().catch((cause: unknown) => cause);
    expect(closing).toBeInstanceOf(AnalysisError);
    if (!(closing instanceof AnalysisError))
      throw new Error("Expected typed cleanup failure");
    expect(projectAnalysisError(closing)).toMatchObject({
      code: "cleanup_incomplete",
    });
    expect(bindings.device.resumed).toEqual([]);
    expect(bindings.removedRemote).toEqual([]);

    // A lookup could now select a different device with the same PID. Cleanup
    // must use the original provider handle, not select the target again.
    const replacement = new FakeDevice();
    bindings.getDeviceById = async () => replacement;
    bindings.addRemoteDevice = async () => replacement;
    await Promise.all([manager.closeAll(), manager.closeAll()]);
    expect(started.error.cleanupIncomplete).toBe(false);
    expect(closing.cleanupIncomplete).toBe(false);
    expect(bindings.device.resumed).toEqual([512]);
    expect(replacement.resumed).toEqual([]);
    expect(bindings.removedRemote).toEqual(["127.0.0.1:27042"]);
    await manager.closeAll();
    expect(bindings.device.resumed).toEqual([512]);
    expect(bindings.removedRemote).toEqual(["127.0.0.1:27042"]);
  });

  it("retains an acquired session when startup fails before registration", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.session.detached.connect = () => {
      throw new Error("detached signal registration failed");
    };
    bindings.device.session.detachFailureCount = 1;
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "spawn",
      deviceId: "local",
      program: "/tmp/fixture",
    });
    if (started.ok)
      throw new Error("Signal registration unexpectedly succeeded");
    expect(started.error.cleanupIncomplete).toBe(true);
    expect(bindings.device.session.isDetached()).toBe(false);
    expect(bindings.device.resumed).toEqual([]);

    await manager.closeAll();
    expect(bindings.device.session.isDetached()).toBe(true);
    expect(bindings.device.resumed).toEqual([512]);
  });

  it("does not release another session's remote lease when retrying failed startup removal", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.attach = async () => {
      throw new Error("attach failed");
    };
    bindings.removeRemoteFailureCount = 1;
    const remote = { address: "127.0.0.1:27042" };
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const failed = await manager.startSession({
      mode: "spawn",
      remote,
      program: "/tmp/fixture",
    });
    if (failed.ok) throw new Error("Attach unexpectedly succeeded");
    expect(failed.error.cleanupIncomplete).toBe(true);
    expect(bindings.device.resumed).toEqual([512]);

    bindings.device.attach = async () => bindings.device.session;
    const active = await manager.startSession({
      mode: "attach",
      remote,
      pid: 512,
    });
    if (!active.ok) throw active.error;
    const removedWhileSessionAttached: boolean[] = [];
    const remove = bindings.removeRemoteDevice.bind(bindings);
    bindings.removeRemoteDevice = async (address) => {
      removedWhileSessionAttached.push(!bindings.device.session.isDetached());
      await remove(address);
    };

    await manager.closeAll();
    expect(removedWhileSessionAttached).toEqual([false]);
    expect(bindings.removedRemote).toEqual([remote.address]);
    expect(bindings.device.resumed).toEqual([512]);
  });

  it("loads instrumentation before resuming a spawned target", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });

    const started = await manager.startSession({
      mode: "spawn",
      deviceId: "local",
      program: "/tmp/fixture",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.state).toBe("paused");
    expect(bindings.device.resumed).toEqual([]);

    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send({ event: 'loaded' });",
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.messages).toContainEqual(
      expect.objectContaining({
        type: "send",
        payload: { event: "loaded" },
      }),
    );
    expect(loaded.value.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(bindings.device.resumed).toEqual([]);

    const resumed = await manager.resumeSession(started.value.sessionId);
    expect(resumed.ok).toBe(true);
    expect(bindings.device.resumed).toEqual([512]);
    expect(manager.status(started.value.sessionId)?.targetResumeObserved).toBe(
      true,
    );
    expect(manager.status(started.value.sessionId)?.state).toBe("running");
    await manager.closeAll();
    expect(bindings.device.session.isDetached()).toBe(true);
  });

  it("removes a remote device after process discovery", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      remote: { address: "127.0.0.1:27042", token: "secret-token" },
      pid: 512,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const listed = await manager.listProcesses({
      remote: { address: "127.0.0.1:27042", token: "secret-token" },
    });

    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value.processes[0]?.pid).toBe(512);
      expect(listed.value.cleanupError).toBeNull();
    }
    expect(bindings.removedRemote).toEqual([]);
    await manager.closeSession(started.value.sessionId);
    expect(bindings.removedRemote).toEqual(["127.0.0.1:27042"]);
    await manager.closeAll();
  });

  it("preserves remote discovery facts when cleanup fails and retries cleanup", async () => {
    const bindings = new FakeDeviceManager();
    bindings.removeRemoteFailureCount = 1;
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const listed = await manager.listProcesses({
      remote: { address: "127.0.0.1:27042" },
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value.processes).toEqual([
        { pid: 512, name: "fixture", identifier: null },
      ]);
      expect(listed.value.cleanupError).toContain(
        "remote device removal failed",
      );
    }
    await manager.closeAll();
    expect(bindings.removedRemote).toEqual(["127.0.0.1:27042"]);
  });

  it("does not expose remote credentials in shutdown cleanup failures", async () => {
    const token = "synthetic-close-token";
    const certificate = "synthetic-close-certificate";
    const bindings = new FakeDeviceManager();
    bindings.removeRemoteFailureCount = 2;
    bindings.removeRemoteFailureMessage = `${token} ${certificate}`;
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      remote: { address: "127.0.0.1:27042", token, certificate },
      pid: 512,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let failure = "";
    try {
      await manager.closeAll();
    } catch (cause: unknown) {
      failure =
        cause instanceof AggregateError
          ? cause.errors.map((entry: unknown) => String(entry)).join("; ")
          : String(cause);
    }
    expect(failure).not.toBe("");
    expect(failure).not.toContain(token);
    expect(failure).not.toContain(certificate);
  });

  it("unloads scripts, resumes a paused spawn, and detaches without killing it", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "spawn",
      deviceId: "local",
      program: "/tmp/fixture",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });
    expect(loaded.ok).toBe(true);
    const closed = await manager.closeSession(started.value.sessionId);
    expect(closed.ok).toBe(true);
    expect(bindings.device.session.scripts[0]?.isDestroyed).toBe(true);
    expect(bindings.device.resumed).toEqual([512]);
    expect(bindings.device.session.isDetached()).toBe(true);
  });

  it("retains a failed script handle until a later cleanup retry releases it", async () => {
    const bindings = new FakeDeviceManager();
    bindings.device.session.nextLoadFailure = new Error("script load failed");
    bindings.device.session.nextUnloadFailureCount = 1;
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      deviceId: "local",
      pid: 512,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });

    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.cleanupIncomplete).toBe(true);
    expect(manager.status(started.value.sessionId)?.scripts).toHaveLength(1);
    expect(bindings.device.session.scripts[0]?.unloadCalls).toBe(1);

    const closed = await manager.closeSession(started.value.sessionId);

    expect(closed.ok).toBe(true);
    expect(bindings.device.session.scripts[0]?.unloadCalls).toBe(2);
    expect(bindings.device.session.scripts[0]?.isDestroyed).toBe(true);
    expect(manager.status(started.value.sessionId)).toBeUndefined();
    if (!loaded.ok) expect(loaded.error.cleanupIncomplete).toBe(false);
  });

  it("closes a session when its target already destroyed the script", async () => {
    const { bindings, manager, started } = await startLocalAttachedSession();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });
    expect(loaded.ok).toBe(true);
    const script = bindings.device.session.scripts[0];
    expect(script).toBeDefined();
    if (script === undefined) return;
    script.isDestroyed = true;
    bindings.device.session.markDetached();

    const closed = await manager.closeSession(started.value.sessionId);

    expect(closed.ok).toBe(true);
    expect(script.unloadCalls).toBe(0);
    expect(manager.status(started.value.sessionId)).toBeUndefined();
  });

  it("does not resume a paused spawn after its parent session detached", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "spawn",
      deviceId: "local",
      program: "/tmp/fixture",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    bindings.device.session.markDetachedWithoutSignal();

    const closed = await manager.closeSession(started.value.sessionId);

    expect(closed.ok).toBe(true);
    expect(bindings.device.resumed).toEqual([]);
    expect(manager.status(started.value.sessionId)).toBeUndefined();
  });

  it("uses successful parent-session detach to release a script after unload fails", async () => {
    const { bindings, manager, started } = await startLocalAttachedSession();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });
    expect(loaded.ok).toBe(true);
    const script = bindings.device.session.scripts[0];
    expect(script).toBeDefined();
    if (script === undefined) return;
    script.unloadFailureCount = 1;

    const closed = await manager.closeSession(started.value.sessionId);

    expect(closed.ok).toBe(true);
    expect(script.isDestroyed).toBe(true);
    expect(manager.status(started.value.sessionId)).toBeUndefined();
  });

  it("keeps a paused spawn paused when script unload and session detach fail", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "spawn",
      deviceId: "local",
      program: "/tmp/fixture",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });
    expect(loaded.ok).toBe(true);
    const script = bindings.device.session.scripts[0];
    expect(script).toBeDefined();
    if (script === undefined) return;
    script.unloadFailureCount = 1;
    bindings.device.session.detachFailureCount = 1;

    const closed = await manager.closeSession(started.value.sessionId);

    expect(closed.ok).toBe(false);
    expect(bindings.device.resumed).toEqual([]);
    expect(manager.status(started.value.sessionId)?.scripts).toHaveLength(1);
  });

  it("retries resuming a spawn after detach succeeded but resume failed", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "spawn",
      deviceId: "local",
      program: "/tmp/fixture",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });
    expect(loaded.ok).toBe(true);
    bindings.device.resumeFailureCount = 1;

    const firstClose = await manager.closeSession(started.value.sessionId);

    expect(firstClose.ok).toBe(false);
    expect(bindings.device.session.isDetached()).toBe(true);
    expect(manager.status(started.value.sessionId)).toBeDefined();

    const retry = await manager.closeSession(started.value.sessionId);

    expect(retry.ok).toBe(true);
    expect(bindings.device.resumed).toEqual([512]);
    expect(manager.status(started.value.sessionId)).toBeUndefined();
  });

  it("keeps a remote device while a spawned target resume is pending", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "spawn",
      remote: { address: "127.0.0.1:27042" },
      program: "/tmp/fixture",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    bindings.device.resumeFailureCount = 1;

    const firstClose = await manager.closeSession(started.value.sessionId);

    expect(firstClose.ok).toBe(false);
    expect(bindings.removedRemote).toEqual([]);

    const retry = await manager.closeSession(started.value.sessionId);

    expect(retry.ok).toBe(true);
    expect(bindings.device.resumed).toEqual([512]);
    expect(bindings.removedRemote).toEqual(["127.0.0.1:27042"]);
  });

  it("keeps a remote device while script and session cleanup are pending", async () => {
    const bindings = new FakeDeviceManager();
    const manager = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    const started = await manager.startSession({
      mode: "attach",
      remote: { address: "127.0.0.1:27042" },
      pid: 512,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "send('ready');",
    });
    expect(loaded.ok).toBe(true);
    const script = bindings.device.session.scripts[0];
    expect(script).toBeDefined();
    if (script === undefined) return;
    script.unloadFailureCount = 1;
    bindings.device.session.detachFailureCount = 1;

    const firstClose = await manager.closeSession(started.value.sessionId);

    expect(firstClose.ok).toBe(false);
    expect(bindings.removedRemote).toEqual([]);

    const retry = await manager.closeSession(started.value.sessionId);

    expect(retry.ok).toBe(true);
    expect(script.isDestroyed).toBe(true);
    expect(bindings.removedRemote).toEqual(["127.0.0.1:27042"]);
  });
});

it("does not release a newer remote lease when retrying an older session close", async () => {
  const bindings = new FakeDeviceManager();
  bindings.removeRemoteFailureCount = 1;
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const remote = { address: "127.0.0.1:27042" };
  const first = await manager.startSession({
    mode: "attach",
    remote,
    pid: 512,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  const failedClose = await manager.closeSession(first.value.sessionId);
  expect(failedClose.ok).toBe(false);

  const second = await manager.startSession({
    mode: "attach",
    remote,
    pid: 512,
  });
  expect(second.ok).toBe(true);
  if (!second.ok) return;

  const retry = await manager.closeSession(first.value.sessionId);
  expect(retry.ok).toBe(true);
  expect(bindings.removedRemote).toEqual([]);
  expect(manager.status(second.value.sessionId)).toBeDefined();

  const secondClose = await manager.closeSession(second.value.sessionId);
  expect(secondClose.ok).toBe(true);
  expect(bindings.removedRemote).toEqual([remote.address]);
});

it("attributes messages to their producing script and returns each load's messages", async () => {
  const { bindings, manager, started } = await startLocalAttachedSession();
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  bindings.device.session.nextPayload = { tag: "A" };
  const first = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send({tag: 'A'});",
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  bindings.device.session.nextPayload = { tag: "B" };
  const second = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send({tag: 'B'});",
  });
  expect(second.ok).toBe(true);
  if (!second.ok) return;

  expect(first.value.messages).toEqual([
    expect.objectContaining({
      script_id: first.value.scriptId,
      payload: { tag: "A" },
    }),
  ]);
  expect(second.value.messages).toEqual([
    expect.objectContaining({
      script_id: second.value.scriptId,
      payload: { tag: "B" },
    }),
  ]);
  expect(manager.status(started.value.sessionId)?.messages).toEqual([
    expect.objectContaining({ script_id: first.value.scriptId }),
    expect.objectContaining({ script_id: second.value.scriptId }),
  ]);
  await manager.closeAll();
});

it("retains Frida error source coordinates in script and session evidence", async () => {
  const { bindings, manager, started } = await startLocalAttachedSession();
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  bindings.device.session.nextMessage = {
    type: "error",
    description: "instrumentation failed",
    stack: "Error: instrumentation failed",
    fileName: "agent.js",
    lineNumber: 7,
    columnNumber: 3,
  };
  const loaded = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "throw new Error('instrumentation failed');",
  });
  expect(loaded.ok).toBe(true);
  if (loaded.ok) {
    expect(loaded.value.messages[0]).toMatchObject({
      type: "error",
      file_name: "agent.js",
      line_number: 7,
      column_number: 3,
    });
  }
  expect(manager.status(started.value.sessionId)?.messages[0]).toMatchObject({
    file_name: "agent.js",
    line_number: 7,
    column_number: 3,
  });

  bindings.device.session.nextMessage = {
    type: "error",
    description: "location unavailable",
    stack: "Error: location unavailable",
  };
  const withoutLocation = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "throw new Error('location unavailable');",
  });
  expect(withoutLocation.ok).toBe(true);
  if (withoutLocation.ok) {
    expect(withoutLocation.value.messages[0]).not.toHaveProperty("file_name");
    expect(withoutLocation.value.messages[0]).not.toHaveProperty("line_number");
    expect(withoutLocation.value.messages[0]).not.toHaveProperty(
      "column_number",
    );
  }
  await manager.closeAll();
});

it("does not carry earlier script truncation into a complete later load", async () => {
  const { bindings, manager, started } = await startLocalAttachedSession();
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  const first = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send('A');",
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const firstScript = bindings.device.session.scripts[0];
  expect(firstScript).toBeDefined();
  if (firstScript === undefined) return;
  for (let index = 0; index < 800; index += 1)
    firstScript.message.emit(
      { type: "send", payload: "x".repeat(32_700) },
      null,
    );

  bindings.device.session.nextPayload = { tag: "B" };
  const second = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send('B');",
  });
  expect(second.ok).toBe(true);
  if (second.ok) {
    expect(second.value.messages).toHaveLength(1);
    expect(second.value.messagesTruncated).toBe(false);
  }
  expect(manager.status(started.value.sessionId)?.messagesTruncated).toBe(true);
  await manager.closeAll();
});

it("reports truncation when that script loses its own message", async () => {
  const { bindings, manager, started } = await startLocalAttachedSession();
  const session = bindings.device.session;
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  session.nextPayload = { tag: "A" };
  const first = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send({tag: 'A'});",
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  let finishSecondLoad: (() => void) | undefined;
  let markSecondLoadStarted: (() => void) | undefined;
  const secondLoadGate = new Promise<void>((resolve) => {
    finishSecondLoad = resolve;
  });
  const secondLoadStarted = new Promise<void>((resolve) => {
    markSecondLoadStarted = resolve;
  });
  session.nextPayload = { tag: "B2" };
  session.scriptLoadGate = secondLoadGate;
  session.onScriptLoadStarted = () => markSecondLoadStarted?.();
  const secondLoading = manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send({tag: 'B2'});",
  });
  await secondLoadStarted;
  const secondScript = session.scripts[1];
  expect(secondScript).toBeDefined();
  if (secondScript === undefined) return;
  secondScript.message.emit({ type: "send", payload: { tag: "B1" } }, null);

  const firstScript = session.scripts[0];
  expect(firstScript).toBeDefined();
  if (firstScript === undefined) return;
  for (let index = 0; index < 800; index += 1)
    firstScript.message.emit(
      { type: "send", payload: "x".repeat(32_700) },
      null,
    );

  finishSecondLoad?.();
  const second = await secondLoading;
  expect(second.ok).toBe(true);
  if (second.ok) {
    expect(second.value.messages).toContainEqual(
      expect.objectContaining({
        script_id: second.value.scriptId,
        payload: { tag: "B2" },
      }),
    );
    expect(second.value.messagesTruncated).toBe(true);
  }
  expect(manager.status(started.value.sessionId)?.messagesTruncated).toBe(true);
  expect(manager.status(started.value.sessionId)?.messages).toContainEqual(
    expect.objectContaining({
      script_id: second.ok ? second.value.scriptId : "",
      payload: { tag: "B2" },
    }),
  );
  await manager.closeAll();
});

it("retains the newest contiguous messages across repeated budget evictions", async () => {
  const { bindings, manager, started } = await startLocalAttachedSession();
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  bindings.device.session.nextPayload = { index: -1 };
  const loaded = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send({index: -1});",
  });
  expect(loaded.ok).toBe(true);
  const script = bindings.device.session.scripts[0];
  expect(script).toBeDefined();
  if (script === undefined) return;

  // About 500 of these fit the 16 MiB budget, so 2,000 sends evict and
  // compact the queue several times.
  const filler = "x".repeat(32_000);
  for (let index = 0; index < 2_000; index += 1)
    script.message.emit({ type: "send", payload: { index, filler } }, null);

  const status = manager.status(started.value.sessionId);
  expect(status?.messagesTruncated).toBe(true);
  const indexes = (status?.messages ?? []).map(
    (message) => (message as { payload: { index: number } }).payload.index,
  );
  expect(indexes.length).toBeGreaterThan(400);
  expect(indexes.at(-1)).toBe(1_999);
  expect(indexes).toEqual(
    Array.from(
      { length: indexes.length },
      (_, offset) => 2_000 - indexes.length + offset,
    ),
  );
  await manager.closeAll();
});

it("serializes a final remote release against a new same-endpoint session", async () => {
  const bindings = new FakeDeviceManager();
  let enteredRemoval: (() => void) | undefined;
  const removalEntered = new Promise<void>((resolve) => {
    enteredRemoval = resolve;
  });
  let finishRemoval: (() => void) | undefined;
  const removalGate = new Promise<void>((resolve) => {
    finishRemoval = resolve;
  });
  bindings.removeRemoteDevice = async (address) => {
    enteredRemoval?.();
    await removalGate;
    bindings.removedRemote.push(address);
  };
  const manager = new FridaInstrumentationManager({
    deviceManager: bindings,
  });
  const remote = { address: "127.0.0.1:27042", token: "same-token" };
  const first = await manager.startSession({
    mode: "attach",
    remote,
    pid: 512,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  const closing = manager.closeSession(first.value.sessionId);
  await removalEntered;
  let secondStarted = false;
  const secondPromise = manager
    .startSession({ mode: "attach", remote, pid: 512 })
    .then((result) => {
      secondStarted = true;
      return result;
    });
  await Promise.resolve();
  expect(secondStarted).toBe(false);
  finishRemoval?.();
  expect((await closing).ok).toBe(true);
  const second = await secondPromise;
  expect(second.ok).toBe(true);
  if (second.ok) await manager.closeSession(second.value.sessionId);
  expect(bindings.removedRemote).toEqual([
    "127.0.0.1:27042",
    "127.0.0.1:27042",
  ]);
});

it("redacts remote credentials and maps a missing optional binding", async () => {
  const secret = "synthetic-secret-token";
  const remoteManager = new FakeDeviceManager();
  remoteManager.addRemoteDevice = async () => {
    throw new Error(`authorization rejected: ${secret}`);
  };
  const remote = new FridaInstrumentationManager({
    deviceManager: remoteManager,
  });
  const failed = await remote.listProcesses({
    remote: {
      address: "wss://host/path?token=synthetic-url-token",
      token: secret,
    },
  });
  expect(failed.ok).toBe(false);
  if (!failed.ok) {
    expect(failed.error.message).not.toContain(secret);
    expect(failed.error.message).not.toContain("synthetic-url-token");
    expect(JSON.stringify(projectAnalysisError(failed.error))).not.toContain(
      "synthetic-url-token",
    );
  }

  const missing = new FridaInstrumentationManager({
    deviceManagerLoader: async () => {
      throw new Error("Cannot find package 'frida'");
    },
  });
  const unavailable = await missing.listDevices();
  expect(unavailable.ok).toBe(false);
  if (!unavailable.ok)
    expect(unavailable.error.message).toContain("Cannot find package 'frida'");
});

it("retains the selected device or credential-free remote address on discovery and startup failures", async () => {
  const bindings = new FakeDeviceManager();
  bindings.getDeviceById = async () => {
    throw new Error("Device not found");
  };
  bindings.addRemoteDevice = async () => {
    throw new Error("Unable to connect to remote frida-server");
  };
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const device = await manager.listProcesses({ deviceId: "missing-device" });
  expect(device.ok).toBe(false);
  if (!device.ok) {
    expect(projectAnalysisError(device.error)).toMatchObject({
      code: "provider_timeout",
      details: { diagnostics: { device_id: "missing-device" } },
    });
  }
  const remote = { address: "127.0.0.1:27042", token: "secret-token" };
  for (const result of [
    await manager.listProcesses({ remote }),
    await manager.listDevices(remote),
    await manager.startSession({ mode: "attach", remote, pid: 512 }),
  ]) {
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "capability_unavailable",
      details: { diagnostics: { remote_address: remote.address } },
    });
    expect(JSON.stringify(projected)).not.toContain(remote.token);
    expect(projected.remediation.action).toContain("selected Frida server");
  }
});

it("redacts credentials from inherited typed failure diagnostics", async () => {
  const bindings = new FakeDeviceManager();
  bindings.addRemoteDevice = async () => {
    throw new AnalysisTimeoutError("frida_device_lookup", 1000, {
      diagnostics: { detail: "token=synthetic-secret-token" },
    });
  };
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const result = await manager.listProcesses({
    remote: { address: "127.0.0.1:27042", token: "synthetic-secret-token" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "provider_timeout",
    details: { diagnostics: { remote_address: "127.0.0.1:27042" } },
  });
  expect(JSON.stringify(projected)).not.toContain("synthetic-secret-token");
});

it("does not describe a connected device's enumeration failure as a connection failure", async () => {
  const bindings = new FakeDeviceManager();
  bindings.device.enumerateProcesses = async () => {
    throw new Error("process enumeration denied");
  };
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const result = await manager.listProcesses({
    remote: { address: "127.0.0.1:27042" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const projected = projectAnalysisError(result.error);
  expect(projected.details?.diagnostics).toMatchObject({
    remote_address: "127.0.0.1:27042",
  });
  expect(projected.remediation.action).not.toContain("selected Frida server");
});

it("clears current binding failure after recovery", async () => {
  const bindings = new FakeDeviceManager();
  let attempts = 0;
  const manager = new FridaInstrumentationManager({
    deviceManagerLoader: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient binding load failure");
      return bindings;
    },
  });

  const failed = await manager.listDevices();
  expect(failed.ok).toBe(false);
  if (!failed.ok)
    expect(failed.error.message).toContain("transient binding load failure");
  expect(manager.availabilityFailure()?.reason).toBe(
    "transient binding load failure",
  );

  const recovered = await manager.listDevices();
  expect(recovered.ok).toBe(true);
  expect(manager.availabilityFailure()).toBeUndefined();
});

it("keeps remote option conflicts as actionable invalid input", async () => {
  const manager = new FridaInstrumentationManager({
    deviceManager: new FakeDeviceManager(),
  });
  const retained = await manager.startSession({
    mode: "attach",
    remote: { address: "127.0.0.1:27042", token: "first-token" },
    pid: 512,
  });
  expect(retained.ok).toBe(true);
  if (!retained.ok) return;

  const conflicting = [
    await manager.listDevices({
      address: "127.0.0.1:27042",
      token: "other-token",
    }),
    await manager.listProcesses({
      remote: { address: "127.0.0.1:27042", token: "other-token" },
    }),
    await manager.startSession({
      mode: "attach",
      remote: { address: "127.0.0.1:27042", token: "other-token" },
      pid: 512,
    }),
  ];
  for (const result of conflicting) {
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    if (!(result.error instanceof AnalysisInputError)) throw result.error;
    expect(result.error.operation).not.toBe("frida_remote_connection");
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["remote"],
        reason: "invalid_value",
        message: expect.stringContaining("different connection options"),
      }),
    );
    expect(result.error.message).not.toContain("other-token");
  }
  await manager.closeAll();
});

it("redacts remote credentials echoed by a target script", async () => {
  const token = "synthetic-token-from-auth";
  const certificate = "synthetic-certificate-from-auth";
  const bindings = new FakeDeviceManager();
  bindings.device.session.nextPayload = { token, certificate };
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const started = await manager.startSession({
    mode: "attach",
    remote: { address: "127.0.0.1:27042", token, certificate },
    pid: 512,
  });
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const loaded = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send('credential payload');",
  });
  expect(loaded.ok).toBe(true);
  if (loaded.ok) {
    const serialized = JSON.stringify(loaded.value.messages);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(certificate);
    expect(serialized).toContain("[redacted]");
  }
  await manager.closeAll();
});

it("bounds oversized Frida message metadata before retaining it", async () => {
  const bindings = new FakeDeviceManager();
  bindings.device.session.nextDescription = "d".repeat(1_000_000);
  bindings.device.session.nextStack = "s".repeat(1_000_000);
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const started = await manager.startSession({
    mode: "attach",
    deviceId: "local",
    pid: 512,
  });
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const loaded = await manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send('metadata');",
  });
  expect(loaded.ok).toBe(true);
  if (loaded.ok) {
    expect(loaded.value.messagesTruncated).toBe(false);
    const message = loaded.value.messages[0];
    expect(message).toMatchObject({
      description_truncated: true,
      stack_truncated: true,
    });
    expect(JSON.stringify(message).length).toBeLessThan(100_000);
  }
  await manager.closeAll();
});

it.each([
  {
    name: "ASCII at the limit",
    input: "x".repeat(32_768),
    retained: "x".repeat(32_768),
    truncated: false,
  },
  {
    name: "a trailing unpaired high surrogate",
    input: "x".repeat(32_765) + "\ud800",
    retained: "x".repeat(32_765),
    truncated: true,
  },
  {
    name: "a trailing unpaired low surrogate",
    input: "x".repeat(32_765) + "\udc00",
    retained: "x".repeat(32_765),
    truncated: true,
  },
  {
    name: "a valid surrogate pair at the limit",
    input: "x".repeat(32_764) + "\ud800\udc00",
    retained: "x".repeat(32_764) + "\ud800\udc00",
    truncated: false,
  },
  {
    name: "repeated unpaired high surrogates",
    input: "\ud800".repeat(10_922),
    retained: "\ud800".repeat(5_461),
    truncated: true,
  },
])(
  "bounds JSON metadata bytes for $name",
  async ({ input, retained, truncated }) => {
    const { bindings, manager, started } = await startLocalAttachedSession();
    onTestFinished(() => manager.closeAll());
    if (!started.ok) throw started.error;
    bindings.device.session.nextMessage = {
      type: "error",
      description: input,
      stack: input,
      fileName: input,
    };
    const loaded = await manager.loadScript(started.value.sessionId, {
      sourceKind: "inline",
      source: "// inert fixture",
    });
    if (!loaded.ok) throw loaded.error;
    const message = jsonObjectSchema.parse(loaded.value.messages[0]);
    for (const field of ["description", "stack", "file_name"]) {
      expect(
        Buffer.byteLength(JSON.stringify(message[field])) - 2,
      ).toBeLessThanOrEqual(32_768);
      expect(message[field]).toBe(retained);
      expect(message[`${field}_truncated`] ?? false).toBe(truncated);
    }
    expect(loaded.value.messagesTruncated).toBe(false);
    expect(manager.status(started.value.sessionId)).toMatchObject({
      messages: [message],
      messagesTruncated: false,
    });
  },
);

it("serializes script loading against concurrent close and unloads the loaded script", async () => {
  const bindings = new FakeDeviceManager();
  let finishScriptLoad: (() => void) | undefined;
  const scriptLoadGate = new Promise<void>((resolve) => {
    finishScriptLoad = resolve;
  });
  let markScriptLoadStarted: (() => void) | undefined;
  const scriptLoadStarted = new Promise<void>((resolve) => {
    markScriptLoadStarted = resolve;
  });
  bindings.device.session.scriptLoadGate = scriptLoadGate;
  bindings.device.session.onScriptLoadStarted = () => markScriptLoadStarted?.();
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const started = await manager.startSession({
    mode: "attach",
    deviceId: "local",
    pid: 512,
  });
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  const loading = manager.loadScript(started.value.sessionId, {
    sourceKind: "inline",
    source: "send('loaded');",
  });
  await scriptLoadStarted;
  let closed = false;
  const closing = manager.closeSession(started.value.sessionId);
  void closing.then(() => {
    closed = true;
  });
  expect(manager.closeSession(started.value.sessionId)).toBe(closing);
  await Promise.resolve();
  expect(closed).toBe(false);
  finishScriptLoad?.();
  expect((await loading).ok).toBe(true);
  expect((await closing).ok).toBe(true);
  expect(bindings.device.session.scripts[0]?.isDestroyed).toBe(true);
  expect(bindings.device.session.isDetached()).toBe(true);
});

it("drains startup when the provider loader initiates shutdown", async () => {
  const bindings = new FakeDeviceManager();
  let closing: Promise<void> | undefined;
  const manager = new FridaInstrumentationManager({
    deviceManagerLoader: async () => {
      closing = manager.closeAll();
      return bindings;
    },
  });
  const started = await manager.startSession({
    mode: "spawn",
    deviceId: "local",
    program: "/tmp/fixture",
  });
  if (!started.ok) throw started.error;
  expect(closing).toBeDefined();
  await closing;
  expect(bindings.device.session.isDetached()).toBe(true);
  expect(bindings.device.resumed).toEqual([512]);
  expect(manager.status(started.value.sessionId)).toBeUndefined();
});

it("names the unknown session or script ID it rejects", async () => {
  const { manager, started } = await startLocalAttachedSession();
  if (!started.ok) throw started.error;
  const missing = "00000000-0000-4000-8000-000000000009";
  const sessionIssue = {
    path: ["session_id"],
    reason: "invalid_value",
    message: `No open Frida session ${missing}; start one with start_frida_session.`,
  };
  for (const result of [
    await manager.closeSession(missing),
    await manager.resumeSession(missing),
    await manager.loadScript(missing, { sourceKind: "inline", source: "" }),
    await manager.unloadScript(missing, missing),
  ])
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", issues: [sessionIssue] },
    });
  expect(
    await manager.unloadScript(started.value.sessionId, missing),
  ).toMatchObject({
    ok: false,
    error: {
      issues: [
        {
          path: ["script_id"],
          reason: "invalid_value",
          message: `No loaded Frida script ${missing} in this session.`,
        },
      ],
    },
  });
  await manager.closeAll();
});

it.each([false, true])(
  "retains messages emitted during cancelled script cleanup after native rejection=%s",
  async (rejectNative) => {
    const { bindings, manager, started } = await startLocalAttachedSession();
    onTestFinished(() => manager.closeAll());
    if (!started.ok) throw started.error;
    const session = bindings.device.session;
    const entered = createDeferred<void>();
    const held = createDeferred<void>();
    onTestFinished(() => held.resolve());
    session.onScriptLoadStarted = entered.resolve;
    session.scriptLoadGate = held.promise;
    const nativeFailure = new Error("native load failed");
    if (rejectNative) session.nextLoadFailure = nativeFailure;
    const controller = new AbortController();
    const reason = new Error("cancel before native completion");
    const loading = manager.loadScript(
      started.value.sessionId,
      { sourceKind: "inline", source: "send('marker')" },
      controller.signal,
    );
    await entered.promise;
    const script = session.scripts[0];
    if (script === undefined) throw new Error("Missing admitted script");
    const unload = script.unload.bind(script);
    script.unload = async () => {
      script.message.emit({ type: "send", payload: "during cleanup" }, null);
      script.message.emit(
        { type: "send", description: "x".repeat(40_000) },
        null,
      );
      await unload();
    };
    controller.abort(reason);
    held.resolve();
    const loaded = await loading;
    if (loaded.ok) throw new Error("Cancelled load succeeded");
    expect(loaded.error).toBeInstanceOf(FridaScriptLoadCancelledError);
    if (!(loaded.error instanceof FridaScriptLoadCancelledError))
      throw loaded.error;
    expect(loaded.error.cause).toBe(reason);
    expect(loaded.error.script.messages).toContainEqual(
      expect.objectContaining({ payload: "during cleanup" }),
    );
    expect(loaded.error.script.messagesTruncated).toBe(false);
    expect(loaded.error.script.messages).toContainEqual(
      expect.objectContaining({ description_truncated: true }),
    );
    expect(loaded.error.diagnostics).toEqual(
      rejectNative ? { native_failure: nativeFailure.message } : undefined,
    );
    expect(loaded.error.cleanupIncomplete).toBe(false);
    expect(script.isDestroyed).toBe(true);
    expect(manager.status(started.value.sessionId)?.scripts).toEqual([]);
    expect(session.isDetached()).toBe(false);
  },
);

it("preserves a native rejection observed before cancellation during script cleanup", async () => {
  const { bindings, manager, started } = await startLocalAttachedSession();
  onTestFinished(() => manager.closeAll());
  if (!started.ok) throw started.error;
  const session = bindings.device.session;
  const entered = createDeferred<void>();
  const held = createDeferred<void>();
  onTestFinished(() => held.resolve());
  const create = session.createScript.bind(session);
  session.createScript = async () => {
    const script = await create();
    script.unload = async () => {
      entered.resolve();
      await held.promise;
      const owned = session.scripts[0];
      if (owned !== undefined) owned.isDestroyed = true;
    };
    return script;
  };
  const failure = new Error("native rejection first");
  session.nextLoadFailure = failure;
  const controller = new AbortController();
  const loading = manager.loadScript(
    started.value.sessionId,
    { sourceKind: "inline", source: "void 0" },
    controller.signal,
  );
  await entered.promise;
  controller.abort(new Error("late abort during cleanup"));
  held.resolve();
  const result = await loading;
  if (result.ok) throw new Error("Failed load succeeded");
  expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
  expect(result.error.cause).toBe(failure);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(manager.status(started.value.sessionId)?.scripts).toEqual([]);
});

it("restores the original load failure only after fallback cleanup confirms its exact owners", async () => {
  const bindings = new FakeDeviceManager();
  bindings.device.session.nextLoadFailure = new Error(
    "primary native load failed",
  );
  bindings.device.session.nextUnloadFailureCount = 3;
  bindings.device.session.detachFailureCount = 2;
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  const service = new FridaInstrumentationService(manager);
  const result = await service.instrument({
    mode: "attach",
    pid: 512,
    deviceId: "local",
    source: { sourceKind: "inline", source: "send(1)" },
    durationMs: 0,
  });
  if (result.ok) throw new Error("Expected native load failure");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cleanup_incomplete",
  });
  const closed = await service.closeAll().catch((cause: unknown) => cause);
  expect(closed).toBeInstanceOf(AnalysisError);
  expect(result.error.cleanupIncomplete).toBe(true);
  await service.closeAll();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "capability_unavailable",
    details: {
      operation: "load_frida_script",
      reason: "primary native load failed",
    },
  });
});

it("retries only unresolved sessions and resolves the typed close aggregate", async () => {
  const bindings = new FakeDeviceManager();
  const failing = new FakeSession();
  failing.detachFailureCount = 1;
  const successful = new FakeSession();
  const sessions = [failing, successful];
  const calls = [0, 0];
  for (const [index, session] of sessions.entries()) {
    const detach = session.detach.bind(session);
    session.detach = async () => {
      calls[index] = (calls[index] ?? 0) + 1;
      await detach();
    };
  }
  bindings.device.attach = async () => {
    const session = sessions.shift();
    if (session === undefined) throw new Error("Unexpected extra attach");
    return session;
  };
  const manager = new FridaInstrumentationManager({ deviceManager: bindings });
  await manager.startSession({ mode: "attach", pid: 512 });
  await manager.startSession({ mode: "attach", pid: 513 });
  const failure = await manager.closeAll().catch((cause: unknown) => cause);
  if (!(failure instanceof AnalysisError))
    throw new Error("Expected typed cleanup aggregate");
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupResources).toHaveLength(1);
  expect(calls).toEqual([1, 1]);
  await manager.closeAll();
  expect(calls).toEqual([2, 1]);
  expect(failure.cleanupIncomplete).toBe(false);
});
