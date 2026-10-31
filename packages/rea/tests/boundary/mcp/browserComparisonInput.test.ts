import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  McpServer,
  STDIO_DEFAULT_MAX_BUFFER_SIZE,
} from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { compareWebCaptureEvidence } from "../../../src/application/BrowserObservationService.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import {
  browserCaptureComparisonInputSchema,
  compareBrowserCaptures,
} from "../../../src/domain/browserCaptureComparison.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { browserScenarioCaptureSchema } from "../../../src/domain/browserScenarioCapture.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

const delivery = createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE);

const contract = toolContract("compare_web_captures");

async function capturePassivePair(
  provider: CdpBrowserProvider,
  browser: Awaited<ReturnType<typeof startFakeCdpBrowser>>,
) {
  const produced = await provider.inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      allowed_origins: [browser.allowedOrigin, "https://private.example.test"],
      observation_ms: 0,
      include_json_body_shapes: true,
      include_websocket_shapes: true,
    }),
  );
  if (!produced.ok) throw produced.error;
  // Capture order must not turn identical frame identities into a DOM change.
  produced.value.frames = [null, browser.allowedOrigin, ""].map(
    (origin, index) => ({
      frame_id: String(index),
      parent_frame_id: null,
      url: "about:blank",
      origin,
    }),
  );
  const reordered = structuredClone(produced.value);
  reordered.frames.reverse();
  return {
    before: { inspection: produced.value },
    after: { inspection: reordered },
  };
}

function invalidComparisonInputs(
  passive: Awaited<ReturnType<typeof capturePassivePair>>,
  scenario: (typeof contract.examples)[number]["input"],
) {
  const scenarioCapture = browserScenarioCaptureSchema.parse(
    scenario.before_scenario,
  );
  const runtimeOnlyInvalid = [
    { before: { inspection: {} }, after: passive.after },
    { before: passive.before, after: { ...passive.after, webmcp: {} } },
    { before_scenario: {}, after_scenario: {} },
    { ...scenario, before_scenario: { ...scenarioCapture, steps: [{}] } },
  ];
  const advertisedInvalid = [
    {},
    { before: passive.before },
    { before: { inspection: "{}" }, after: passive.after },
    {
      before: passive.before,
      after: { ...passive.after, webmcp: "{}" },
    },
    { before_scenario: "{}", after_scenario: scenarioCapture },
    { before_scenario: scenario.before_scenario },
    { ...passive, unexpected: true },
    {
      ...scenario,
      normalization: {
        rules: [
          { rule_id: "bad", artifacts: [], match: "x", replacement: "y" },
        ],
      },
    },
  ];
  return { advertisedInvalid, runtimeOnlyInvalid };
}

