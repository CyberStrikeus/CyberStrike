import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";
import { z } from "zod";

import { artifactComparisonResultSchema } from "../../../src/domain/artifactComparison.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const writeZip = async (
  path: string,
  entries: Readonly<Record<string, string>>,
): Promise<void> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, text] of Object.entries(entries))
    await writer.add(name, new TextReader(text));
  await writeFile(path, await writer.close());
};

const retained = (evidenceId: string) => ({
  kind: "retained-evidence" as const,
  evidence_id: evidenceId,
});

/** Two archives inspected in one stdio MCP session. */
const inspectedPair = async (
  prefix: string,
  profile: "full" | "compact" = "compact",
) => {
  const root = await createTestTempDirectory(prefix);
  const one = join(root, "one.zip");
  const two = join(root, "two.zip");
  await writeZip(one, { "a.txt": "same" });
  await writeZip(two, { "a.txt": "same", "b.txt": "new" });
  const { call, client } = await connectLocalToolsMcp({
    REA_MCP_TOOL_FAMILIES: "session,artifact",
    REA_MCP_INPUT_SCHEMA_PROFILE: profile,
    REA_MCP_OUTPUT_SCHEMA_PROFILE: profile,
    NODE_OPTIONS: "--max-old-space-size=2048",
    RAYON_NUM_THREADS: "2",
  });
  const inspect = async (
    path: string,
    detail: "complete" | "summary",
  ): Promise<Evidence> => {
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const inspected = await call("inspect_artifact", { detail });
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    return parseEvidence(inspected.structuredContent);
  };
  const left = await inspect(one, "complete");
  const right = await inspect(two, "complete");
  return { root, one, call, client, inspect, left, right };
};

cliTest.for(["full", "compact"] as const)(
  "gives one comparison for retained, inline, file and mixed sources through MCP and the CLI (%s)",
  { timeout: 60_000 },
  async (profile, { cli }) => {
    const { root, one, call, client, inspect, left, right } =
      await inspectedPair("rea-artifact-sources-", profile);
    const compare = async (input: Record<string, unknown>) => {
      const compared = await call("compare_artifacts", input);
      expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
      return parseEvidence(compared.structuredContent);
    };
    const inline = await compare({ left, right });
    expect(
      artifactComparisonResultSchema.parse(inline.normalized_result),
    ).toMatchObject({
      status: "changed",
      summary: { unchanged: 1, added: 1, changed: 1, unknown: 0 },
      changes: [
        expect.objectContaining({
          classification: "changed",
          logical_path: ".",
        }),
        expect.objectContaining({
          classification: "added",
          logical_path: "b.txt",
        }),
      ],
    });
    expect(inline.evidence_links).toEqual([
      left.evidence_id,
      right.evidence_id,
    ]);

    const leftFile = join(root, "left.json");
    await writeFile(leftFile, JSON.stringify(left));
    const bundle = join(root, "session.json");
    const exported = await call("export_evidence_bundle", { path: bundle });
    expect(exported.isError, JSON.stringify(exported)).not.toBe(true);
    const rightInBundle = {
      kind: "evidence-file",
      path: bundle,
      evidence_id: right.evidence_id,
    };
    for (const input of [
      { left: retained(left.evidence_id), right: retained(right.evidence_id) },
      { left: { kind: "evidence-file", path: leftFile }, right: rightInBundle },
      { left: retained(left.evidence_id), right: rightInBundle },
      { left, right: retained(right.evidence_id) },
    ])
      expect((await compare(input)).evidence_id).toBe(inline.evidence_id);

    // A retained summary still resolves to its exact complete parent.
    const summary = await inspect(one, "summary");
    const { parent_evidence_id: parentId } = z
      .object({ parent_evidence_id: z.string() })
      .parse(summary.normalized_result);
    const viaSummary = await compare({
      left: retained(summary.evidence_id),
      right: rightInBundle,
    });
    expect(viaSummary.evidence_links).toEqual([parentId, right.evidence_id]);
    expect(
      (await compare({ left: retained(parentId), right: rightInBundle }))
        .evidence_id,
    ).toBe(viaSummary.evidence_id);

    const summaryBundle = join(root, "with-summary.json");
    expect(
      (await call("export_evidence_bundle", { path: summaryBundle })).isError,
    ).not.toBe(true);
    const fileSummary = {
      left: {
        kind: "evidence-file",
        path: summaryBundle,
        evidence_id: summary.evidence_id,
      },
      right: rightInBundle,
    };

    // The CLI resolves relative file paths from its working directory and
    // reaches the same comparison through the shared workflow.
    for (const [input, expectedId] of [
      [
        {
          left: { kind: "evidence-file", path: "left.json" },
          right: rightInBundle,
        },
        inline.evidence_id,
      ],
      [{ left, right: rightInBundle }, inline.evidence_id],
      [fileSummary, viaSummary.evidence_id],
    ] as const) {
      const request = join(root, "request.json");
      await writeFile(request, JSON.stringify(input));
      const compared = await cli.run({
        arguments: ["compare-artifacts", request, "--json"],
        cwd: root,
      });
      expect(compared.exitCode, compared.stderr).toBe(0);
      expect(parseEvidence(compared.json).evidence_id).toBe(expectedId);
    }

    // A new server must resolve the summary's parent from its own source file.
    await client.close();
    const summaryOnly = join(root, "summary-only.json");
    await writeFile(summaryOnly, JSON.stringify(summary));
    const { call: freshCall } = await connectLocalToolsMcp({
      REA_MCP_TOOL_FAMILIES: "session,artifact",
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
      REA_MCP_OUTPUT_SCHEMA_PROFILE: profile,
      NODE_OPTIONS: "--max-old-space-size=2048",
    });
    const missingParent = await freshCall("compare_artifacts", {
      ...fileSummary,
      left: { kind: "evidence-file", path: summaryOnly },
    });
    expect(parseMcpToolError(missingParent).error).toMatchObject({
      code: "evidence_integrity_mismatch",
      details: { evidence_id: parentId, reason: "missing", actual: null },
    });
    const fresh = await freshCall("compare_artifacts", fileSummary);
    expect(fresh.isError, JSON.stringify(fresh)).not.toBe(true);
    expect(parseEvidence(fresh.structuredContent).evidence_id).toBe(
      viaSummary.evidence_id,
    );
  },
);

