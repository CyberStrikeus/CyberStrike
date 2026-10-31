import type { VerifierCommandOutput } from "./verifier-command-owner.mjs";

/** Retain available command output without losing command or filesystem failures. */
export function saveVerifierCommandOutput(
  operation: () => Promise<VerifierCommandOutput>,
  paths: { readonly stdout: string; readonly stderr: string },
): Promise<VerifierCommandOutput>;