describe("browser comparison input boundary", () => {
  it("advertises producer captures and agrees with SDK validation on both comparison families", async () => {
    const browser = await startFakeCdpBrowser({ sensitiveShapes: true });
    const server = new McpServer({ name: "capture-input", version: "0" });
    const client = new Client({ name: "capture-input", version: "0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    let calls = 0;
    const provider = new CdpBrowserProvider();
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async (input) => {
        calls += 1;
        const compared = await compareWebCaptureEvidence(provider, input);
        return compared.ok
          ? delivery.toEvidenceToolResult(compared.value, contract, undefined)
          : delivery.toErrorToolResult(
              compared.error,
              contract.returnsTargetContent,
            );
      },
    );
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const advertised = (await client.listTools()).tools.find(
        ({ name }) => name === contract.name,
      );
      if (advertised === undefined) throw new Error("Missing comparison tool");
      // Claude Desktop rejects tools above its 64 KiB per-input-schema limit.
      expect(
        Buffer.byteLength(JSON.stringify(advertised.inputSchema)),
      ).toBeLessThanOrEqual(65_536);
      expect(advertised.inputSchema.type).toBe("object");
      // Anthropic tool input schemas reject root combinators.
      expect(advertised.inputSchema).not.toHaveProperty("anyOf");
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      expect(ajv.validateSchema(advertised.inputSchema)).toBe(true);
      const validate = ajv.compile(advertised.inputSchema);
      const passive = await capturePassivePair(provider, browser);
      const defaultFilledPassive = structuredClone(passive);
      const fillDefaults = new Ajv2020({
        strict: false,
        validateFormats: false,
        useDefaults: true,
      }).compile(advertised.inputSchema);
      expect(fillDefaults(defaultFilledPassive)).toBe(true);
      expect(defaultFilledPassive).not.toHaveProperty("normalization");
      const scenario = contract.examples[0]?.input;
      if (scenario === undefined) throw new Error("Missing scenario example");
      const withoutNormalization = Object.fromEntries(
        Object.entries(scenario).filter(([key]) => key !== "normalization"),
      );
      const invalid = invalidComparisonInputs(passive, scenario);
      // Strict clients reject combinators and dependentRequired, so the
      // projection states the groups in its description and leaves group
      // completeness and exclusion to the canonical runtime parser.
      expect(advertised.inputSchema.description).toContain(
        "before + after; before_scenario + after_scenario + [normalization]",
      );
      const runtimeOnlyInvalid = [
        // Complete observations are copied from producer results, not authored
        // from their declaration. Malformed payloads still fail before effects.
        ...invalid.runtimeOnlyInvalid,
        { ...passive, ...scenario },
        { ...passive, normalization: { rules: [] } },
        {
          before_scenario: scenario.before_scenario,
          normalization: { rules: [] },
        },
        {
          after_scenario: scenario.after_scenario,
          normalization: { rules: [] },
        },
      ];
      for (const { input, advertisedValid, runtimeValid } of [
        ...[passive, defaultFilledPassive, scenario, withoutNormalization].map(
          (input) => ({
            input,
            advertisedValid: true,
            runtimeValid: true,
          }),
        ),
        ...invalid.advertisedInvalid.map((input) => ({
          input,
          advertisedValid: false,
          runtimeValid: false,
        })),
        ...runtimeOnlyInvalid.map((input) => ({
          input,
          advertisedValid: true,
          runtimeValid: false,
        })),
      ]) {
        expect(validate(input), JSON.stringify(validate.errors)).toBe(
          advertisedValid,
        );
        expect(
          browserCaptureComparisonInputSchema.safeParse(input).success,
        ).toBe(runtimeValid);
        const beforeCalls = calls;
        const result = await client.callTool({
          name: contract.name,
          arguments: input,
        });
        expect(calls - beforeCalls).toBe(runtimeValid ? 1 : 0);
        expect(result.isError === true).toBe(!runtimeValid);
        if (input === scenario)
          expect(result.structuredContent).toMatchObject({
            normalized_result: { overall_status: "unknown" },
          });
        if (runtimeValid)
          expect(result.structuredContent).toMatchObject({
            operation: contract.name,
            normalized_result: compareBrowserCaptures(
              browserCaptureComparisonInputSchema.parse(input),
            ),
          });
      }
      const parsedPassive = browserCaptureComparisonInputSchema.parse(passive);
      expect(parsedPassive).toEqual({
        before: { ...passive.before, webmcp: null },
        after: { ...passive.after, webmcp: null },
      });
      expect(compareBrowserCaptures(parsedPassive)).toMatchObject({
        dimensions: { dom_structure: { status: "unchanged" } },
      });
      expect(compareBrowserCaptures(parsedPassive).overall_status).toBe(
        "unknown",
      );
      const parsedScenario =
        browserCaptureComparisonInputSchema.parse(withoutNormalization);
      expect(parsedScenario).toHaveProperty("normalization", { rules: [] });
      // The public example explicitly marks events missing and equality
      // ineligible; normalization defaults cannot restore uncaptured evidence.
      expect(compareBrowserCaptures(parsedScenario)).toMatchObject({
        comparison_kind: "browser_scenario",
        overall_status: "unknown",
      });
    } finally {
      await Promise.allSettled([
        client.close(),
        server.close(),
        browser.close(),
      ]);
    }
  });
});
