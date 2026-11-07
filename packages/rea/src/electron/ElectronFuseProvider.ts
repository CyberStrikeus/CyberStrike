import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { ElectronFusePort } from "../application/electron/ElectronFusePort.js";
import { createElectronFuseEvidence } from "../domain/electron/electronFuseEvidence.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  assertArtifactReadActive,
  artifactFileCompletion,
} from "../artifacts/ArtifactFileOperation.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import {
  describeElectronFuseFindings,
  electronFuseReportSchema,
  type ElectronFuseReport,
  type InspectElectronFusesInput,
} from "../domain/electron/electronFuses.js";
import { err, ok, type Result } from "../domain/result.js";
import { resolveElectronFuseTarget } from "./ElectronFusePath.js";
import {
  electronFuseReadLimitation,
  readElectronFuseImage,
  type ElectronFuseImage,
} from "./ElectronFuseReader.js";
import {
  ELECTRON_FUSE_PROVIDER_IDENTITY,
  electronFuseFailure,
} from "./ElectronFuseFailures.js";

export { ELECTRON_FUSE_PROVIDER_IDENTITY };

const OPERATION = "inspect_electron_fuses";

/** Read packaged Electron fuse wires from one selected local file or app bundle. */
export class ElectronFuseProvider implements ElectronFusePort {
  readonly identity = ELECTRON_FUSE_PROVIDER_IDENTITY;
  readonly #resources = new ArtifactResourceScope();

  /** Retry the same failed descriptor owners, awaiting active reads first. */
  async close(): Promise<void> {
    try {
      await this.#resources.close();
    } catch (cause: unknown) {
      throw electronFuseFailure(cause, "artifact-resources");
    }
  }

  async inspect(
    input: InspectElectronFusesInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElectronFuseReport, AnalysisError>> {
    try {
      return await this.#resources.run(() => this.#inspectFile(input, options));
    } catch (cause: unknown) {
      return err(electronFuseFailure(cause, input.path));
    }
  }

  async #inspectFile(
    input: InspectElectronFusesInput,
    options?: ExecutionOptions,
  ): Promise<Result<ElectronFuseReport, AnalysisError>> {
    let resolvedPath = input.path;
    let completed: ElectronFuseReport | undefined;
    try {
      assertArtifactReadActive(options?.signal);
      const located = await resolveElectronFuseTarget(
        input.path,
        options?.signal,
      );
      assertArtifactReadActive(options?.signal);
      resolvedPath = located.file.path;
      const image = await readElectronFuseImage(located.file.path, {
        resources: this.#resources,
        selection: located.file,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      completed = reportFor(image, located.selectedPath, resolvedPath);
      assertArtifactReadActive(options?.signal);
      return ok(completed);
    } catch (cause: unknown) {
      const failure = electronFuseFailure(cause, input.path);
      // Only this reader's completed physical outcome supplies partial fuse facts.
      const completion = artifactFileCompletion(cause);
      const report =
        completed ??
        (completion === undefined
          ? undefined
          : reportFor(
              completion.value as ElectronFuseImage,
              input.path,
              resolvedPath,
            ));
      if (report !== undefined) {
        failure.retainPartialObservation(
          createElectronFuseEvidence(input, report, this.identity),
        );
      }
      return err(failure);
    }
  }
}

const reportFor = (
  image: ElectronFuseImage,
  selectedPath: string,
  resolvedPath: string,
): ElectronFuseReport => {
  const findings = describeElectronFuseFindings(image.slices, image.format);
  const parsed = electronFuseReportSchema.safeParse({
    artifact: {
      selected_path: selectedPath,
      resolved_path: resolvedPath,
      sha256: image.sha256,
      bytes: image.bytes,
      format: image.format,
    },
    slices: image.slices,
    runtime_implications: findings.runtime_implications,
    limitations: [...findings.limitations, electronFuseReadLimitation()],
  });
  if (!parsed.success)
    throw new AnalysisOutputError(
      OPERATION,
      "Electron fuse reader produced a report outside its schema.",
      { cause: parsed.error },
    );
  return parsed.data;
};
