import { spawnSync } from "node:child_process";

/**
 * Whether Xcode's ibtool can compile Interface Builder sources on this host.
 * Command Line Tools install the /usr/bin/ibtool and xcrun shims without the
 * tool itself, so probe resolution instead of checking the shim path.
 */
export const xcodeIbtoolAvailable =
  process.platform === "darwin" &&
  spawnSync("/usr/bin/xcrun", ["--find", "ibtool"], { stdio: "ignore" })
    .status === 0;
