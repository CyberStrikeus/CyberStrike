import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { resolveInvestigationEvidenceClosure } from "../application/investigation/InvestigationEvidence.js";
import {
  buildCallPathEvidence,
  findChangedBehaviorEvidence,
  correlateStaticAndRuntimeEvidence,
  type InvestigationWorkflowExecution,
} from "../application/investigation/InvestigationWorkflows.js";
import {
  recordEvidenceSources,
  retainAnalysisResultSources,
} from "../application/investigation/recordEvidenceSources.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";
import { toolContract } from "../contracts/toolContracts.js";
import { createEvidence } from "../domain/evidence.js";
import { recordWorkflowEvidence } from "./registerInvestigationTools/helpers.js";
import { recordDerivedEvidence } from "./recordDerivedEvidence.js";
import { runDerivedOperation } from "./runDerivedOperation.js";
import { RECONSTRUCTION_PROVIDER } from "../domain/investigationProviders.js";
import {
  toolRegistrationOptions,
  applicationToolRegistrationOptions,
} from "./toolRegistrationOptions.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import { verifyReconstruction } from "../domain/reconstructionVerification.js";

export const registerInvestigationTools = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
): void => {
  const admission = withAdmittedAnalysis({ kind: "session", session });
  registerInvestigationWorkflow(
    server,
    session,
    admission,
    toolContract("find_changed_behavior"),
    findChangedBehaviorEvidence,
  );
  registerInvestigationWorkflow(
    server,
    session,
    admission,
    toolContract("build_call_path"),
    buildCallPathEvidence,
  );
  registerInvestigationWorkflow(
    server,
    session,
    admission,
    toolContract("correlate_static_and_runtime"),
    correlateStaticAndRuntimeEvidence,
  );
  registerReconstruction(
    server,
    session,
    admission,
    toolContract("verify_reconstruction"),
  );
};

type RecordWorkflowName =
  | "find_changed_behavior"
  | "build_call_path"
  | "correlate_static_and_runtime";
const registerInvestigationWorkflow = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  admission: ReturnType<typeof withAdmittedAnalysis>,
  contract: ReturnType<typeof toolContract<RecordWorkflowName>>,
  execute: (
    input: unknown,
    reader: BinarySessionPort,
    signal?: AbortSignal,
  ) => Result<InvestigationWorkflowExecution, AnalysisError>,
): void => {
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const computed = await runDerivedOperation(
            context,
            contract.name,
            () => {
              const result = execute(input, session, context.mcpReq.signal);
              if (!result.ok) throw result.error;
              return result.value;
            },
            (value) => value,
          );
          const completed = retainAnalysisResultSources(
            contract.name,
            session.recordEvidence.bind(session),
            computed,
          );
          if (!completed.ok)
            return server.delivery.toPartialErrorToolResult(
              completed.error,
              contract.returnsTargetContent,
              session.recordEvidence.bind(session),
            );
          const { evidence, sources, unknown } = completed.value;
          const retained = recordEvidenceSources(
            session.recordEvidence.bind(session),
            sources,
          );
          if (!retained.ok)
            return server.delivery.toCallToolResult(retained, contract);
          return server.delivery.toEvidenceToolResult(
            evidence,
            contract,
            recordDerivedEvidence(session, evidence, unknown),
          );
        },
      ),
  );
};

const registerReconstruction = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  admission: ReturnType<typeof withAdmittedAnalysis>,
  contract: ReturnType<typeof toolContract<"verify_reconstruction">>,
): void => {
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const owned = session.immutableEvidenceBundle();
          const computed = await runDerivedOperation(
            context,
            contract.name,
            () => verifyReconstruction(input.specification, owned),
          );
          if (!computed.ok)
            return server.delivery.toCallToolResult(computed, contract);
          const result = computed.value;
          const closure = resolveInvestigationEvidenceClosure(
            session,
            result.evidence_links,
          );
          if (!closure.ok)
            return server.delivery.toCallToolResult(closure, contract);
          const links = closure.value;
          const evidence = createEvidence(undefined, RECONSTRUCTION_PROVIDER, {
            predicateType: "rea.reconstruction-verification",
            operation: contract.name,
            parameters: {
              specification_sha256: result.specification_sha256,
              claim_ids: input.specification.claims.map(
                ({ claim_id: id }) => id,
              ),
            },
            result,
            confidence: "derived",
            authority: "analyst-inference",
            limitations: result.limitations,
            evidenceLinks: links,
          });
          return server.delivery.toEvidenceToolResult(
            evidence,
            contract,
            recordWorkflowEvidence(
              session,
              evidence,
              result.status === "unknown",
              {
                question:
                  "Does the reconstruction satisfy every declared claim?",
                domain: "reconstruction-verification",
                requiredAuthority: null,
                requiredConfidence: "derived",
                probes: result.recommended_probes.map(
                  ({ operation, rationale }) => ({ operation, rationale }),
                ),
              },
            ),
          );
        },
      ),
  );
};
