import { regularFileCancellation } from "../filesystem/OwnedRegularFile.js";
import { mkdtemp, realpath, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Readable } from "node:stream";

import type { ArtifactCommand } from "../domain/artifactGraph.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { DirectoryArtifactReader } from "./DirectoryArtifactReader.js";
import {
  NonRegularFileReadError,
  RegularFileAdmissionFailure,
  openRegularFile,
} from "../filesystem/RegularFile.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import {
  ExecFileOutputCancelledError,
  execFileOutput,
  execFileOutputFailure,
} from "../process/ExecFileOutput.js";
import {
  parseNativeDmgAttachOutput,
  parseNativeDmgInfo,
  resolveNativeDmgOwnership,
  type NativeDmgAttachOutput,
  type NativeDmgInfo,
} from "./NativeDmgOwnership.js";
const HDIUTIL_COMMAND_TIMEOUT_MS = 120_000;
/** Conditional recovery guidance; a path match never grants attachment ownership. */
export const DMG_EXISTING_ATTACHMENT_RECOVERY =
  "hdiutil refused a private read-only DMG attachment after listing an existing attachment of this image path. If it is still attached, ask its owner to release it when safe, then retry. REA does not borrow or detach existing attachments.";
const DMG_CHECKSUM_ABSENT_LIMITATION =
  "hdiutil verify found no stored checksum in this disk image, so its integrity was not verified; the root SHA-256 identifies the inventoried bytes.";
const VERIFY_SETTLE_DELAYS_MS = [250, 500] as const;
// APFS ejects and busy reporting can lag a detach attempt.
const DETACH_SETTLE_DELAYS_MS = [250, 500, 1000] as const;
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
/** Narrow host seam for tested, shell-free hdiutil lifecycle operations. */
export interface NativeDmgHost {
  run(
    arguments_: readonly string[],
    signal?: AbortSignal,
    options?: { readonly timeoutMs: number },
  ): Promise<{
    readonly stdout: string;
    readonly stderr?: string;
    readonly exitCode: number;
    readonly cause?: unknown;
  }>;
  /** Wait between detach rechecks; tests may resolve immediately. */
  delay?(milliseconds: number): Promise<void>;
}

interface NativeDmgFailureClassification {
  readonly reason: ArtifactReaderFailure["reason"];
  readonly verifyDiagnostic?: string;
  /**
   * hdiutil could not recognize the target, for a reason it reported only in
   * localized text; the cause stays unknown unless the target cannot be opened.
   */
  readonly unrecognizedImage?: boolean;
  /** hdiutil found no stored checksum, so verification neither passed nor failed. */
  readonly checksumAbsent?: boolean;
}

class NativeDmgCommandFailure extends ArtifactReaderFailure {
  readonly processNotStarted: boolean;
  readonly verifyDiagnostic: string | undefined;
  readonly unrecognizedImage: boolean;
  readonly checksumAbsent: boolean;
  readonly exitCode: number | null;

  constructor(
    failure: NativeDmgFailureClassification,
    message: string,
    readonly stdout: string,
    options?: {
      readonly cause?: unknown;
      readonly cancellation?: { readonly reason: unknown };
      readonly processNotStarted?: boolean;
      readonly exitCode?: number;
    },
  ) {
    super(
      failure.reason,
      message,
      options === undefined
        ? undefined
        : {
            ...(options.cause === undefined ? {} : { cause: options.cause }),
            ...(options.cancellation === undefined
              ? {}
              : { cancellation: options.cancellation }),
          },
    );
    this.processNotStarted = options?.processNotStarted ?? false;
    this.verifyDiagnostic = failure.verifyDiagnostic;
    this.unrecognizedImage = failure.unrecognizedImage ?? false;
    this.checksumAbsent = failure.checksumAbsent ?? false;
    this.exitCode = options?.exitCode ?? null;
  }
}

