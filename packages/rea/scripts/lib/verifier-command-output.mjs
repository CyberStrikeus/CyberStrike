import { writeFile } from "node:fs/promises";

import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Retain available command output without losing command or filesystem failures. */
export async function saveVerifierCommandOutput(operation, paths) {
  let output;
  try {
    output = await operation();
  } catch (cause) {
    const snapshot = cause?.snapshot;
    const stdout = snapshot?.stdout?.text;
    const stderr = snapshot?.stderr?.text;
    return withVerifierCleanup(async () => {
      throw cause;
    }, [
      async () => {
        if (typeof stdout === "string") await writeFile(paths.stdout, stdout);
      },
      async () => {
        if (typeof stderr === "string") await writeFile(paths.stderr, stderr);
      },
    ]);
  }
  await withVerifierCleanup(
    () => writeFile(paths.stdout, output.stdout),
    [() => writeFile(paths.stderr, output.stderr)],
  );
  return output;
}
