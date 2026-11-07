import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../../fixtures/analysisView.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves independent retained response facts through manifest and API views in CLI and MCP",
  async ({ cli }) => {
    // Retained Evidence may contain incomplete response declarations. A malformed
    // content field must not erase a usable status, or vice versa.
    const samples: {
      path: string;
      response: JsonValue;
      statuses: number[];
      contentTypes: string[];
      eligible: boolean;
    }[] = [
      ...[null, "malformed", 0, false, []].map((content, index) => ({
        path: `/empty-${index}`,
        response: { status: 204, content },
        statuses: [204],
        contentTypes: [],
        eligible: true,
      })),
      {
        path: "/reset",
        response: { status: 205, content: "malformed" },
        statuses: [205],
        contentTypes: [],
        eligible: true,
      },
      {
        path: "/partial-mime",
        response: {
          status: "malformed",
          content: { mimeType: "application/json", text: false },
        },
        statuses: [],
        contentTypes: ["application/json"],
        eligible: true,
      },
      {
        path: "/partial-status",
        response: {
          status: 204,
          content: { mimeType: false, text: 123, encoding: [] },
        },
        statuses: [204],
        contentTypes: [],
        eligible: true,
      },
      {
        path: "/unknown-body",
        response: { status: 200, content: "malformed" },
        statuses: [200],
        contentTypes: [],
        eligible: false,
      },
    ];
    const capture = environmentManifestCaptureFixture(
      samples.map(({ path, response }) => ({
        request: { method: "DELETE", url: `https://response.test${path}` },
        response,
      })),
    );
    const evidence = analysisViewCaptureEvidence(capture);
    const before = JSON.stringify(evidence);
    const root = await createTestTempDirectory("rea-retained-response-facts-");
    const { call } = await connectLocalToolsMcp();
    for (const kind of ["api-surface", "environment-manifest"] as const) {
      const request = { source: { kind: "inline", evidence }, view: { kind } };
      const requestPath = join(root, `${kind}.json`);
      await writeFile(requestPath, JSON.stringify(request));
      const output = await cli.run({
        arguments: ["inspect-analysis-view", requestPath, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const result = parseEvidence(output.json).normalized_result;
      const reply = await call("inspect_analysis_view", request);
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      expect(parseEvidence(reply.structuredContent).normalized_result).toEqual(
        result,
      );
      expect(result).toMatchObject({
        kind,
        [kind === "api-surface" ? "groups" : "tools"]: samples
          .filter((sample) => kind === "api-surface" || sample.eligible)
          .sort((left, right) => left.path.localeCompare(right.path))
          .map(({ path, statuses, contentTypes }) =>
            expect.objectContaining({
              method: "DELETE",
              path_template: path,
              statuses,
              content_types: contentTypes,
            }),
          ),
      });
      if (kind === "environment-manifest")
        expect(result).toMatchObject({
          excluded: [
            expect.objectContaining({ path_template: "/unknown-body" }),
          ],
        });
    }
    expect(JSON.stringify(evidence)).toBe(before);
  },
);
