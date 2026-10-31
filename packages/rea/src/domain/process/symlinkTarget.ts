import type { FileState } from "./processCapture.js";

/** Old replacement characters cannot establish the target's original bytes. */
export const symlinkTargetIdentity = (
  file: Extract<FileState, { type: "symlink" }>,
): string | null => {
  if (file.symlink_target_hex !== undefined) return file.symlink_target_hex;
  const text = file.symlink_target;
  if (text === null || text.includes("\ufffd")) return null;
  const raw = Buffer.from(text, "utf8");
  return raw.toString("utf8") === text ? raw.toString("hex") : null;
};
