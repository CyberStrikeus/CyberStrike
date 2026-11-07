import { isAbsolute } from "node:path";
import { appendCallerPath } from "../filesystem/callerPath.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { err, ok, type Result } from "../domain/result.js";
import { HopperReleaseError } from "./HopperReleaseFeed.js";

/** One owner for the selected cache location, shared with the approval plan. */
export const linuxHopperReleaseCacheDirectory = (
  environment: Readonly<NodeJS.ProcessEnv>,
  selectedHome?: string,
): Result<string, HopperReleaseError> => {
  try {
    const supplied = environment.XDG_CACHE_HOME || undefined;
    if (supplied !== undefined && !isAbsolute(supplied))
      return err(
        new HopperReleaseError(
          "verification_unavailable",
          "XDG_CACHE_HOME must be an absolute filesystem path.",
        ),
      );
    return ok(
      appendCallerPath(
        supplied ??
          appendCallerPath(
            selectedHome ?? homeDirectoryFromEnvironment(environment, "linux"),
            ".cache",
          ),
        "rea/hopper-releases",
      ),
    );
  } catch (cause: unknown) {
    return err(
      new HopperReleaseError(
        "verification_unavailable",
        "The Hopper release cache location could not be resolved.",
        { cause },
      ),
    );
  }
};
