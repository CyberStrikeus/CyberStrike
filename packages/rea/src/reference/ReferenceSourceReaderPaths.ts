import { relative, sep } from "node:path";

import { isPathWithinRoot } from "../domain/localPath.js";

export const pathFromRoot = (root: string, path: string): string => {
  const value = relative(root, path);
  return isPathWithinRoot(root, path)
    ? value.split(sep).join("/") || "."
    : "<outside-root>";
};
