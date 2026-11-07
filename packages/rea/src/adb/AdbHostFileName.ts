/** Why a device-reported path cannot be used as a host file name. */
export type AdbHostFileNameReason =
  | "empty_file_name"
  | "not_absolute_path"
  | "dot_segment"
  | "unsupported_character"
  | "reserved_name"
  | "trailing_dot_or_space";

export type AdbHostFileNameResult =
  | { readonly ok: true; readonly fileName: string }
  | { readonly ok: false; readonly reason: AdbHostFileNameReason };

const WINDOWS_RESERVED_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;

/**
 * Derive the final component of a device POSIX path without normalizing the
 * source. A trailing slash has no filename and must not silently become the
 * preceding component as `basename` would make it.
 */
export const adbHostFileName = (
  devicePath: string,
  platform: NodeJS.Platform = process.platform,
): AdbHostFileNameResult => {
  if (devicePath === "" || devicePath.endsWith("/"))
    return { ok: false, reason: "empty_file_name" };
  if (devicePath.includes("\0"))
    return { ok: false, reason: "unsupported_character" };
  if (!devicePath.startsWith("/"))
    return { ok: false, reason: "not_absolute_path" };
  const fileName = devicePath.slice(devicePath.lastIndexOf("/") + 1);
  if (fileName === "." || fileName === "..")
    return { ok: false, reason: "dot_segment" };
  if (platform === "win32") {
    if (/[\\:*?"<>|]/u.test(fileName) || hasWindowsControl(fileName))
      return { ok: false, reason: "unsupported_character" };
    if (WINDOWS_RESERVED_BASENAME.test(fileName))
      return { ok: false, reason: "reserved_name" };
    if (/[. ]$/u.test(fileName))
      return { ok: false, reason: "trailing_dot_or_space" };
  }

  return { ok: true, fileName };
};

const hasWindowsControl = (fileName: string): boolean => {
  for (const character of fileName) {
    const code = character.codePointAt(0)!;
    if (code > 0 && code < 0x20) return true;
  }
  return false;
};
