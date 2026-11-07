import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { fridaSessionStatusSummaryViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "summarizes historical Frida status from a complete Evidence file without a live session",
  async ({ cli }) => {
    const id = "00000000-0000-4000-8000-000000000001";
    const parent = createEvidence(
      undefined,
      { id: "frida", name: "Frida", version: null },
      {
        operation: "frida_session_status",
        parameters: { session_id: id },
        authority: "external-service",
        environment: null,
        limitations: ["Target OS and architecture were not observed."],
        result: {
          session_id: id,
          device_id: "remote",
          target: "selected target",
          pid: 0,
          mode: "attach",
          state: "detached",
          scripts: [],
          messages: [{ payload: "retained only" }, null],
          messages_truncated: true,
        },
      },
    );
    const root = await createTestTempDirectory("rea-frida-status-view-");
    const source = join(root, "parent.json");
    const request = join(root, "request.json");
    await writeFile(source, JSON.stringify(parent));
    await writeFile(
      request,
      JSON.stringify({
        source: { kind: "evidence-file", path: source },
        view: { kind: "summary" },
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-analysis-view", request, "--json"],
    });
    expect(result.exitCode).toBe(0);
    const evidence = parseEvidence(result.json);
    const view = fridaSessionStatusSummaryViewResultSchema.parse(
      evidence.normalized_result,
    );
    expect(view).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      source_provider: parent.provider,
      source_parameters: parent.parameters,
      artifact: null,
      summary: {
        pid: 0,
        state: "detached",
        messages_retained: 2,
        messages_truncated: true,
      },
    });
    expect(view.unknowns.join(" ")).toContain("does not refresh live state");
    expect(view.limitations).toContain(parent.limitations[0]);
    expect(evidence.authority).toBe("external-service");
    expect(JSON.stringify(evidence)).not.toContain("retained only");
  },
);
