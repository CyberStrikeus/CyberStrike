import { posix } from "node:path";

import type { ArtifactInventoryCoverage } from "../../domain/artifactGraph.js";
import type {
  JavaScriptArtifactFileSet,
  JavaScriptArtifactFile,
} from "../../domain/javascript/javascriptArtifactFiles.js";
import type { NextAppSourceContext } from "../../domain/javascript/javascriptRoutePaths.js";
import { compositeKey } from "../../domain/unicodeCodePointOrder.js";
import type { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";

/** Package declarations and inventoried directories own source-router applicability. */
export const createJavaScriptNextAppContext = (
  fileSet: Pick<
    JavaScriptArtifactFileSet,
    "files" | "unavailable_relevant_files"
  >,
  documents: JavaScriptJsonDocuments,
  directories: ReadonlySet<string>,
  coverage: ArtifactInventoryCoverage,
): ((
  file: Pick<JavaScriptArtifactFile, "path" | "container_sha256">,
) => NextAppSourceContext) => {
  const packages = new Map(
    fileSet.files
      .filter(({ kind }) => kind === "package-json")
      .map((file) => [
        compositeKey([file.container_sha256, posix.dirname(file.path)]),
        file,
      ]),
  );
  const unavailablePackages = new Map(
    fileSet.unavailable_relevant_files
      .filter(({ kind }) => kind === "package-json")
      .map((file) => [
        compositeKey([file.container_sha256, posix.dirname(file.path)]),
        file,
      ]),
  );
  const roots = new Map<JavaScriptArtifactFile, string | null>();
  return (file) => {
    for (
      let directory = posix.dirname(file.path);
      ;
      directory = posix.dirname(directory)
    ) {
      const key = compositeKey([file.container_sha256, directory]);
      const unavailable = unavailablePackages.get(key);
      if (unavailable !== undefined)
        return {
          kind: "unknown",
          package: null,
          reason: `The nearest owning package manifest ${unavailable.path}${unavailable.inventory_occurrence_id === undefined ? "" : ` (inventory occurrence ${unavailable.inventory_occurrence_id})`} is unavailable: ${unavailable.limitations?.join("; ") || "Inventoried package bytes are unavailable."}`,
        };
      const manifest = packages.get(key);
      if (manifest !== undefined) {
        const identity = {
          path: manifest.path,
          sha256: manifest.sha256,
          container_sha256: manifest.container_sha256,
        };
        const facts = documents.read(manifest);
        if (facts.status !== "included" || facts.nextDependency !== "declared")
          return {
            kind: "unknown",
            package: identity,
            reason:
              "The owning package does not establish a Next dependency for source routing.",
          };
        const prefix = directory === "." ? "" : `${directory}/`;
        const compiled = `${prefix}.next/static/chunks/app`;
        if (file.path.startsWith(`${compiled}/`))
          return {
            kind: "compiled-directory",
            directory: compiled,
            package: identity,
          };
        // Selecting src/app requires proving that the higher-priority app is absent.
        if (coverage.status !== "complete" && !directories.has(`${prefix}app`))
          return {
            kind: "unknown",
            package: identity,
            reason:
              "Incomplete artifact traversal does not establish whether the owning package has a higher-priority app directory.",
          };
        let root = roots.get(manifest);
        if (root === undefined) {
          root =
            ["app", "src/app"]
              .map((candidate) => `${prefix}${candidate}`)
              .find((candidate) => directories.has(candidate)) ?? null;
          roots.set(manifest, root);
        }
        return root !== null && file.path.startsWith(`${root}/`)
          ? { kind: "app-directory", directory: root, package: identity }
          : { kind: "outside-app-directory", package: identity };
      }
      if (coverage.status !== "complete")
        return {
          kind: "unknown",
          package: null,
          reason: `Incomplete artifact traversal does not establish whether ${directory === "." ? "" : `${directory}/`}package.json owns this source.`,
        };
      if (directory === "." || directory === "/") break;
    }
    return {
      kind: "unknown",
      package: null,
      reason:
        "No owning package declaration establishes a Next App Router source root.",
    };
  };
};
