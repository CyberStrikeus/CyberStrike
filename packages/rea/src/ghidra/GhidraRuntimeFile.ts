import { basename, dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { windowsPrivateRuntime } from "../windows/WindowsPrivateRuntime.js";

/** Runtime-owned configuration text: private native handle on Windows, private atomic write on POSIX. */
export const writeGhidraRuntimeFile = async (
  path: string,
  content: string,
  platform: NodeJS.Platform,
): Promise<void> => {
  if (platform === "win32") {
    windowsPrivateRuntime(dirname(path)).writeFile(basename(path), content);
    return;
  }
  await writeFileAtomic(path, content, { encoding: "utf8", mode: 0o600 });
};
