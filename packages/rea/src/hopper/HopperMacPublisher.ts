import { HOPPER_PUBLISHER } from "../domain/hopperPublisher.js";
import { macDeveloperIdRequirement } from "../process/MacCodeSignature.js";
import { execFileOutput } from "../process/ExecFileOutput.js";

/** Failure or unavailable verification leaves custom/native provenance unknown. */
export const verifyMacHopperNativeHelper = async (
  launcherPath: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
): Promise<"verified" | "unknown"> => {
  // codesign treats a bare name as a local file, while spawn searches PATH.
  // Without an explicit path they need not identify the same executable.
  if (!launcherPath.includes("/")) return "unknown";
  try {
    await execFileOutput(
      "/usr/bin/codesign",
      [
        "--verify",
        "--strict",
        `-R${macDeveloperIdRequirement("hopper", HOPPER_PUBLISHER.teamIdentifier)}`,
        launcherPath,
      ],
      {
        env: environment,
        ...(signal === undefined ? {} : { signal }),
        timeout: 5_000,
        stopSignal: "SIGKILL",
      },
    );
    return "verified";
  } catch (cause: unknown) {
    // Optional provenance: a failed check must never authorize lease release.
    void cause;
    return "unknown";
  }
};
