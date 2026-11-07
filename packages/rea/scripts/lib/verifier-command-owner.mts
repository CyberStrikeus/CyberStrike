import { randomUUID } from "node:crypto";

import type { RetainedResourceScope } from "../../src/application/AnalysisProvider.js";
import { AnalysisCleanupLease } from "../../src/artifacts/AnalysisCleanupLease.js";
import {
  ArtifactResourceScope,
  type ArtifactResourceOwner,
} from "../../src/artifacts/ArtifactResourceScope.js";
import {
  prepareOwnedCommand,
  runOwnedCommand,
} from "../../src/process/OwnedCommand.js";
import {
  spawnOwnedProviderProcess,
  type OwnedProviderProcessSpawnOptions,
  type ProviderProcessSnapshot,
  type SpawnedOwnedProviderProcess,
} from "../../src/process/ProviderProcess.js";
import { retainOwnedCommandCleanup } from "../../src/providers/OwnedCommandCleanup.js";
import { WindowsOwnedProcess } from "../../src/windows/WindowsOwnedProcess.js";
import { createWindowsOwnedCommand } from "./windows-owned-command.mjs";

interface VerifierCommandContext {
  readonly signal?: AbortSignal | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly timeout?: number | undefined;
  readonly windowsHide?: boolean | undefined;
  /** Acquire a real owned stdin pipe; closed-pipe sends EOF before awaiting output. */
  readonly stdin?: "pipe" | "closed-pipe";
}

export type VerifierCommandOptions = VerifierCommandContext &
  (
    | {
        /** execFile-compatible capacity for each output stream. */
        readonly maxBuffer?: number | undefined;
        readonly diagnosticBytes?: never;
      }
    | {
        /** Canonical command capacity across both streams. */
        readonly diagnosticBytes: number;
        readonly maxBuffer?: never;
      }
  );

export interface VerifierCommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export interface VerifierCleanupOwner {
  close(): Promise<void>;
  readonly cleanupResources?: readonly string[] | undefined;
}

/** Command and adopted-resource ownership without filesystem removal authority. */
export interface VerifierCommands {
  exec(
    command: string,
    arguments_: readonly string[],
    options?: VerifierCommandOptions,
  ): Promise<VerifierCommandOutput>;
  adopt(owner: VerifierCleanupOwner, resource: string): void;
  readonly cleanupResources: readonly string[];
  close(): Promise<void>;
}

export interface VerifierCommandsOptions {
  readonly launcher?: (
    input: OwnedProviderProcessSpawnOptions,
  ) => Promise<SpawnedOwnedProviderProcess>;
}

/** An ordinary nonzero exit whose process and output cleanup both completed. */
export class VerifierCommandExitError extends Error {
  constructor(
    readonly command: string,
    readonly arguments_: readonly string[],
    readonly code: number,
    readonly snapshot: ProviderProcessSnapshot,
  ) {
    super(
      `Command failed: ${[command, ...arguments_].join(" ")}\n${snapshot.stderr.text}`,
    );
    this.name = "VerifierCommandExitError";
  }
}

const launchVerifierCommand = async (
  input: OwnedProviderProcessSpawnOptions,
): Promise<SpawnedOwnedProviderProcess> => {
  if (process.platform !== "win32") return spawnOwnedProviderProcess(input);
  input.signal?.throwIfAborted();
  const child = createWindowsOwnedCommand({
    WindowsOwnedProcess,
    command: input.command,
    arguments: input.arguments,
    cwd: input.cwd,
    environment: {
      ...input.hostEnvironment,
      ...input.env,
      REA_PROCESS_RUN_ID: input.runId,
    },
  });
  // These labels describe the launch; cleanup authority is the exact native job.
  return {
    process: child,
    ownership: {
      runId: input.runId,
      leaderPid: child.pid,
      processGroupId: child.pid,
      expectedParentPid: process.pid,
    },
    cleanup: () => child.cleanup(),
  };
};

