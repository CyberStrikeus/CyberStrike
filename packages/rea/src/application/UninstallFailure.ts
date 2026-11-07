import type { UninstallResult } from "./Uninstall.js";

/** Whether any requested REA-owned uninstall action failed. */
export const isUninstallFailure = (result: UninstallResult): boolean => {
  const status = result.status;
  switch (status) {
    case "complete":
      return false;
    case "failed":
      return true;
    default: {
      const exhaustive: never = status;
      throw new TypeError(
        `Unhandled uninstall result status: ${String(exhaustive)}`,
      );
    }
  }
};
