import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { ElectronObservationPort } from "./ElectronObservationPort.js";
import type { Evidence } from "../../domain/evidence.js";
import type {
  ElectronPageInspection,
  InspectElectronPageInput,
  ListElectronTargetsInput,
} from "../../domain/javascript/electronObservation.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../../domain/result.js";
import { createElectronEvidence } from "./ElectronEvidence.js";
import {
  electronPageInspectionSchema,
  electronTargetListSchema,
} from "../../domain/javascript/electronObservation.js";
import {
  completeProviderEvidence,
  keepIncompleteObservation,
} from "../ProviderOperationExecution.js";

/** List local file pages exposed by the explicitly selected endpoint. */
export const listElectronTargets = async (
  provider: ElectronObservationPort | undefined,
  input: ListElectronTargetsInput,
  options: ExecutionOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const ready = requireProvider(provider, "list_electron_targets");
  if (!ready.ok) return ready;
  if (options.signal?.aborted)
    return err(
      new AnalysisCancelledError("list_electron_targets", {
        cause: options.signal.reason,
      }),
    );
  const result = await ready.value.listTargets(input, options);
  if (!result.ok) return result;
  const report = electronTargetListSchema.safeParse(result.value);
  if (!report.success)
    return err(
      new AnalysisOutputError(
        "list_electron_targets",
        "Electron provider returned a malformed target list.",
        { cause: report.error },
      ),
    );
  return completeProviderEvidence(
    createElectronEvidence(
      "list_electron_targets",
      input,
      report.data,
      ready.value.identity(),
    ),
    options.signal,
  );
};

/** Inspect one local file page from the explicitly selected endpoint. */
export const inspectElectronPage = async (
  provider: ElectronObservationPort | undefined,
  input: InspectElectronPageInput,
  options: ExecutionOptions = {},
): Promise<Result<Evidence, AnalysisError>> => {
  const ready = requireProvider(provider, "inspect_electron_page");
  if (!ready.ok) return ready;
  if (options.signal?.aborted)
    return err(
      new AnalysisCancelledError("inspect_electron_page", {
        cause: options.signal.reason,
      }),
    );
  const result = await ready.value.inspectPage(input, options);
  if (!result.ok) {
    const partial = result.error.partialObservation;
    if (
      partial !== undefined &&
      "kind" in partial &&
      partial.kind === "electron-page-observation"
    ) {
      const report = electronPageInspectionSchema.safeParse(partial.inspection);
      if (report.success) {
        const inspection = {
          ...report.data,
          limitations: [
            ...report.data.limitations,
            partial.cleanup === "transport-closed"
              ? "REA closed its CDP transport; this does not imply target shutdown."
              : "CDP transport cleanup remains incomplete.",
          ],
        } satisfies ElectronPageInspection;
        result.error.partialObservation = createElectronEvidence(
          "inspect_electron_page",
          input,
          inspection,
          ready.value.identity(),
        );
        return result;
      }
    }
    return err(
      keepIncompleteObservation(
        result.error,
        "inspect_electron_page",
        "Electron provider retained a non-JSON incomplete observation.",
      ),
    );
  }
  const report = electronPageInspectionSchema.safeParse(result.value);
  if (!report.success)
    return err(
      new AnalysisOutputError(
        "inspect_electron_page",
        "Electron provider returned a malformed page inspection.",
        { cause: report.error },
      ),
    );
  return completeProviderEvidence(
    createElectronEvidence(
      "inspect_electron_page",
      input,
      report.data,
      ready.value.identity(),
    ),
    options.signal,
  );
};

const requireProvider = (
  provider: ElectronObservationPort | undefined,
  operation: "list_electron_targets" | "inspect_electron_page",
): Result<ElectronObservationPort, AnalysisError> =>
  provider === undefined
    ? err(
        new AnalysisCapabilityUnavailableError(
          "rea-cdp-electron",
          operation,
          "Electron observation provider is not configured",
        ),
      )
    : ok(provider);
