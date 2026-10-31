import {
  linuxHopperLauncherCandidates,
  REA_MANAGED_LINUX_HOPPER_LAUNCHER,
} from "./LinuxHopper.js";
import {
  MAC_HOPPER_SYSTEM_LAUNCHER,
  macHopperCanonicalLauncherCandidates,
} from "./MacHopperPaths.js";

/**
 * Where automatic Hopper discovery looks on one platform. Runtime configuration
 * and doctor both read it, so doctor checks the same candidates, in the same
 * order, as CLI/MCP startup.
 */
export interface HopperLauncherDiscovery {
  /** Fixed launcher paths, probed in order. */
  readonly candidates: readonly string[];
  /**
   * Whether renamed `Hopper*.app` bundles are probed after the fixed paths.
   * Doctor also reports the Homebrew cask application only when this is set.
   */
  readonly probesMacApplicationBundles: boolean;
  /** Launcher runtime configures when no candidate is executable. */
  readonly fallback: string;
}

/** Select the automatic Hopper launcher candidates for one platform. */
export const hopperLauncherDiscovery = (
  platform: NodeJS.Platform,
  homeDirectory: string,
): HopperLauncherDiscovery => {
  if (platform === "darwin")
    return {
      candidates: macHopperCanonicalLauncherCandidates(homeDirectory),
      probesMacApplicationBundles: true,
      fallback: MAC_HOPPER_SYSTEM_LAUNCHER,
    };
  if (platform === "linux")
    return {
      candidates: linuxHopperLauncherCandidates(homeDirectory),
      probesMacApplicationBundles: false,
      fallback: REA_MANAGED_LINUX_HOPPER_LAUNCHER,
    };
  return {
    candidates: [],
    probesMacApplicationBundles: false,
    fallback: MAC_HOPPER_SYSTEM_LAUNCHER,
  };
};
