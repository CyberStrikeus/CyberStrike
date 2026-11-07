import type { PackageVerifierCommands } from "./lib/package-command-owner.mjs";

/** Validate a live registration and its byte-identical pre-setup backup. */
export function assertClientConfig(
  cli: string,
  configPath: string,
  original: Uint8Array,
): Promise<void>;

/** Verify setup using the parent's explicit command owner. */
export function verifyPackageSetup(input: {
  readonly commands: Pick<
    PackageVerifierCommands,
    "run" | "runWithStatus" | "adopt"
  >;
  readonly cli: string;
  readonly packageRunnerCli: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly home: string;
  readonly npxLog: string;
  readonly claudeConfig: string;
  readonly codexConfig: string;
  readonly cursorConfig: string;
  readonly codexTarget: string;
  readonly cursorTarget: string;
  readonly supportedSetupHost: boolean;
  readonly hopperSetupSupported: boolean | undefined;
  readonly root: string;
}): Promise<void>;
