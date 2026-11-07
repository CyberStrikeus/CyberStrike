import { posix } from "node:path";
import type { JavaScriptArtifactFileKind } from "./javascriptArtifactFiles.js";

/** JSON dispatch uses the exact loader filename, not the inventory's folded kind. */
export const isJsonModuleTarget = (
  path: string,
  kind: JavaScriptArtifactFileKind | undefined,
): boolean =>
  path.endsWith(".json") && (kind === "json" || kind === "package-json");

/** Native-addon dispatch likewise needs the exact `.node` loader suffix. */
export const isNativeAddonModuleTarget = (
  path: string,
  kind: JavaScriptArtifactFileKind | undefined,
): boolean => path.endsWith(".node") && kind === "native-addon";

/** Loader evidence retained for a source-level module reference. */
export type JavaScriptModuleResolutionMode =
  | "import"
  | "require"
  | "compiler-dependent";

/** Derive source mode only when syntax or an explicit source format owns it. */
export const moduleResolutionModeForJavaScriptReference = (
  sourcePath: string,
  referenceKind: "static-import" | "dynamic-import" | "require",
  explicitMode?: JavaScriptModuleResolutionMode,
): JavaScriptModuleResolutionMode => {
  if (explicitMode !== undefined) return explicitMode;
  if (referenceKind === "require") return "require";
  if (referenceKind === "dynamic-import") return "import";
  const extension = posix.extname(sourcePath).toLowerCase();
  if (extension === ".cjs" || extension === ".cts") return "require";
  if (extension === ".mts") return "import";
  if (extension === ".ts" || extension === ".tsx") return "compiler-dependent";
  return "import";
};
