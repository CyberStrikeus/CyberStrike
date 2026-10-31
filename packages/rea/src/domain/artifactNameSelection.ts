import { zipPackageFormatForPath } from "./zipPackageFormat.js";

/** Name-selected root formats; callers establish byte-signature precedence first. */
export const namedArtifactFormat = (
  path: string,
): "asar" | "plist" | "source-map" | "javascript" | undefined => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".asar")) return "asar";
  if (lower.endsWith(".plist")) return "plist";
  if (lower.endsWith(".map")) return "source-map";
  return /\.(?:m?js|cjs)$/u.test(lower) ? "javascript" : undefined;
};

/**
 * A recognized selected artifact name supplies format hints. Unknown aliases
 * retain the canonical name's hints; neither spelling changes packed I/O.
 */
export const artifactNameForClassification = (
  selectedPath: string,
  canonicalPath: string,
): string =>
  namedArtifactFormat(selectedPath) !== undefined ||
  zipPackageFormatForPath(selectedPath) !== undefined ||
  /\.(?:app|pkg|dmg)$/iu.test(selectedPath)
    ? selectedPath
    : canonicalPath;
