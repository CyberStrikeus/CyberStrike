import type { BinarySession } from "../application/binary/BinarySession.js";
import type { AppConfig } from "../config/types.js";
import type { Logger } from "pino";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

export const openInitialTarget = async (
  session: BinarySession,
  config: AppConfig,
  serverLogger: Logger,
  writeStderr: (text: string) => void,
  signal?: AbortSignal,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly exitCode: 0 | 1 }
> => {
  if (signal?.aborted) return { ok: false, exitCode: 0 };
  if (config.hopperTargetPath === undefined) return { ok: true };
  const opened = await session.open(config.hopperTargetPath, {
    targetKind: config.hopperTargetKind,
    ...(signal === undefined ? {} : { signal }),
  });
  if (opened.ok) return { ok: true };
  if (opened.error instanceof AnalysisCancelledError && signal?.aborted)
    return { ok: false, exitCode: 0 };
  serverLogger.error(
    {
      error: projectAnalysisError(opened.error),
    },
    "Initial target failed to open",
  );
  writeStderr(`${projectAnalysisError(opened.error).message}\n`);
  return { ok: false, exitCode: 1 };
};