cliTest(
  "refuses artifact references it cannot resolve through MCP and the CLI",
  async ({ cli }) => {
    const { root, one, call, right } = await inspectedPair(
      "rea-artifact-refusals-",
    );
    // Evidence the CLI produced was never retained by this MCP session.
    const produced = await cli.run({
      arguments: ["inspect-artifact", one, "--json"],
    });
    expect(produced.exitCode, produced.stderr).toBe(0);
    const foreign = parseEvidence(produced.json);
    const missing = await call("compare_artifacts", {
      left: retained(foreign.evidence_id),
      right: retained(right.evidence_id),
    });
    expect(parseMcpToolError(missing).error).toMatchObject({
      code: "evidence_integrity_mismatch",
      details: {
        evidence_id: foreign.evidence_id,
        reason: "missing",
        actual: null,
      },
    });

    const bundle = join(root, "session.json");
    const exported = await call("export_evidence_bundle", { path: bundle });
    expect(exported.isError, JSON.stringify(exported)).not.toBe(true);
    const absent = await call("compare_artifacts", {
      left: retained(right.evidence_id),
      right: {
        kind: "evidence-file",
        path: bundle,
        evidence_id: foreign.evidence_id,
      },
    });
    expect(parseMcpToolError(absent).error).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [expect.objectContaining({ path: ["right", "evidence_id"] })],
      },
    });

    // A one-shot CLI command has no session to resolve a retained reference.
    const request = join(root, "request.json");
    await writeFile(
      request,
      JSON.stringify({
        left: retained(foreign.evidence_id),
        right: {
          kind: "evidence-file",
          path: bundle,
          evidence_id: right.evidence_id,
        },
      }),
    );
    const refused = await cli.run({
      arguments: ["compare-artifacts", request, "--json"],
    });
    expect(refused.exitCode).not.toBe(0);
    expect(refused.json).toMatchObject({
      code: "evidence_integrity_mismatch",
      details: {
        evidence_id: foreign.evidence_id,
        reason: "missing",
        actual: null,
      },
    });
  },
);
