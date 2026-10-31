import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ok } from "../../../../src/domain/result.js";
import type {
  GhidraLaunchSession,
  GhidraLauncher,
} from "../../../../src/ghidra/GhidraLauncher.js";

/** Shared real-socket producer for Ghidra client and public MCP regressions. */
export const ghidraFixturePath = fileURLToPath(
  new URL("../../../fixtures/fakeGhidra.mjs", import.meta.url),
);

type FixtureMode =
  | "unicode_search"
  | "reject_first_connection"
  | "reject_all_connections"
  | "success"
  | "fragmented"
  | "oversized_result"
  | "wrong_identity"
  | "malformed"
  | "contradictory"
  | "future_id"
  | "analysis_timeout"
  | "remote_error"
  | "remote_startup_error"
  | "shutdown_error"
  | "invalid_shutdown_ack"
  | "hang_after_start"
  | "hang_tools"
  | "exit_tools"
  | "silent"
  | "exit"
  | "old_oom_then_malformed"
  | "prefix_cut_identifier_exit_tools"
  | "oom_exit_tools"
  | "sigkill_tools"
  | "sigkill_after_first_tool"
  | "flood_then_oom_exit_tools"
  | "flood_then_exit_tools"
  | "flood_then_malformed"
  | "flood_silent"
  | "diagnostic_output";

export class GhidraFixtureLauncher implements GhidraLauncher {
  #notifyStarted: ((child: ChildProcess) => void) | undefined;
  readonly started = new Promise<ChildProcess>((resolve) => {
    this.#notifyStarted = resolve;
  });
  readonly runtimeRoots: string[] = [];
  readonly endpointPaths: string[] = [];
  readonly tokens: string[] = [];
  readonly processes: ChildProcess[] = [];
  readonly requests: string[] = [];

  constructor(readonly mode: FixtureMode = "success") {}

  async launch(session: GhidraLaunchSession) {
    this.runtimeRoots.push(session.runtimeRoot);
    this.endpointPaths.push(session.endpointPath);
    this.tokens.push(session.token);
    const projectRoot = join(session.runtimeRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    const process_ = spawn(process.execPath, [ghidraFixturePath], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        REA_GHIDRA_FIXTURE_CONFIG: JSON.stringify({
          endpointPath: session.endpointPath,
          token: session.token,
          runId: session.runId,
          providerVersion: session.providerVersion,
          profileDigest: session.profileDigest,
          targetSha256: session.targetSha256,
          transport: session.transport,
          mode: this.mode,
        }),
      },
    });
    process_.on("message", (value: unknown) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "method" in value &&
        typeof value.method === "string"
      )
        this.requests.push(value.method);
    });
    this.processes.push(process_);
    process_.once("spawn", () => this.#notifyStarted?.(process_));
    return ok({
      process: process_,
      ownsProcessLifetime: true as const,
      projectRoot,
      ghidraLogPath: join(session.runtimeRoot, "ghidra.log"),
      scriptLogPath: join(session.runtimeRoot, "script.log"),
    });
  }
}
