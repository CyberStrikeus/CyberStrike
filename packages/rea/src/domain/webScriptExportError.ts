import { ArtifactOperationError } from "./artifactOperationError.js";
import type { AnalysisErrorOptions } from "./analysisErrorBase.js";

/** Publication failure retaining its input/output target and cleanup state. */
export class WebScriptExportError extends ArtifactOperationError {
  override readonly userMessage: string;
  override cleanupIncomplete: boolean;

  constructor(
    reason: ArtifactOperationError["reason"],
    target: string,
    diagnostic: string,
    options: AnalysisErrorOptions & {
      readonly residualPaths?: readonly string[];
    } = {},
  ) {
    super("export_web_scripts", reason, undefined, undefined, options);
    this.userMessage = `Script export failed for ${target}: ${diagnostic}`;
    this.setCleanupResources([
      ...new Set([
        ...(options.cleanup?.resources ?? []),
        ...(options.residualPaths ?? []),
      ]),
    ]);
    this.cleanupIncomplete =
      options.cleanup !== undefined || (options.residualPaths?.length ?? 0) > 0;
  }
}
