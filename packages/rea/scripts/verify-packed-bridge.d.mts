import type { PackageVerifierCommands } from "./lib/verify-package-commands.mjs";

/** Validate required shipped bridges and parse packed Python without extraction. */
export function verifyPackedBridge(input: {
  readonly tarball: string;
  readonly packedFiles: readonly string[];
  readonly commands: PackageVerifierCommands;
}): Promise<void>;
