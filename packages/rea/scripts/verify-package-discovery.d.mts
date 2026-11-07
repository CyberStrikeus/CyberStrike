import type { PackageVerifierCommands } from "./lib/package-command-owner.mjs";

/**
 * Host facts the packaged setup support is derived from.
 *
 * `linuxDistribution` is the distribution record the Hopper installer owner
 * parses; it is absent when no distribution could be read, which leaves
 * installer applicability unknown rather than unsupported.
 */
export interface SetupHostFacts {
  readonly platform: NodeJS.Platform;
  readonly linuxDistribution?: {
    readonly hopperSetupSupported: boolean;
  };
}

/**
 * Derive agent setup support from the doctor node check and automated Hopper
 * installer applicability from the facts their owners parse. Applicability is
 * undefined when its owning fact is unavailable. On Linux, Hopper readiness is
 * required only where the automated installer applies.
 */
export function packageSetupSupport(
  checks:
    | readonly { readonly name: string; readonly ok: boolean }[]
    | undefined,
  host: SetupHostFacts,
): {
  supportedSetupHost: boolean;
  hopperReadinessRequired: boolean;
  hopperSetupSupported: boolean | undefined;
};

/** Validate --help, --llms, and doctor output and determine host setup support. */
export function verifyPackageDiscovery(input: {
  readonly commands: Pick<PackageVerifierCommands, "run" | "runWithStatus">;
  readonly cli: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<{
  supportedSetupHost: boolean;
  hopperSetupSupported: boolean | undefined;
}>;