const createSystemHost = (
  environment: Readonly<NodeJS.ProcessEnv>,
): NativeDmgHost => ({
  delay,
  async run(arguments_, signal, options) {
    try {
      const { stdout, stderr } = await execFileOutput(
        "/usr/bin/hdiutil",
        [...arguments_],
        {
          env: environment,
          stopSignal: "SIGTERM",
          ...(options === undefined ? {} : { timeout: options.timeoutMs }),
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (cause: unknown) {
      const output = execFileOutputFailure(cause);
      if (cause instanceof ExecFileOutputCancelledError)
        throw new NativeDmgCommandFailure(
          { reason: "cancelled" },
          "DMG operation cancelled",
          output?.stdout ?? "",
          { cause, cancellation: { reason: cause.cause } },
        );
      const exitCode =
        typeof output?.code === "number" ? output.code : processExitCode(cause);
      if (exitCode !== undefined)
        return {
          stdout: output?.stdout ?? processOutput(cause, "stdout"),
          stderr: output?.stderr ?? processOutput(cause, "stderr"),
          exitCode,
          cause,
        };
      throw new NativeDmgCommandFailure(
        classifyCommandFailure(cause, arguments_[0]),
        `hdiutil ${arguments_[0] ?? "operation"} failed: ${describeCommandFailure(cause, arguments_)}`,
        output?.stdout ?? "",
        { cause, processNotStarted: processNotStarted(cause) },
      );
    }
  },
});

/** Read-only macOS DMG adapter that owns attachment and reverse-order detach. */
export class NativeDmgArtifactReader implements ArtifactReader {
  readonly format = "file" as const;
  private readonly host: NativeDmgHost;
  readonly #provenance: ArtifactCommand[] = [];
  #initialization: Promise<void> | undefined;
  #directory: DirectoryArtifactReader | undefined;
  #devices: string[] = [];
  #inventoryConfirmedDevices = new Set<string>();
  #mountRoot: string | undefined;
  #baselineDevices = new Set<string>();
  #attachOutput: NativeDmgAttachOutput | undefined;
  #attachOutputReturned = false;
  #attachMayHaveMounted = false;
  #ownershipUncertainty: string | undefined;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  readonly #activeDirectoryOperations = new Set<Promise<unknown>>();
  #verificationProbeHandle: OwnedFileHandle | undefined;
  #checksumAbsent = false;

  constructor(
    private readonly path: string,
    environment: Readonly<NodeJS.ProcessEnv>,
    host?: NativeDmgHost,
  ) {
    if (process.platform !== "darwin" && host === undefined)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Native DMG traversal is available only on macOS",
      );
    this.host = host ?? createSystemHost(environment);
  }

  async *entries(
    signal?: AbortSignal,
    options?: ArtifactTraversalOptions,
  ): AsyncIterable<ArtifactEntry> {
    await this.#ensureAttached(signal);
    const directory = this.#directory;
    if (directory === undefined)
      throw new ArtifactReaderFailure("unavailable", "DMG is not attached");
    if (this.#checksumAbsent)
      options?.onCoverage?.({
        status: "complete",
        limitations: [DMG_CHECKSUM_ABSENT_LIMITATION],
      });
    const prefix = basename(this.path);
    const entries = directory
      .entries(signal, {
        onCoverage: (coverage) => options?.onCoverage?.(coverage),
        onOmission: (omission) =>
          options?.onOmission?.({
            ...omission,
            path: `${prefix}/${omission.path}`,
          }),
      })
      [Symbol.asyncIterator]();
    try {
      for (;;) {
        if (this.#closed) return;
        const next = await this.#trackDirectoryOperation(() => entries.next());
        if (this.#closed) return;
        if (next.done) return;
        yield { ...next.value, path: `${prefix}/${next.value.path}` };
      }
    } finally {
      await entries.return?.();
    }
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    await this.#ensureAttached(signal);
    const directory = this.#directory;
    if (directory === undefined)
      throw new ArtifactReaderFailure("unavailable", "DMG is not attached");
    return this.#trackDirectoryOperation(() => directory.open(entry, signal));
  }

  provenance(): readonly ArtifactCommand[] {
    return structuredClone(this.#provenance);
  }

  close(): Promise<void> {
    this.#closed = true;
    this.#closePromise ??= this.#closeOwnedResources().catch(
      (cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      },
    );
    return this.#closePromise;
  }

  async #closeOwnedResources(): Promise<void> {
    await this.#initialization?.catch(() => undefined);
    await Promise.allSettled(this.#activeDirectoryOperations);
    await this.#closeVerificationProbeHandle();
    await this.#closeMountedDirectory();
    let detachFailure = await this.#detachOwnedDevices();
    if (
      this.#devices.length === 0 &&
      this.#mountRoot !== undefined &&
      !this.#attachMayHaveMounted
    )
      await rm(this.#mountRoot, { recursive: true, force: true }).then(
        () => {
          this.#mountRoot = undefined;
          this.#directory = undefined;
        },
        (cause: unknown) => {
          detachFailure ??= cause;
        },
      );
    if (this.#attachMayHaveMounted) {
      detachFailure ??= new Error(
        this.#ownershipUncertainty ??
          "hdiutil attachment ownership remains unknown",
      );
    }
    if (detachFailure !== undefined)
      throw new ArtifactReaderFailure(
        "unavailable",
        `DMG detach or mount-root cleanup failed for ${JSON.stringify(this.path)}: ${failureMessage(detachFailure)}`,
        {
          cause: detachFailure,
          cleanup: {
            reason: failureMessage(detachFailure),
            resources: [
              ...this.#devices.map((device) => `DMG device ${device}`),
              ...(this.#attachMayHaveMounted
                ? [
                    `DMG attachment ownership unknown at mount root ${this.#mountRoot ?? this.path}`,
                  ]
                : []),
              ...(this.#mountRoot === undefined
                ? []
                : [`DMG mount root ${this.#mountRoot}`]),
            ],
          },
        },
      );
  }

  async #closeVerificationProbeHandle(): Promise<void> {
    const owner = this.#verificationProbeHandle;
    if (owner === undefined) return;
    try {
      await owner.close();
      this.#verificationProbeHandle = undefined;
    } catch (cause: unknown) {
      throw ArtifactReaderFailure.withCleanup(
        cause,
        ArtifactReaderFailure.cleanupObservation(
          cause,
          `DMG verification target descriptor ${this.path}`,
        ),
      );
    }
  }

  async #detachOwnedDevices(): Promise<unknown> {
    let detachFailure = await this.#reconcileAttachState();
    let remainingDevices: string[] = [];
    for (const device of [...this.#devices].reverse()) {
      const failure = await this.#detach(device);
      if (failure !== undefined) {
        remainingDevices.push(device);
        detachFailure ??= failure;
      }
    }
    // APFS container detach may briefly leave its backing image listed.
    for (const delayMs of DETACH_SETTLE_DELAYS_MS) {
      if (remainingDevices.length === 0) break;
      await (this.host.delay ?? delay)(delayMs);
      const stillAttached: string[] = [];
      for (const device of remainingDevices) {
        if (!(await this.#isAttached(device))) continue;
        const failure = await this.#detach(device);
        if (failure !== undefined) {
          stillAttached.push(device);
          detachFailure = failure;
        }
      }
      remainingDevices = stillAttached;
    }
    if (remainingDevices.length === 0) detachFailure = undefined;
    this.#devices = remainingDevices.reverse();
    return detachFailure;
  }

  async #closeMountedDirectory(): Promise<void> {
    if (this.#directory !== undefined) {
      try {
        await this.#directory.close();
        this.#directory = undefined;
      } catch (cause: unknown) {
        const mountRoot = this.#mountRoot ?? this.path;
        throw ArtifactReaderFailure.withCleanup(cause, {
          reason: `DMG mounted directory remains owned: ${failureMessage(cause)}`,
          resources: [
            `DMG mounted directory at ${mountRoot}`,
            `DMG mount root ${mountRoot}`,
            ...this.#devices.map((device) => `DMG device ${device}`),
          ],
        });
      }
    }
  }

  /** Detach one device; return the failure only while it remains attached. */
  async #detach(device: string): Promise<unknown> {
    try {
      await runChecked(this.host, ["detach", device], undefined, {
        timeoutMs: HDIUTIL_COMMAND_TIMEOUT_MS,
      });
      this.#provenance.push(command(["detach", device], ["mount"]));
      return undefined;
    } catch (cause: unknown) {
      return (await this.#isAttached(device)) ? cause : undefined;
    }
  }

  async #reconcileAttachState(): Promise<unknown> {
    if (!this.#attachMayHaveMounted) return undefined;
    try {
      await this.#resolveAttachOwnership();
      return undefined;
    } catch (cause: unknown) {
      this.#ownershipUncertainty = failureMessage(cause);
      return cause;
    }
  }

  /** Treat unknown hdiutil state as attached during cleanup. */
  async #isAttached(device: string): Promise<boolean> {
    try {
      const parsed = await this.#readInfo();
      const isListed = parsed.images.some((image) =>
        image["system-entities"].some(
          (entity) => entity["dev-entry"] === device,
        ),
      );
      if (isListed) {
        this.#inventoryConfirmedDevices.add(device);
        return true;
      }
      return !this.#inventoryConfirmedDevices.has(device);
    } catch {
      return true;
    }
  }

  async #ensureAttached(signal?: AbortSignal): Promise<void> {
    if (this.#closed)
      throw new ArtifactReaderFailure("unavailable", "DMG reader is closed");
    this.#initialization ??= this.#attach(signal);
    await this.#initialization;
    if (this.#closed)
      throw new ArtifactReaderFailure("unavailable", "DMG reader is closed");
  }

  async #trackDirectoryOperation<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.#closed)
      throw new ArtifactReaderFailure("unavailable", "DMG reader is closed");
    const running = Promise.resolve().then(operation);
    this.#activeDirectoryOperations.add(running);
    try {
      return await running;
    } finally {
      this.#activeDirectoryOperations.delete(running);
    }
  }

  async #attach(signal?: AbortSignal): Promise<void> {
    await this.#verify(signal);
    const baseline = await this.#readInfo();
    this.#baselineDevices = new Set(
      baseline.images.flatMap((image) =>
        image["system-entities"].map(({ "dev-entry": device }) => device),
      ),
    );
    const mountRoot = await realpath(await mkdtemp(join(tmpdir(), "rea-dmg-")));
    this.#mountRoot = mountRoot;
    const arguments_ = [
      "attach",
      "-readonly",
      "-nobrowse",
      "-plist",
      "-mountroot",
      mountRoot,
      this.path,
    ];
    try {
      this.#attachMayHaveMounted = true;
      const attached = await runChecked(this.host, arguments_, signal, {
        timeoutMs: HDIUTIL_COMMAND_TIMEOUT_MS,
      });
      this.#provenance.push(command(arguments_, ["read", "mount"]));
      this.#attachOutputReturned = true;
      let parsed: NativeDmgAttachOutput;
      try {
        parsed = parseNativeDmgAttachOutput(attached.stdout);
      } catch (cause: unknown) {
        throw new ArtifactReaderFailure(
          "format",
          "hdiutil returned a malformed attachment plist",
          { cause },
        );
      }
      if (parsed["system-entities"].length === 0)
        throw new ArtifactReaderFailure(
          "format",
          "hdiutil returned no attached devices",
        );
      this.#attachOutput = parsed;
      const ownership = await this.#resolveAttachOwnership();
      if (ownership !== "owned")
        throw new ArtifactReaderFailure(
          ownership === "unknown" ? "unavailable" : "path",
          ownership === "unknown"
            ? `DMG attachment ownership is uncertain: ${this.#ownershipUncertainty ?? "no unique mount under the owned root"}`
            : "hdiutil did not mount a new image beneath the owned root",
        );
      this.#directory = new DirectoryArtifactReader(mountRoot);
    } catch (cause: unknown) {
      if (cause instanceof NativeDmgCommandFailure)
        this.#provenance.push(
          command(arguments_, ["read", "mount"], cause.exitCode),
        );
      if (cause instanceof NativeDmgCommandFailure && cause.stdout !== "") {
        try {
          this.#attachOutput = parseNativeDmgAttachOutput(cause.stdout);
          this.#attachOutputReturned = true;
        } catch {
          // The original command failure remains primary; fresh info still recovers mounts.
        }
      }
      if (cause instanceof NativeDmgCommandFailure && cause.processNotStarted) {
        this.#attachMayHaveMounted = false;
        this.#ownershipUncertainty = undefined;
      }
      if (
        cause instanceof NativeDmgCommandFailure &&
        cause.reason === "unavailable" &&
        cause.exitCode !== null &&
        (await existingImagePathListed(this.path, baseline))
      )
        throw new ArtifactReaderFailure("unavailable", cause.message, {
          cause,
          userMessage: DMG_EXISTING_ATTACHMENT_RECOVERY,
        });
      throw cause;
    }
  }

  async #verify(signal?: AbortSignal): Promise<void> {
    const arguments_ = ["verify", this.path];
    const deadline = performance.now() + HDIUTIL_COMMAND_TIMEOUT_MS;
    for (let attempt = 0; ; attempt += 1) {
      this.#throwIfVerificationCancelled(signal);
      try {
        await runChecked(this.host, arguments_, signal, {
          timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())),
        });
        this.#provenance.push(command(arguments_, ["read"]));
        return;
      } catch (cause: unknown) {
        if (!(cause instanceof NativeDmgCommandFailure)) throw cause;
        this.#provenance.push(command(arguments_, ["read"], cause.exitCode));
        // No stored checksum (e.g. raw UDRW): attach with integrity unverified.
        if (cause.checksumAbsent) {
          this.#checksumAbsent = true;
          return;
        }
        if (cause.unrecognizedImage) {
          const unreadable = await this.#isUnreadableTarget(signal, cause);
          this.#throwIfVerificationCancelled(signal);
          if (unreadable)
            throw new NativeDmgCommandFailure(
              { reason: "io" },
              cause.message,
              cause.stdout,
              {
                cause: cause.cause,
                ...(cause.exitCode === null
                  ? {}
                  : { exitCode: cause.exitCode }),
              },
            );
        }
        const delayMs = VERIFY_SETTLE_DELAYS_MS[attempt];
        // Retry only the producer's explicit transient diagnostic, or a localized
        // refusal of a readable target that may be the same, before any mount.
        if (
          (cause.verifyDiagnostic !== "Resource temporarily unavailable" &&
            !cause.unrecognizedImage) ||
          delayMs === undefined ||
          deadline - performance.now() <= delayMs
        )
          throw cause;
        await (this.host.delay ?? delay)(delayMs);
        if (performance.now() >= deadline) throw cause;
      }
    }
  }

  async #readInfo(): Promise<NativeDmgInfo> {
    const info = await runChecked(this.host, ["info", "-plist"], undefined, {
      timeoutMs: HDIUTIL_COMMAND_TIMEOUT_MS,
    });
    try {
      return parseNativeDmgInfo(info.stdout);
    } catch (cause: unknown) {
      throw new ArtifactReaderFailure(
        "format",
        "hdiutil info -plist returned malformed image inventory",
        { cause },
      );
    }
  }

  async #resolveAttachOwnership(): Promise<"owned" | "none" | "unknown"> {
    const mountRoot = this.#mountRoot;
    if (mountRoot === undefined)
      throw new Error("DMG mount root is unavailable for ownership discovery");
    const ownership = resolveNativeDmgOwnership({
      info: await this.#readInfo(),
      ...(this.#attachOutput === undefined
        ? {}
        : { attachOutput: this.#attachOutput }),
      attachOutputReturned: this.#attachOutputReturned,
      mountRoot,
      baselineDevices: this.#baselineDevices,
    });
    if (ownership.status === "owned") {
      this.#devices = [...ownership.devices];
      if (ownership.source === "info")
        for (const device of ownership.devices)
          this.#inventoryConfirmedDevices.add(device);
      this.#attachMayHaveMounted = false;
      this.#ownershipUncertainty = undefined;
      return "owned";
    }
    if (ownership.status === "unknown") {
      this.#ownershipUncertainty = ownership.reason;
      return "unknown";
    }
    this.#attachMayHaveMounted = false;
    this.#ownershipUncertainty = undefined;
    this.#devices = [];
    return "none";
  }

  #cancelledVerification(cause: unknown): NativeDmgCommandFailure {
    return new NativeDmgCommandFailure(
      { reason: "cancelled" },
      "DMG operation cancelled",
      "",
      { cause },
    );
  }

  #throwIfVerificationCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true)
      throw this.#cancelledVerification(signal.reason);
  }

  async #isUnreadableTarget(
    signal: AbortSignal | undefined,
    primaryFailure: NativeDmgCommandFailure,
  ): Promise<boolean> {
    let handle: FileHandle;
    try {
      ({ handle } = await openRegularFile(this.path, {
        symlinks: "follow",
        ...(signal === undefined ? {} : { signal }),
      }));
    } catch (cause: unknown) {
      if (cause instanceof RegularFileAdmissionFailure) {
        this.#verificationProbeHandle = cause.owner;
        const cancellation = regularFileCancellation(cause.cause);
        const failure =
          cancellation === undefined
            ? primaryFailure
            : this.#cancelledVerification(cancellation.reason);
        throw ArtifactReaderFailure.withCleanup(
          failure,
          ArtifactReaderFailure.cleanupObservation(
            cause.cleanupCause,
            `DMG verification target descriptor ${this.path}`,
          ),
        );
      }
      const cancellation = regularFileCancellation(cause);
      if (cancellation !== undefined)
        throw this.#cancelledVerification(cancellation.reason);
      if (cause instanceof NonRegularFileReadError) return false;
      return classifyCommandFailure(cause, undefined).reason === "io";
    }

    const owner = new OwnedFileHandle(handle);
    this.#verificationProbeHandle = owner;
    try {
      await owner.close();
      this.#verificationProbeHandle = undefined;
    } catch (cause: unknown) {
      throw ArtifactReaderFailure.withCleanup(
        signal?.aborted === true
          ? this.#cancelledVerification(signal.reason)
          : primaryFailure,
        ArtifactReaderFailure.cleanupObservation(
          cause,
          `DMG verification target descriptor ${this.path}`,
        ),
      );
    }
    if (signal?.aborted === true)
      throw this.#cancelledVerification(signal.reason);
    return false;
  }
}

