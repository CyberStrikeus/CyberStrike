import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readImportSpecifiers } from "./import-specifiers.mjs";

const PURE_LAYERS = new Set(["domain", "contracts"]);
const MIGRATED_PROVIDER_ROOTS = new Set([
  "sqlite",
  "evm",
  "go",
  "il2cpp",
  "model",
  "gpu",
  "python",
  "rust",
  "wasm",
  "captures",
  "signals",
  "android",
  "firmware",
  "ghidra",
  "hopper",
  "ida",
  "inspector",
  "javascript",
]);
const repositoryPath = (root, path) =>
  relative(root, path).replaceAll("\\", "/");

const sourceTarget = (file, specifier) => {
  if (specifier.startsWith("file:")) return fileURLToPath(specifier);
  if (isAbsolute(specifier)) return resolve(specifier);
  return specifier.startsWith(".")
    ? fileURLToPath(new URL(specifier, pathToFileURL(file)))
    : undefined;
};

const failedBoundary = (file, target) => {
  if (!file.startsWith("src/") || !target.startsWith("src/")) return undefined;
  const layer = file.split("/")[1];
  const targetLayer = target.split("/")[1];
  if (
    file.startsWith("src/process/capture/") &&
    (["application", "composition", "server", "cli", "main"].includes(
      targetLayer,
    ) ||
      /^src\/(?:cli|main)\./u.test(target))
  )
    return "process-capture";
  if (
    file.startsWith("src/application/javascript/") &&
    /^src\/artifacts\/(?:Asar|Directory)ArtifactReader\.(?:js|ts)$/u.test(
      target,
    )
  )
    return "provider-construction";
  if (
    (file.startsWith("src/artifacts/javascript/") ||
      file.startsWith("src/artifacts/apple/") ||
      file.startsWith("src/artifacts/inventory/") ||
      file.startsWith("src/artifacts/extraction/") ||
      /^src\/artifacts\/ArtifactHash\.(?:js|ts)$/u.test(file)) &&
    (["application", "composition", "server", "cli", "main"].includes(
      targetLayer,
    ) ||
      /^src\/(?:cli|main)\./u.test(target))
  )
    return "artifact-acquisition";
  if (PURE_LAYERS.has(layer)) {
    if (
      (/^src\/[^/]+\//u.test(target) && !PURE_LAYERS.has(targetLayer)) ||
      /^src\/(?:cli|main)\./u.test(target)
    )
      return "pure-layer";
  }
  if (layer === "application" && targetLayer === "composition")
    return "application-composition";
  if (
    (layer === "application" || layer === "server") &&
    (MIGRATED_PROVIDER_ROOTS.has(targetLayer) ||
      /^src\/(?:artifacts\/ArtifactProvider|dotnet\/ManagedStaticProvider|native\/NativeMacOSProvider)\.[^/]+$/u.test(
        target,
      ) ||
      /^src\/browser\/[^/]*Provider\.[^/]+$/u.test(target))
  )
    return "provider-construction";
  return undefined;
};

/** Check resolved source ownership, including type imports and reexports. */
export const inspectModuleBoundaries = (file, source, root) => {
  const absoluteFile = resolve(root, file);
  const importer = repositoryPath(root, absoluteFile);
  const violations = [];
  for (const { specifier, line } of readImportSpecifiers(source)) {
    const resolved = sourceTarget(absoluteFile, specifier);
    if (resolved === undefined) continue;
    const target = repositoryPath(root, resolved);
    const boundary = failedBoundary(importer, target);
    if (boundary !== undefined)
      violations.push({ file: importer, line, specifier, target, boundary });
  }
  return violations;
};
