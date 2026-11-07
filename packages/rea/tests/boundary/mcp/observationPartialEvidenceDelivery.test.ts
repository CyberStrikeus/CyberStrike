import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { observed } from "../../fixtures/analysisExecution.js";

const resources: Array<{ close(): Promise<unknown> }> = [];
const operations = [
  "list_browser_targets",
  "capture_browser_scenario",
  "inspect_electron_page",
  "list_javascript_runtime_targets",
] as const;
type ObservationOperation = (typeof operations)[number];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

it.each(operations)(
  "records and references partial Evidence from %s",
  async (selectedOperation) => {
    const session = createTestBinarySession(() => ({
      execute: () => Promise.resolve(observed(null)),
      close: () => Promise.resolve(resultOk(null)),
    }));
    const makeEvidence = (operation: ObservationOperation): Evidence =>
      createEvidence(
        undefined,
        {
          id: "observation-fixture",
          name: "Observation fixture",
          version: "1",
        },
        {
          operation,
          parameters: {},
          result: { completed: true },
        },
        { immutable: true },
      );
    const evidence: Record<ObservationOperation, Evidence> = {
      list_browser_targets: makeEvidence("list_browser_targets"),
      capture_browser_scenario: makeEvidence("capture_browser_scenario"),
      inspect_electron_page: makeEvidence("inspect_electron_page"),
      list_javascript_runtime_targets: makeEvidence(
        "list_javascript_runtime_targets",
      ),
    };
    const cancellation: Record<ObservationOperation, AnalysisCancelledError> = {
      list_browser_targets: new AnalysisCancelledError("list_browser_targets", {
        partialObservation: evidence.list_browser_targets,
      }),
      capture_browser_scenario: new AnalysisCancelledError(
        "capture_browser_scenario",
        { partialObservation: evidence.capture_browser_scenario },
      ),
      inspect_electron_page: new AnalysisCancelledError(
        "inspect_electron_page",
        { partialObservation: evidence.inspect_electron_page },
      ),
      list_javascript_runtime_targets: new AnalysisCancelledError(
        "list_javascript_runtime_targets",
        { partialObservation: evidence.list_javascript_runtime_targets },
      ),
    };
    const identity = () => ({
      id: "observation-fixture",
      name: "Observation fixture",
      version: "1",
    });
    const unused = (): never => {
      throw new Error("unselected observation operation");
    };
    const server = createServer(
      { kind: "session", session },
      {
        browserObservation: {
          identity,
          listTargets: async () => err(cancellation.list_browser_targets),
          inspectPage: unused,
          analyzeBundle: unused,
          observeSession: unused,
          discoverWebMcpTools: unused,
          compareCaptures: unused,
          captureScreenshot: unused,
          compareScreenshots: unused,
        },
        browserScenarioCapture: {
          identity,
          captureScenario: async () =>
            err(cancellation.capture_browser_scenario),
        },
        electronObservation: {
          identity,
          inspectPage: async () => err(cancellation.inspect_electron_page),
          listTargets: unused,
        },
        javascriptRuntimeObservation: {
          identity,
          listTargets: async () =>
            err(cancellation.list_javascript_runtime_targets),
          observe: unused,
        },
      },
    );
    const client = new Client({
      name: "partial-observation-delivery",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(client, server, session);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const scenarioExample = toolContract("capture_browser_scenario")
      .examples[0];
    if (scenarioExample === undefined)
      throw new Error("browser scenario contract omitted its example");
    const inputs: Record<ObservationOperation, Record<string, unknown>> = {
      list_browser_targets: {
        cdp_endpoint: "http://127.0.0.1:9222",
      },
      capture_browser_scenario: scenarioExample.input,
      inspect_electron_page: {
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "page",
        observation_ms: 0,
      },
      list_javascript_runtime_targets: {
        inspector_endpoint: "http://127.0.0.1:9222",
      },
    };
    const result = await client.callTool({
      name: selectedOperation,
      arguments: inputs[selectedOperation],
    });
    expect(result.isError).toBe(true);
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "cancelled",
        details: {
          partial_observation: {
            kind: "retained-evidence",
            evidence_id: evidence[selectedOperation].evidence_id,
          },
        },
      },
    });
    expect(
      session.evidenceForAnalysis(evidence[selectedOperation].evidence_id),
    ).toBe(evidence[selectedOperation]);
  },
);