/** A path match supports recovery advice, never attachment ownership or byte identity. */
const existingImagePathListed = async (
  path: string,
  info: NativeDmgInfo,
): Promise<boolean> => {
  let target: string;
  try {
    target = await realpath(path);
  } catch {
    return false;
  }
  for (const image of info.images) {
    if (
      image["image-path"] === undefined ||
      image["system-entities"].length === 0
    )
      continue;
    try {
      if ((await realpath(image["image-path"])) === target) return true;
    } catch {
      // An unresolved path does not identify this image; keep checking other entries.
    }
  }
  return false;
};

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const processNotStarted = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) return false;
  const syscall = Reflect.get(cause, "syscall");
  const code = Reflect.get(cause, "code");
  const errno = Reflect.get(cause, "errno");
  return (
    typeof syscall === "string" &&
    syscall.startsWith("spawn ") &&
    (typeof code === "string" ||
      typeof code === "number" ||
      typeof errno === "number")
  );
};

const runChecked = async (
  host: NativeDmgHost,
  arguments_: readonly string[],
  signal?: AbortSignal,
  options?: { readonly timeoutMs: number },
): Promise<{ readonly stdout: string; readonly exitCode: 0 }> => {
  let result: Awaited<ReturnType<NativeDmgHost["run"]>>;
  try {
    result = await host.run(arguments_, signal, options);
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    if (cause instanceof ExecFileOutputCancelledError)
      throw new NativeDmgCommandFailure(
        { reason: "cancelled" },
        "DMG operation cancelled",
        execFileOutputFailure(cause)?.stdout ?? "",
        { cause, cancellation: { reason: cause.cause } },
      );
    const output = execFileOutputFailure(cause);
    throw new NativeDmgCommandFailure(
      classifyCommandFailure(cause, arguments_[0]),
      `hdiutil ${arguments_[0] ?? "operation"} failed: ${describeCommandFailure(
        cause,
        arguments_,
      )}`,
      output?.stdout ?? "",
      { cause, processNotStarted: processNotStarted(cause) },
    );
  }
  if (result.exitCode !== 0) {
    const failure = {
      command: "/usr/bin/hdiutil",
      exitCode: result.exitCode,
      ...(result.cause === undefined
        ? {}
        : { code: processExitCode(result.cause) }),
      stdout: result.stdout,
      ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
    };
    const classification = classifyCommandFailure(failure, arguments_[0]);
    const details = describeCommandFailure(failure, arguments_);
    const unknownVerifyFailure =
      arguments_[0] === "verify" && classification.reason === "unavailable";
    throw new NativeDmgCommandFailure(
      classification,
      unknownVerifyFailure
        ? `hdiutil verify failed; captured diagnostics do not establish the failure cause: ${details}`
        : `hdiutil ${arguments_[0] ?? "operation"} failed: ${details}`,
      result.stdout,
      { cause: result.cause ?? failure, exitCode: result.exitCode },
    );
  }
  return { stdout: result.stdout, exitCode: 0 };
};

