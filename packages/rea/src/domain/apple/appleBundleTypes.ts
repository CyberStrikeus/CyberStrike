/** Directory extensions the artifact inventory classifies as Apple bundles. */
export const APPLE_BUNDLE_EXTENSION =
  /\.(?:app|appex|xpc|framework|systemextension|dext|bundle|plugin|qlgenerator|mdimporter)$/iu;

/** Bundle directories that binary routes open through their declared program file. */
export const OPENABLE_APPLE_BUNDLE_EXTENSIONS = [
  ".app",
  ".appex",
  ".framework",
  ".xpc",
  ".systemextension",
  ".bundle",
  ".plugin",
] as const;

export type OpenableAppleBundleExtension =
  (typeof OPENABLE_APPLE_BUNDLE_EXTENSIONS)[number];

/** Select an openable bundle type from a directory extension, ignoring case. */
export const openableAppleBundleExtension = (
  extension: string,
): OpenableAppleBundleExtension | undefined => {
  const lower = extension.toLowerCase();
  return OPENABLE_APPLE_BUNDLE_EXTENSIONS.find(
    (candidate) => candidate === lower,
  );
};

/**
 * Apple bundle directories that binary routes recognize but do not open, so
 * they are refused as unsupported rather than offered another directory route.
 */
const UNOPENED_APPLE_BUNDLE_EXTENSIONS: readonly string[] = [
  ".dext",
  ".kext",
  ".qlgenerator",
  ".mdimporter",
];

/** Whether a directory extension names an Apple bundle type that is not opened. */
export const isUnopenedAppleBundleExtension = (extension: string): boolean =>
  UNOPENED_APPLE_BUNDLE_EXTENSIONS.includes(extension.toLowerCase());

/** Caller-facing list of the bundle directories binary routes open. */
export const OPENABLE_APPLE_BUNDLE_TYPES_TEXT =
  OPENABLE_APPLE_BUNDLE_EXTENSIONS.join(", ");