const commandLimits = (options: VerifierCommandOptions) => {
  if (
    options.stdin !== undefined &&
    options.stdin !== "pipe" &&
    options.stdin !== "closed-pipe"
  )
    throw new TypeError(
      "Verifier command stdin must be pipe or closed-pipe when supplied",
    );
  const timeout = options.timeout ?? 0;
  if (!Number.isSafeInteger(timeout) || timeout < 0)
    throw new RangeError(
      "Verifier command timeout must be a nonnegative integer",
    );
  if (options.maxBuffer !== undefined && options.diagnosticBytes !== undefined)
    throw new TypeError("Select a per-stream or aggregate command capacity");
  const capacity = options.diagnosticBytes ?? options.maxBuffer ?? 1024 * 1024;
  if (typeof capacity !== "number" || Number.isNaN(capacity) || capacity < 0)
    throw new RangeError(
      "Verifier command output capacity must be nonnegative",
    );
  if (process.platform === "win32" && options.windowsHide === false)
    throw new Error(
      "Owned verifier commands require hidden Windows process launch",
    );
  return {
    timeoutMs: timeout === 0 ? null : timeout,
    diagnosticBytes:
      options.diagnosticBytes === undefined
        ? { stdout: capacity, stderr: capacity }
        : capacity,
    acceptNonZeroExit: true,
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  };
};

class VerifierCommandOwner implements VerifierCommands {
  readonly #resources = new ArtifactResourceScope();
  readonly #controller = new AbortController();
  readonly #adopted = new WeakMap<
    VerifierCleanupOwner,
    ArtifactResourceOwner
  >();
  readonly #resourceOwner: RetainedResourceScope;
  #closed = false;
  #released = false;
  #closing: Promise<void> | undefined;

  constructor(
    private readonly launcher: (
      input: OwnedProviderProcessSpawnOptions,
    ) => Promise<SpawnedOwnedProviderProcess>,
  ) {
    this.#resourceOwner = {
      retain: (owner, resource) => this.adopt(owner, resource),
      run: (work) => this.#resources.run(work),
    };
  }

  get cleanupResources(): readonly string[] {
    return this.#resources.cleanupResources;
  }

  exec(
    command: string,
    arguments_: readonly string[],
    options: VerifierCommandOptions = {},
  ): Promise<VerifierCommandOutput> {
    if (this.#closed)
      return Promise.reject(new Error("Verifier command owner is closed"));
    return this.#resources.run(async () => {
      try {
        const limits = commandLimits(options);
        const signal =
          options.signal === undefined
            ? this.#controller.signal
            : AbortSignal.any([this.#controller.signal, options.signal]);
        // Independently bounded native preparation stays outside the command's
        // deadline and inside this admitted resource lifetime.
        await prepareOwnedCommand(signal);
        const snapshot = await runOwnedCommand(
          {
            command,
            arguments: arguments_,
            cwd: options.cwd ?? process.cwd(),
            hostEnvironment: options.env ?? process.env,
            expectedCommand: null,
            runId: `rea-verifier-command-${randomUUID()}`,
            sweepTokenOwnedProcesses: true,
          },
          limits,
          { signal, launcher: this.launcher },
        );
        if (typeof snapshot.exitCode === "number" && snapshot.exitCode !== 0)
          throw new VerifierCommandExitError(
            command,
            arguments_,
            snapshot.exitCode,
            snapshot,
          );
        return {
          stdout: snapshot.stdout.text,
          stderr: snapshot.stderr.text,
        };
      } catch (cause: unknown) {
        retainOwnedCommandCleanup(
          cause,
          this.#resourceOwner,
          "verifier",
          command,
        );
        throw cause;
      }
    });
  }

  adopt(owner: VerifierCleanupOwner, resource: string): void {
    if (this.#released)
      throw new Error("Verifier command resource release has completed");
    let retained = this.#adopted.get(owner);
    if (retained === undefined) {
      retained = {
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      };
      this.#adopted.set(owner, retained);
    }
    // An admitted command can transfer a late preparation/cleanup capability
    // while close is joining it. Acquisition must precede this scope's release.
    this.#resources.retain(retained);
  }

  close(): Promise<void> {
    this.#closed = true;
    this.#controller.abort(new Error("Verifier command owner closed"));
    if (this.#closing !== undefined) return this.#closing;
    let attempt: Promise<void>;
    attempt = this.#resources
      .close()
      .then(() => {
        this.#released = true;
      })
      .catch((cause: unknown) => {
        if (this.#closing === attempt) this.#closing = undefined;
        throw cause;
      });
    this.#closing = attempt;
    return attempt;
  }
}

/** Allocate command ownership without acquiring or deleting an evidence root. */
export async function createVerifierCommands({
  launcher = launchVerifierCommand,
}: VerifierCommandsOptions = {}): Promise<VerifierCommands> {
  return new VerifierCommandOwner(launcher);
}