const describeCommandFailure = (
  cause: unknown,
  arguments_: readonly string[],
): string => {
  const fields: Record<string, string | number | readonly string[]> = {
    command: "/usr/bin/hdiutil",
    arguments: [...arguments_],
  };
  if (typeof cause === "object" && cause !== null) {
    for (const key of [
      "code",
      "exitCode",
      "errno",
      "syscall",
      "signal",
      "stdout",
      "stderr",
    ] as const) {
      const value = Reflect.get(cause, key);
      if (typeof value === "string" || typeof value === "number")
        fields[key] = value;
    }
    const code = Reflect.get(cause, "code");
    if (typeof code === "number") fields.exitCode = code;
  }
  if (cause instanceof ArtifactReaderFailure) fields.message = cause.message;
  else if (cause instanceof Error) fields.message = cause.message;
  return JSON.stringify(fields);
};

const processExitCode = (cause: unknown): number | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const exitCode = Reflect.get(cause, "exitCode");
  if (typeof exitCode === "number") return exitCode;
  const code = Reflect.get(cause, "code");
  return typeof code === "number" ? code : undefined;
};

const processOutput = (cause: unknown, field: "stdout" | "stderr"): string => {
  if (typeof cause !== "object" || cause === null) return "";
  const value = Reflect.get(cause, field);
  return typeof value === "string" ? value : "";
};

