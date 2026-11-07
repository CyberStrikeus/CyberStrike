import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { webCaptureDiffSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves an IndexedDB version change through built CLI, stdio MCP, and public comparison",
  async ({ cli }) => {
    let reportedVersion = 1;
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method, params }) =>
        method === "IndexedDB.requestDatabase"
          ? {
              databaseWithObjectStores: {
                name: params.databaseName,
                version: reportedVersion,
                objectStores: [
                  {
                    name: "records",
                    keyPath: { type: "string", string: "id" },
                    autoIncrement: false,
                    indexes: [],
                  },
                ],
              },
            }
          : undefined,
    });

    try {
      const { call } = await connectLocalToolsMcp();
      const inspectionContract = toolContract("inspect_web_page");
      const cliResponse = await cli.run({
        arguments: [
          "inspect-web-page",
          browser.endpoint,
          "allowed-page",
          "--allowed-origins",
          browser.allowedOrigin,
          "--observation-ms",
          "0",
          "--include-storage-keys",
          "--include-storage-fingerprints",
          "--json",
        ],
      });
      expect(
        cliResponse.exitCode,
        cliResponse.stdout + cliResponse.stderr,
      ).toBe(0);
      const before = webPageInspectionSchema.parse(
        parseEvidence(inspectionContract.outputSchema.parse(cliResponse.json))
          .normalized_result,
      );

      reportedVersion = 2;
      const mcpResponse = await call("inspect_web_page", {
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        allowed_origins: [browser.allowedOrigin],
        observation_ms: 0,
        include_storage_keys: true,
        include_storage_fingerprints: true,
      });
      expect(mcpResponse.isError, JSON.stringify(mcpResponse)).not.toBe(true);
      const after = webPageInspectionSchema.parse(
        parseEvidence(
          inspectionContract.outputSchema.parse(mcpResponse.structuredContent),
        ).normalized_result,
      );

      const schemaFingerprints = [before, after].map((inspection) => {
        expect(inspection.storage.fingerprints_complete).toBe(true);
        expect(inspection.storage.indexed_db_names).toEqual(["app-db"]);
        expect(inspection.storage.usage_bytes).toBe(42);
        expect(inspection.storage.quota_bytes).toBe(1_024);
        const fingerprints = inspection.storage.content_fingerprints.filter(
          ({ scope }) => scope === "indexed_db_schema",
        );
        expect(fingerprints).toHaveLength(1);
        expect(fingerprints[0]).toMatchObject({
          projection_version: 2,
          complete: true,
          value_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
        return fingerprints[0]!;
      });
      expect(schemaFingerprints[0]!.identity_sha256).toBe(
        schemaFingerprints[1]!.identity_sha256,
      );
      expect(schemaFingerprints[0]!.value_sha256).not.toBe(
        schemaFingerprints[1]!.value_sha256,
      );
      expect(after.storage).toMatchObject({
        usage_bytes: before.storage.usage_bytes,
        quota_bytes: before.storage.quota_bytes,
        local_storage_keys: before.storage.local_storage_keys,
        session_storage_keys: before.storage.session_storage_keys,
        indexed_db_names: before.storage.indexed_db_names,
        cache_names: before.storage.cache_names,
      });
      expect(
        after.storage.content_fingerprints.filter(
          ({ scope }) => scope !== "indexed_db_schema",
        ),
      ).toEqual(
        before.storage.content_fingerprints.filter(
          ({ scope }) => scope !== "indexed_db_schema",
        ),
      );

      const comparisonResponse = await call("compare_web_captures", {
        before: { inspection: before },
        after: { inspection: after },
      });
      expect(
        comparisonResponse.isError,
        JSON.stringify(comparisonResponse),
      ).not.toBe(true);
      const comparison = webCaptureDiffSchema.parse(
        parseEvidence(
          toolContract("compare_web_captures").outputSchema.parse(
            comparisonResponse.structuredContent,
          ),
        ).normalized_result,
      );
      expect(comparison.dimensions.storage).toEqual({
        status: "changed",
        total_changes: 1,
        changes: [
          {
            identity: `storage:content:indexed_db_schema:${schemaFingerprints[0]!.identity_sha256}`,
            change: "modified",
          },
        ],
        reason: null,
      });
    } finally {
      await browser.close();
    }
  },
);
