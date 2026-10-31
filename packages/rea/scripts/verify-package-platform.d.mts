import type { PackageVerifierCommands } from "./lib/package-command-owner.mjs";

/** Validate the expected fail-closed Linux fixture outcome. */
export function assertLinuxPackageProviderFailure(execution: {
  readonly status: number | null;
  readonly stdout: string;
}): void;

/** Run platform-specific packaged analysis checks. */
export function verifyPackagePlatform(input: {
  readonly commands: Pick<PackageVerifierCommands, "run" | "runWithStatus">;
  readonly cli: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform?: string;
}): Promise<void>;