const classifyCommandFailure = (
  cause: unknown,
  operation: string | undefined,
): NativeDmgFailureClassification => {
  if (typeof cause !== "object" || cause === null)
    return { reason: "unavailable" };
  const code = Reflect.get(cause, "code");
  const exitCode = Reflect.get(cause, "exitCode");
  if (typeof code === "number" || typeof exitCode === "number") {
    if (operation !== "verify") return { reason: "unavailable" };
    return classifyVerifyFailure(
      processOutput(cause, "stdout"),
      processOutput(cause, "stderr"),
    );
  }
  if (code === "ENOENT") {
    const syscall = Reflect.get(cause, "syscall");
    return {
      reason:
        typeof syscall === "string" && syscall.startsWith("spawn")
          ? "unavailable"
          : "io",
    };
  }
  if (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EIO" ||
    code === "ENOTDIR" ||
    code === "EISDIR" ||
    code === "ENODEV" ||
    code === "EROFS" ||
    code === "EMFILE" ||
    code === "ENFILE"
  )
    return { reason: "io" };
  return { reason: "unavailable" };
};

const classifyVerifyFailure = (
  stdout: string,
  stderr: string,
): NativeDmgFailureClassification => {
  const diagnostic = verifyFailureDiagnostic(stdout, stderr);
  const reason = verifyFailureReason(diagnostic);
  const untranslated =
    reason === undefined
      ? untranslatedVerifyFailure(stdout, stderr)
      : undefined;
  return {
    ...untranslated,
    reason: reason ?? untranslated?.reason ?? "unavailable",
    ...(diagnostic === undefined ? {} : { verifyDiagnostic: diagnostic }),
  };
};

