import type { UpdateResult } from "./Update.js";

/** Whether the update command left the requested release unapplied. */
export const isUpdateFailure = (result: UpdateResult): boolean => {
  if (result.cleanupFailure !== undefined) return true;
  const status = result.status;
  switch (status) {
    case "current":
    case "updated":
      return false;
    case "failed":
      return true;
    default: {
      const exhaustive: never = status;
      throw new TypeError(
        `Unhandled update result status: ${String(exhaustive)}`,
      );
    }
  }
};
