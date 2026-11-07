import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import type { AnalysisProvider } from "../../../src/application/AnalysisProvider.js";
import {
  executeComposedWorkflow,
  createWorkflowEvidence,
} from "../../../src/application/WorkflowEvidence.js";
import { EnhancedTools } from "../../../src/application/EnhancedTools.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { ok } from "../../../src/domain/result.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { expect, it } from "vitest";

const identity = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
} as const;

const effects = {
  mutatesArtifact: false,
  launchesProcess: false,
  mayShowUi: false,
  mayAccessNetwork: false,
  mayWriteFilesystem: false,
  changesPermissions: false,
  requiresRoot: false,
} as const;

it("links backward caller observations into workflow Evidence without a document", async () => {
  const forward = {
    native_result: { callers: ["0x2000"], callers_complete: true },
    forward_observations: {
      call_references: [
        {
          caller_address: "0x2000",
          source_address: "0x2004",
          target_address: "0x1000",
          source_procedure: "0x2000",
          call: "direct",
        },
      ],
    },
  };
  const provider: AnalysisProvider = {
    identity: () => identity,
    resolveAnalysisProfile: () =>
      Promise.resolve(
        ok({ profile: createAnalysisProfile(identity, { fixture: true }) }),
      ),
    capabilities: () =>
      (["procedure_address", "procedure_callers"] as const).map(
        (operation) => ({
          provider: identity,
          operation,
          available: true,
          reason: null,
          effects,
          limitations: [],
        }),
      ),
    createClient: () => ({
      execute: (operation, parameters) => {
        if (operation === "procedure_address")
          return Promise.resolve(
            ok(createAnalysisExecution(parameters.procedure, identity)),
          );
        const callers = parameters.procedure === "0x1000" ? ["0x2000"] : [];
        return Promise.resolve(
          ok(
            createAnalysisExecution(callers, identity, {
              rawResult:
                parameters.procedure === "0x1000"
                  ? forward
                  : {
                      native_result: callers,
                      forward_observations: { call_references: [] },
                    },
            }),
          ),
        );
      },
      close: () => Promise.resolve(ok(null)),
    }),
  };
  const session = createTestBinarySession(provider);
  const [target] = await createBinarySessionTargets();
  if (target === undefined) throw new Error("Missing session target");
  try {
    const opened = await session.open(target);
    if (!opened.ok) throw opened.error;
    const composed = await executeComposedWorkflow(session, (observed) =>
      new EnhancedTools(observed).execute("get_call_graph", {
        address: "0x1000",
        direction: "backward",
      }),
    );
    if (!composed.ok) throw composed.error;
    const workflow = createWorkflowEvidence({
      target: opened.value,
      operation: "get_call_graph",
      parameters: { address: "0x1000", direction: "backward" },
      result: composed.value.result,
      upstreamProfile: session.analysisProfile(),
      upstreamLimitations: composed.value.limitations,
      ...(composed.value.evidenceLinks === undefined
        ? {}
        : { upstreamEvidenceLinks: composed.value.evidenceLinks }),
    });
    const caller = composed.value.evidenceLinks
      ?.map((id) => session.evidenceById(id))
      .find(
        (evidence) =>
          evidence?.operation === "procedure_callers" &&
          evidence.parameters.procedure === "0x1000",
      );
    expect(caller).toMatchObject({
      parameters: { procedure: "0x1000" },
      raw_result: forward,
    });
    expect(caller?.raw_result).toMatchObject({
      forward_observations: {
        call_references: [
          {
            caller_address: "0x2000",
            source_address: "0x2004",
            target_address: "0x1000",
          },
        ],
      },
    });
    expect(caller?.raw_result).not.toHaveProperty("native_result.instructions");
    expect(caller?.parameters).not.toHaveProperty("document");
    expect(workflow.evidence_links).toContain(caller?.evidence_id);
  } finally {
    await session.close();
  }
});