const verifyFailureReason = (
  diagnostic: string | undefined,
): ArtifactReaderFailure["reason"] | undefined => {
  switch (diagnostic) {
    // hdiutil follows AppleLanguages, so en-GB and en-AU spell it "recognised".
    case "image not recognized":
    case "image not recognised":
      return "format";
    case "invalid checksum":
    case "image data corrupted":
      return "integrity";
    case "No such file or directory":
    case "Permission denied":
    case "Input/output error":
      return "io";
    case "Resource temporarily unavailable":
      return "unavailable";
    default:
      return undefined;
  }
};

const verifyFailureDiagnostic = (
  stdout: string,
  stderr: string,
): string | undefined => {
  const prefix = "hdiutil: verify failed - ";
  return outputLines(stdout, stderr)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
};

// hdiutil localizes the trailing failure reason but not its own status lines.
const INVALID_CHECKSUM_LINE = /^hdiutil: verify: checksum of ".*" is INVALID$/u;
const NO_CHECKSUM_LINE = /^hdiutil: verify: ".*" has no checksum\.$/u;
const UNRECOGNIZED_IMAGE_LINE =
  /^hdiutil: verify: unable to recognize ".*" as a disk image\./u;

const untranslatedVerifyFailure = (
  stdout: string,
  stderr: string,
): NativeDmgFailureClassification | undefined => {
  const lines = outputLines(stdout, stderr);
  if (lines.some((line) => INVALID_CHECKSUM_LINE.test(line)))
    return { reason: "integrity" };
  if (lines.some((line) => NO_CHECKSUM_LINE.test(line)))
    return { reason: "unavailable", checksumAbsent: true };
  // Malformed, unreadable and transiently busy targets all produce this line;
  // only the localized reason distinguishes them, so the cause stays unknown.
  if (lines.some((line) => UNRECOGNIZED_IMAGE_LINE.test(line)))
    return { reason: "unavailable", unrecognizedImage: true };
  return undefined;
};

const outputLines = (stdout: string, stderr: string): string[] =>
  `${stdout}\n${stderr}`.split(/\r?\n/u).map((line) => line.trim());

const command = (
  arguments_: readonly string[],
  effects: ArtifactCommand["effects"],
  exitCode: number | null = 0,
): ArtifactCommand => ({
  tool: "/usr/bin/hdiutil",
  arguments: [...arguments_],
  tool_version: null,
  executable_sha256: null,
  exit_code: exitCode,
  effects,
});
