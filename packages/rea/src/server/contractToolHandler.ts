import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import type { z } from "zod";

import type { ProgressReporter } from "../application/ProgressReporter.js";
import {
  optionalProviderUnavailable,
  type OptionalProviderLoadFailure,
} from "../application/OptionalObservationProviders.js";
import { mcpProgressReporter } from "./mcpProgress.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import {
  projectRetainedAnalysis,
  requireAnalysisViewRetention,
  type AnalysisViewRetention,
} from "../application/analysisView/AnalysisViewService.js";
import type { AnalysisViewRequest } from "../domain/analysisView/analysisView.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { ToolContract } from "../contracts/toolContractTypes.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import { err, type Result } from "../domain/result.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { logToolExecution } from "./toolLogging.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";

/** Application service executing one named contract operation. */
export interface ContractToolService<TOperation extends string> {
  execute(
    operation: TOperation,
    input: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>>;
}

/** Record and deliver one Evidence result using the tool's exact contract. */
export const deliverEvidenceResult = (
  server: EvidenceMcpServer,
  result: Result<Evidence, AnalysisError>,
  contract: ToolContract,
  recordEvidence?: EvidenceWriter["recordEvidence"],
): CallToolResult => {
  if (!result.ok)
    return server.delivery.toPartialErrorToolResult(
      result.error,
      contract.returnsTargetContent,
      recordEvidence,
    );
  const recorded = recordEvidence?.(result.value);
  return server.delivery.toEvidenceToolResult(result.value, contract, recorded);
};

/**
 * Bind one service-backed handler to its exact named contract through the
 * shared log/execute/record/deliver workflow.
 */
export const createContractToolHandler =
  <TOperation extends string>(
    server: EvidenceMcpServer,
    service: ContractToolService<TOperation>,
    logger: Logger,
    recordEvidence?: EvidenceWriter["recordEvidence"],
    withAdmittedAnalysis?: WithAdmittedAnalysis,
  ) =>
  (contract: ToolContract<TOperation>) =>
    createEvidenceToolHandler(
      server,
      (input, options) => service.execute(contract.name, input, options),
      logger,
      recordEvidence,
      withAdmittedAnalysis,
    )(contract);

/** Validate delivery selection before inspection and retain its complete source for summaries. */
export const createRetainedSummaryToolHandler = <
  Name extends string,
  InputSchema extends z.ZodType<
    Readonly<Record<string, unknown>> & {
      readonly detail: "complete" | "summary";
      readonly view?: AnalysisViewRequest;
    }
  >,
>(
  server: EvidenceMcpServer,
  contract: ToolContract<Name, InputSchema>,
  inspect: (
    input: Omit<z.output<InputSchema>, "detail" | "view">,
    options: ExecutionOptions,
  ) => Promise<Result<Evidence, AnalysisError>>,
  logger: Logger,
  retention: AnalysisViewRetention,
  withAdmittedAnalysis?: WithAdmittedAnalysis,
) => {
  return createEvidenceToolHandler(
    server,
    async (rawInput, options) => {
      const parsed = contract.inputSchema.safeParse(rawInput);
      if (!parsed.success)
        return err(
          analysisInputErrorFromIssues(
            contract.name,
            parsed.error.issues,
            rawInput,
            { cause: parsed.error },
          ),
        );
      const { detail, view, ...input } = parsed.data;
      if (detail === "summary") {
        const ready = requireAnalysisViewRetention(contract.name, retention);
        if (!ready.ok) return ready;
      }
      const inspected = await inspect(input, options);
      return detail === "summary" && inspected.ok
        ? projectRetainedAnalysis(
            inspected.value,
            retention,
            view ?? { kind: "summary" },
          )
        : inspected;
    },
    logger,
    retention.recordEvidence,
    withAdmittedAnalysis,
  )(contract);
};

/** Bind a named Evidence-producing operation to shared logging and delivery. */
export const createEvidenceToolHandler =
  (
    server: EvidenceMcpServer,
    operation: (
      input: unknown,
      options: ExecutionOptions,
    ) => Promise<Result<Evidence, AnalysisError>>,
    logger: Logger,
    recordEvidence?: EvidenceWriter["recordEvidence"],
    withAdmittedAnalysis?: WithAdmittedAnalysis,
  ) =>
  <TOperation extends string>(contract: ToolContract<TOperation>) =>
  (input: unknown, context: ServerContext) =>
    runEvidenceToolOperation(
      { server, logger, recordEvidence, withAdmittedAnalysis },
      contract,
      undefined,
      { input, context },
      (selected, { signal }) => operation(selected, { signal }),
    );

/** One owner for optional-provider admission, execution, recording and delivery. */
export const runEvidenceToolOperation = async <Input>(
  options: {
    readonly server: EvidenceMcpServer;
    readonly logger: Logger;
    readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
    readonly withAdmittedAnalysis?: WithAdmittedAnalysis | undefined;
  },
  contract: ToolContract,
  loadFailure: OptionalProviderLoadFailure | undefined,
  request: { readonly input: Input; readonly context: ServerContext },
  execute: (
    input: Input,
    options: {
      readonly signal: AbortSignal;
      readonly progress: ProgressReporter;
    },
  ) => Promise<Result<Evidence, AnalysisError>>,
): Promise<CallToolResult> => {
  const { input, context } = request;
  if (loadFailure !== undefined)
    return options.server.delivery.toCallToolResult(
      err(optionalProviderUnavailable(loadFailure, contract.name)),
      contract,
    );
  return runAdmittedToolOperation(
    options.server,
    options.withAdmittedAnalysis,
    contract.name,
    context.mcpReq.signal,
    async () => {
      const result = await logToolExecution(options.logger, contract.name, () =>
        execute(input, {
          signal: context.mcpReq.signal,
          progress: mcpProgressReporter(context),
        }),
      );
      return deliverEvidenceResult(
        options.server,
        result,
        contract,
        options.recordEvidence,
      );
    },
  );
};
