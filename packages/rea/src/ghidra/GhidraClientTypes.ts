import type { Logger } from "pino";
import type { BridgeMaxRequestBytes } from "../config/bridgeMaxRequestBytes.js";
import type { Result } from "../domain/result.js";
import type { LinuxCgroupMemoryState } from "../process/LinuxCgroupMemory.js";
import type { GhidraLauncher } from "./GhidraLauncher.js";
import type { GhidraSessionError } from "./GhidraSessionError.js";
import type { GhidraSessionInfo } from "./GhidraSessionValues.js";
import type { GhidraTransportKind } from "./GhidraTransport.js";

/** Result of opening and authenticating one headless Ghidra session. */
export type GhidraStartResult = Result<GhidraSessionInfo, GhidraSessionError>;

/** Cancellation and deadline controls shared by authenticated requests. */
export interface GhidraRequestOptions {
  readonly decompileTimeoutSeconds?: number | null;
  readonly signal?: AbortSignal;
  /** Internal startup/shutdown deadline; analysis calls have no fixed deadline. */
  readonly timeoutMs?: number;
}

/** Safe lifecycle telemetry for one isolated Ghidra headless process. */
export type GhidraDiagnostic =
  | {
      readonly type: "launcher-output";
      readonly stream: "stdout" | "stderr";
      readonly bytes: number;
      readonly totalBytes: number;
    }
  | {
      readonly type: "launcher-exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | { readonly type: "cleanup-incomplete"; readonly reason: string };

/** Dependencies and exact profile commitment for one headless Program session. */
export interface GhidraClientOptions {
  readonly launcher: GhidraLauncher;
  readonly runId?: string;
  readonly targetPath: string;
  readonly targetSha256: string;
  readonly existingProject?: boolean;
  /** Installation host shared by runtime allocation and snapshot admission. */
  readonly platform?: NodeJS.Platform;
  readonly transport?: GhidraTransportKind;
  readonly providerVersion: string;
  readonly profileDigest: string;
  readonly expectedLanguageId?: string;
  readonly expectedCompilerSpecId?: string;
  readonly startupTimeoutMs?: number;
  readonly readStartupTimeoutMs?: () => number;
  readonly onDiagnostic?: (event: GhidraDiagnostic) => void;
  readonly logger?: Logger;
  /** Observes REA's memory cgroup around a run; defaults to the Linux cgroup v2 reader. */
  readonly readMemoryCgroup?: () => Promise<LinuxCgroupMemoryState | undefined>;
  /** Effective request ceiling; defaults to the configured bridge ceiling. */
  readonly bridgeMaxRequestBytes?: BridgeMaxRequestBytes;
}
