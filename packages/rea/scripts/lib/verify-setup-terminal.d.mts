import type { VerifierCommands } from "./verifier-command-owner.mjs";

export interface SetupTerminalOptions {
  readonly commands: Pick<VerifierCommands, "adopt">;
  readonly command: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly root: string;
  readonly unchangedPaths: readonly string[];
}

/** Require positive canonical-input and echo observations. */
export function terminalModesRestored(termios: unknown): boolean;

export function verifyInteractiveSetup(
  options: SetupTerminalOptions,
): Promise<void>;
export function verifyRedirectedStdoutSetup(
  options: SetupTerminalOptions,
): Promise<void>;
