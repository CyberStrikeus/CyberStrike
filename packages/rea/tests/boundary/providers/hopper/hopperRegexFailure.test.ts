import { expect, it } from "vitest";
import { HopperRegexSearch } from "../../../../src/hopper/HopperRegexSearch.js";
import { HopperRemoteError } from "../../../../src/domain/hopperErrors.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import {
  HopperFixtureLauncher,
  startHopperFixtureClient,
} from "./hopperClient.fixture.js";

it.each(
  (["search_strings", "search_procedures"] as const).flatMap((operation) =>
    (["capability_unavailable", "bridge_exception"] as const).map(
      (failure) => ({ operation, failure }),
    ),
  ),
)(
  "attributes real bridge $failure inventory response to $operation and preserves wire identity",
  async ({ operation, failure }) => {
    const launcher = new HopperFixtureLauncher(
      undefined,
      "quiet",
      "ready",
      "acknowledge",
      failure,
    );
    const client = await startHopperFixtureClient(launcher);
    const search = new HopperRegexSearch(client);
    try {
      const result = await search.execute(operation, {
        mode: "regex",
        pattern: "fixture",
        case_sensitive: false,
        document: "selected-document",
      });
      if (result.ok) throw new Error("Expected fixture failure");
      const inventory =
        operation === "search_strings" ? "list_strings" : "list_procedures";
      const request = await launcher.waitForRequest(inventory);
      expect(request.params).toEqual({ document: "selected-document" });
      const projected = projectAnalysisError(result.error);
      expect(projected.code).toBe(
        failure === "capability_unavailable"
          ? "capability_unavailable"
          : "execution_failure",
      );
      expect(projected.details?.operation).toBe(operation);
      expect(result.error.diagnostics).toMatchObject({
        provider_request: {
          operation: inventory,
          request_id: request.id,
          provider_code: -32000,
          diagnostic_type: failure,
        },
      });
      if (failure !== "capability_unavailable") {
        expect(projected.message).toContain(operation);
        expect(result.error.cause).toBeInstanceOf(HopperRemoteError);
        expect(result.error.cause).toMatchObject({
          operation: inventory,
          requestId: request.id,
        });
      }
    } finally {
      await search.close();
      expect((await client.close()).ok).toBe(true);
    }
  },
);

it.each(["search_strings", "search_procedures"] as const)(
  "preserves successful %s search and caller-selected document",
  async (operation) => {
    const launcher = new HopperFixtureLauncher();
    const client = await startHopperFixtureClient(launcher);
    const search = new HopperRegexSearch(client);
    try {
      expect(
        await search.execute(operation, {
          mode: "regex",
          pattern: "fixture",
          case_sensitive: false,
          document: "selected-document",
        }),
      ).toMatchObject({
        ok: true,
        value: [{ address: "0x1000", value: "fixture" }],
      });
      const request = await launcher.waitForRequest(
        operation === "search_strings" ? "list_strings" : "list_procedures",
      );
      expect(request.params).toEqual({ document: "selected-document" });
    } finally {
      await search.close();
      expect((await client.close()).ok).toBe(true);
    }
  },
);
