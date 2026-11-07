import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WindowsPrivateRuntime } from "../windows/WindowsPrivateRuntime.js";
import { PrivateRuntimeRootUnavailableError } from "./PrivateRuntimeRootUnavailableError.js";

import {
  windowsNativeCapabilities,
  type WindowsNativeCapability,
} from "./WindowsAuthority.js";

/** Filesystem coordinates for one provider-owned private runtime directory. */
export interface PrivateRuntimeRootOptions {
  readonly parent?: string;
  readonly prefix?: string;
  /** Platform override used by deterministic boundary tests. */
  readonly platform?: NodeJS.Platform;
}

/** Provider-neutral security status for one runtime-root implementation. */
export type PrivateRuntimeRootCapability =
  | WindowsNativeCapability
  | {
      readonly available: true;
      readonly reason: null;
      readonly proof: "posix-mkdtemp-owner-only";
    };

/** Report whether this process can establish a private runtime root. */
export const privateRuntimeRootCapability = (
  platform: NodeJS.Platform = process.platform,
): PrivateRuntimeRootCapability =>
  platform === "win32"
    ? windowsNativeCapabilities(platform).private_runtime_dacl
    : { available: true, reason: null, proof: "posix-mkdtemp-owner-only" };

/**
 * Owns a private temporary runtime root and removes it idempotently.
 *
 * Protocol adapters decide what belongs inside the directory; this primitive
 * establishes a private filesystem boundary on POSIX and deterministic cleanup.
 * Windows privacy requires the separately verified native DACL boundary.
 */
export class PrivateRuntimeRoot {
  #closePromise: Promise<void> | undefined;

  private constructor(
    readonly path: string,
    private readonly windowsRuntime?: WindowsPrivateRuntime,
  ) {}

  /** Allocate a new private runtime root without performing protocol work. */
  static async create(
    options: PrivateRuntimeRootOptions = {},
  ): Promise<PrivateRuntimeRoot> {
    const platform = options.platform ?? process.platform;
    const capability = privateRuntimeRootCapability(platform);
    if (!capability.available)
      throw new PrivateRuntimeRootUnavailableError(capability.reason, {
        retryable: capability.retryable === true,
      });
    if (platform === "win32") {
      const runtime = WindowsPrivateRuntime.create(
        options.parent ?? tmpdir(),
        options.prefix ?? "rea-provider-",
      );
      return new PrivateRuntimeRoot(runtime.observation.path, runtime);
    }
    const selectedParent = options.parent ?? tmpdir();
    // The final dot requires a native directory lookup, preserving the host's
    // failure code and path. An explicitly empty selection remains invalid.
    await stat(selectedParent === "" ? selectedParent : `${selectedParent}/.`);
    // Canonicalize only after native admission so consumers share one physical
    // spelling without collapsing an invalid file/.. traversal on Darwin.
    const parent = await realpath(selectedParent);
    const path = await mkdtemp(join(parent, options.prefix ?? "rea-provider-"));
    // POSIX mkdtemp establishes owner-only access atomically. Return its owner
    // without a fallible permission rewrite and rollback after allocation.
    return new PrivateRuntimeRoot(path);
  }

  /**
   * Remove the runtime root; concurrent callers share one attempt. A failed
   * attempt is not cached, so a later close retries the removal.
   */
  close(): Promise<void> {
    this.#closePromise ??= (
      this.windowsRuntime === undefined
        ? rm(this.path, { recursive: true, force: true })
        : Promise.resolve().then(() => this.windowsRuntime?.close())
    ).catch((cause: unknown) => {
      this.#closePromise = undefined;
      throw cause;
    });
    return this.#closePromise;
  }
}
