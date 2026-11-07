import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import {
  retainedSummaryDelivery,
  withoutDeliveryDetail,
  type EvidenceToolFamilyOptions,
} from "./retainedSummaryDelivery.js";

import type {
  AnalysisOperation,
  AnalysisOperationPort,
} from "../application/AnalysisProvider.js";
import type { ToolContract } from "../contracts/toolContractTypes.js";
import { ok } from "../domain/result.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";
import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import type { Logger } from "pino";
import { mcpProgressReporter } from "./mcpProgress.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { recordEvidenceSources } from "../application/investigation/recordEvidenceSources.js";
import {
  reportOperationStart,
  reportOperationEnd,
} from "./operationProgress.js";

interface EvidenceToolRegistration {
  readonly logger: Logger;
  readonly activeTarget: (() => BinaryTarget | undefined) | undefined;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly evidenceById?: EvidenceToolFamilyOptions["evidenceById"];
  readonly withAdmittedAnalysis: WithAdmittedAnalysis;
  readonly analysisForAdmission?: (
    analysis: AnalysisOperationPort,
  ) => AnalysisOperationPort;
  readonly parametersForExecution?: (
    operation: Exclude<AnalysisOperation, "health">,
    parameters: Readonly<Record<string, JsonValue>>,
  ) => Readonly<Record<string, JsonValue>>;
}

/** Register provider-backed contracts that return atomic Evidence observations. */
export const registerEvidenceTools = (
  server: EvidenceMcpServer,
  contracts: readonly ToolContract<Exclude<AnalysisOperation, "health">>[],
  options: EvidenceToolRegistration,
): void => {
  for (const contract of contracts) {
    const delivery =
      contract.retainedSummary === undefined
        ? undefined
        : retainedSummaryDelivery(contract.name, options);
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async (input, context) => {
        const parameters = jsonObjectSchema.parse(input);
        const ready = delivery?.preflight(parameters) ?? ok(null);
        if (!ready.ok) return server.delivery.toCallToolResult(ready, contract);
        const admitted = await options.withAdmittedAnalysis(
          contract.name,
          context.mcpReq.signal,
          async (admittedAnalysis) => {
            const analysis =
              options.analysisForAdmission?.(admittedAnalysis) ??
              admittedAnalysis;
            const progress = mcpProgressReporter(context);
            await reportOperationStart(progress, contract.name);
            const providerParameters =
              contract.retainedSummary === undefined
                ? parameters
                : withoutDeliveryDetail(parameters);
            const executionParameters =
              options.parametersForExecution?.(
                contract.name,
                providerParameters,
              ) ?? providerParameters;
            const execution = await logToolExecution(
              options.logger,
              contract.name,
              () =>
                analysis.execute(contract.name, executionParameters, {
                  signal: context.mcpReq.signal,
                  progress,
                }),
            );
            await reportOperationEnd(progress, contract.name, execution.ok);
            if (!execution.ok)
              return server.delivery.toCallToolResult(execution, contract);
            const sourceEvidence = execution.value.sourceEvidence ?? [];
            const evidence = createAnalysisExecutionEvidence(
              contract.name,
              contract.retainedSummary?.evidenceParameters === "omit-detail"
                ? providerParameters
                : parameters,
              {
                ...execution.value,
                subject:
                  execution.value.subject === undefined
                    ? (options.activeTarget?.() ?? null)
                    : execution.value.subject,
              },
              "observed",
            );
            const sourceRecorded = recordEvidenceSources(
              options.recordEvidence,
              sourceEvidence,
            );
            if (!sourceRecorded.ok)
              return server.delivery.toCallToolResult(sourceRecorded, contract);
            const projected =
              delivery?.projectEvidence(parameters, evidence) ?? ok(evidence);
            if (!projected.ok)
              return server.delivery.toCallToolResult(projected, contract);
            const recorded = options.recordEvidence?.(projected.value);
            return server.delivery.toEvidenceToolResult(
              projected.value,
              contract,
              recorded,
            );
          },
        );
        return admitted.ok
          ? admitted.value
          : server.delivery.toCallToolResult(admitted, contract);
      },
    );
  }
};
