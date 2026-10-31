declare module "frida" {
  export interface FridaMessage {
    readonly type: string;
    readonly payload?: unknown;
    readonly description?: string;
    readonly stack?: string;
    readonly fileName?: string;
    readonly lineNumber?: number;
    readonly columnNumber?: number;
  }

  export type SignalHandler = (...args: never[]) => void;

  export interface Signal<Handler extends SignalHandler> {
    connect(handler: Handler): void;
    disconnect(handler: Handler): void;
  }

  export interface RemoteDeviceOptions {
    certificate?: string;
    origin?: string;
    token?: string;
    keepaliveInterval?: number;
  }

  export interface SpawnOptions {
    argv?: string[];
    env?: Record<string, string>;
    envp?: Record<string, string>;
    cwd?: string;
    stdio?: "inherit" | "pipe";
  }

  export interface Process {
    readonly pid: number;
    readonly name: string;
  }

  export interface Script {
    readonly isDestroyed: boolean;
    readonly message: Signal<
      (message: FridaMessage, data: Buffer | null) => void
    >;
    load(): Promise<void>;
    unload(): Promise<void>;
  }

  export interface Session {
    readonly pid: number;
    readonly detached: Signal<() => void>;
    isDetached(): boolean;
    createScript(
      source: string,
      options?: { readonly name?: string },
    ): Promise<Script>;
    detach(): Promise<void>;
  }

  export interface Device {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    enumerateProcesses(): Promise<Process[]>;
    getProcessByPid(pid: number): Promise<Process>;
    spawn(program: string, options?: SpawnOptions): Promise<number>;
    resume(pid: number): Promise<void>;
    attach(pid: number): Promise<Session>;
  }

  export interface DeviceManager {
    enumerateDevices(): Promise<Device[]>;
    getDeviceById(id: string, timeout: number): Promise<Device>;
    addRemoteDevice(
      address: string,
      options?: RemoteDeviceOptions,
    ): Promise<Device>;
    removeRemoteDevice(address: string): Promise<void>;
  }

  export function getDeviceManager(): DeviceManager;
}
