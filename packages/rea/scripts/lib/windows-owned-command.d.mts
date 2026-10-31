import type { EventEmitter } from "node:events";

import type { WindowsNativeAuthority } from "../../src/windows/WindowsNativeLoader.js";
import type { WindowsOwnedProcess } from "../../src/windows/WindowsOwnedProcess.js";

export type WindowsOwnedProcessConstructor = typeof WindowsOwnedProcess;

export interface WindowsOwnedCommandOptions {
  readonly WindowsOwnedProcess: WindowsOwnedProcessConstructor;
  readonly command: string;
  readonly arguments: readonly string[];
  readonly cwd: string | undefined;
  readonly environment: NodeJS.ProcessEnv;
  readonly authority?: WindowsNativeAuthority;
}

export interface WindowsOwnedProcessLifecycle extends Pick<
  EventEmitter,
  "on" | "once" | "off"
> {
  readonly stdin?: Pick<EventEmitter, "on" | "once" | "off"> | null;
  cleanup(): Promise<{ readonly cleaned: boolean; readonly reason?: string }>;
}

export type WindowsOwnedCleanupDiagnostic =
  | { readonly type: "cleanup-failed"; readonly reason: string }
  | { readonly type: "cleanup-recovered" };

export interface WindowsOwnedProcessSupervisionOptions {
  readonly retryIntervalMs?: number;
  readonly onCleanupDiagnostic?: (
    diagnostic: WindowsOwnedCleanupDiagnostic,
  ) => void;
}

export function loadWindowsOwnedProcessClass(): Promise<WindowsOwnedProcessConstructor>;

export function createWindowsOwnedCommand(
  options: WindowsOwnedCommandOptions,
): WindowsOwnedProcess;

export function superviseWindowsOwnedProcess(
  child: WindowsOwnedProcessLifecycle,
  options?: WindowsOwnedProcessSupervisionOptions,
): {
  readonly finished: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  requestCleanup(): void;
};
