import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { normalizeArtifactPath } from "../../artifacts/ArtifactPaths.js";
import type { WebScriptArtifactPort } from "../../application/WebScriptArtifactPort.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { isPathWithinRoot } from "../../domain/localPath.js";
import { err, ok } from "../../domain/result.js";
import type { SelectedWebScriptInput } from "../../domain/webScriptArtifacts.js";
import { webScriptExportManifestSchema } from "../../domain/webScriptExport.js";
import {
  decodeWebArtifact,
  WebArtifactAcquisition,
  webArtifactReadError,
  type WebArtifactReadContext,
} from "./WebArtifactReads.js";

/** Read one digest-verified captured source under the manifest's current location. */
export class LocalWebScriptArtifacts implements WebScriptArtifactPort {
  constructor(
    readonly operation: WebArtifactReadContext["operation"],
    readonly resources = new ArtifactResourceScope(),
  ) {}

  close(): Promise<void> {
    return this.resources.close();
  }

  /** Read the selected source; relocated exports retain their reported original root. */
  async load(input: SelectedWebScriptInput, options?: ExecutionOptions) {
    try {
      return await this.resources.run(() => this.#load(input, options));
    } catch (cause: unknown) {
      return err(
        webArtifactReadError(
          cause,
          {
            operation: this.operation,
            field: ["manifest_path"],
            targetPath: input.manifest_path,
            callerSelected: true,
          },
          options?.signal,
        ),
      );
    }
  }

  async #load(input: SelectedWebScriptInput, options?: ExecutionOptions) {
    const acquisition = new WebArtifactAcquisition();
    let field: readonly (string | number)[] = ["manifest_path"];
    let targetPath = input.manifest_path;
    let callerSelected = true;
    try {
      const manifestBytes = await acquisition.readJson(
        "manifest",
        input.manifest_path,
        32 * 1024 * 1024,
        options?.signal,
        this.resources,
      );
      const manifest = webScriptExportManifestSchema.parse(manifestBytes.value);
      acquisition.record(
        "manifest",
        {
          path: input.manifest_path,
          sha256: manifestBytes.sha256,
          bytes: manifestBytes.bytes.length,
        },
        "manifest-validated",
      );
      field = ["script_index"];
      const selected = manifest.scripts[input.script_index];
      // A valid manifest without this index is a caller selection fault.
      if (selected === undefined)
        return err(
          acquisition.retain(
            new AnalysisInputError(this.operation, undefined, [
              manifest.scripts.length === 0
                ? {
                    path: ["script_index"],
                    reason: "invalid_value",
                    message: "The selected manifest contains no scripts.",
                  }
                : {
                    path: ["script_index"],
                    reason: "out_of_range",
                    minimum: 0,
                    maximum: manifest.scripts.length - 1,
                    message: `No script at index ${String(input.script_index)}; the manifest contains ${String(manifest.scripts.length)} scripts.`,
                  },
            ]),
          ),
        );
      if (selected.content.state !== "exported")
        return err(
          acquisition.retain(
            new AnalysisCapabilityUnavailableError(
              "web-module-artifacts",
              this.operation,
              "selected_source_unavailable",
              {
                userMessage: `Selected script ${String(input.script_index)} has unavailable source bytes (${selected.content.reason}): ${selected.content.message} Capture source bytes before tracing this script.`,
              },
            ),
          ),
        );
      // The index has selected a script. Its source metadata belongs to the
      // manifest, rather than to the caller's index or file selection.
      callerSelected = false;
      const portable = normalizeArtifactPath(selected.content.relative_path);
      if (portable !== selected.content.relative_path)
        throw new ArtifactReaderFailure(
          "path",
          `Selected source path changes during normalization: ${selected.content.relative_path}`,
        );
      if (process.platform === "win32" && portable.includes("\\"))
        throw new ArtifactReaderFailure(
          "path",
          `Windows source path cannot contain backslashes as literal name characters: ${JSON.stringify(portable)}`,
        );
      const selectedParent = dirname(input.manifest_path);
      targetPath = selectedParent;
      const root = await realpath(selectedParent);
      const sourcePath = join(root, "files", portable);
      targetPath = sourcePath;
      await assertContained(root, sourcePath);
      const sourceBytes = await acquisition.read(
        "source",
        sourcePath,
        16 * 1024 * 1024,
        options?.signal,
        this.resources,
      );
      await assertContained(root, sourcePath);
      if (
        sourceBytes.sha256 !== selected.content.sha256 ||
        sourceBytes.bytes.length !== selected.content.bytes
      )
        throw new ArtifactReaderFailure(
          "integrity",
          `Selected source identity mismatch: ${sourcePath}; expected sha256=${selected.content.sha256}, bytes=${String(selected.content.bytes)}; observed sha256=${sourceBytes.sha256}, bytes=${String(sourceBytes.bytes.length)}.`,
          undefined,
          {
            logicalPath: selected.content.relative_path,
            declaredSha256: selected.content.sha256,
            calculatedSha256: sourceBytes.sha256,
            unpacked: false,
          },
        );
      acquisition.record(
        "source",
        {
          path: sourcePath,
          sha256: sourceBytes.sha256,
          bytes: sourceBytes.bytes.length,
        },
        "source-verified",
      );
      const source = decodeWebArtifact(sourceBytes.bytes);
      return ok({
        manifest,
        manifestFile: {
          path: input.manifest_path,
          sha256: manifestBytes.sha256,
          bytes: manifestBytes.bytes.length,
        },
        sourceFile: {
          path: sourcePath,
          sha256: sourceBytes.sha256,
          bytes: sourceBytes.bytes.length,
        },
        source,
      });
    } catch (cause: unknown) {
      return err(
        acquisition.retain(
          webArtifactReadError(
            cause,
            { operation: this.operation, field, targetPath, callerSelected },
            options?.signal,
          ),
        ),
      );
    }
  }
}

const assertContained = async (root: string, path: string): Promise<void> => {
  const canonicalFile = await realpath(path);
  if (!isPathWithinRoot(root, canonicalFile))
    throw new ArtifactReaderFailure(
      "path",
      `Selected source escapes its manifest directory: ${path}`,
    );
  let directory = dirname(path);
  while (directory !== root) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ArtifactReaderFailure(
        "path",
        `Selected source directory is a symlink or not a directory: ${directory}`,
      );
    const parent = dirname(directory);
    if (parent === directory)
      throw new ArtifactReaderFailure(
        "path",
        "Selected source has no containing manifest directory.",
      );
    directory = parent;
  }
};
