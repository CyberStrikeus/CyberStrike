import { Cli } from "incur";
import pino from "pino";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { registerCoreBinaryCommands } from "../../../src/cli/coreBinaryCommands.js";
import type { CliInstance } from "../../../src/cli/types.js";
import { CLI_COMMANDS } from "../../../src/cliCommandNames.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import { ok } from "../../../src/domain/result.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// A complete analyze_function Evidence as runDirectAnalysis would return it:
// subject-bound (so the summary view has an artifact) with a schema-valid dossier.
const cannedCompleteEvidence = () =>
  createEvidence(
    { path: "/fixtures/native.exe", format: "pe", sha256: "a".repeat(64) },
    { id: "ghidra", name: "Ghidra", version: "12.1.4" },
    {
      operation: "analyze_function",
      parameters: { procedure: "main" },
      result: functionDossierSchema.parse(ghidraFunctionDossier()),
      rawResult: null,
    },
  );

const harness = () => {
  const runDirectAnalysis = vi.fn<
    Parameters<typeof registerCoreBinaryCommands>[2]
  >(async () => ok(cannedCompleteEvidence()));
  const cli = Cli.create("rea-fn-detail-test", { version: "1", sync: false });
  registerCoreBinaryCommands(
    cli as unknown as CliInstance,
    pino({ enabled: false }),
    runDirectAnalysis,
    {},
  );
  const command = Cli.toCommands.get(cli)?.get(CLI_COMMANDS.function);
  if (command === undefined)
    throw new Error("function command was not registered");
  const argsSchema = Reflect.get(command, "args");
  const optionsSchema = Reflect.get(command, "options");
  const execute = Reflect.get(command, "run");
  if (typeof execute !== "function")
    throw new Error("function command has no run callback");
  const invoke = (options: Record<string, unknown>): Promise<unknown> =>
    execute({
      args: (argsSchema as { parse(v: unknown): unknown }).parse({
        path: "/fixtures/native.exe",
        address: "main",
      }),
      options: (optionsSchema as { parse(v: unknown): unknown }).parse(options),
    });
  return { runDirectAnalysis, invoke };
};

it("defaults to the complete dossier and runs analysis", async () => {
  const h = harness();
  const out = (await h.invoke({})) as { operation?: string };
  expect(h.runDirectAnalysis).toHaveBeenCalledOnce();
  expect(out.operation).toBe("analyze_function");
  expect(
    (out as { normalized_result?: unknown }).normalized_result,
  ).toBeDefined();
});

it("rejects summary delivery without --evidence_output before any analysis", async () => {
  const h = harness();
  const out = await h.invoke({ detail: "summary" });
  expect(h.runDirectAnalysis).not.toHaveBeenCalled();
  expect(JSON.stringify(out)).toContain("evidence_output");
});

it("summary delivery returns the compact view and writes a bundle inspect-analysis-view pages", async () => {
  const h = harness();
  const directory = await createTestTempDirectory("rea-fn-detail-");
  const destination = join(directory, "complete.json");
  const out = (await h.invoke({
    detail: "summary",
    evidence_output: destination,
  })) as {
    summary: {
      normalized_result: { kind: string; parent_evidence_id: string };
    };
    evidence_bundle: { path: string; bytes: number };
  };
  expect(h.runDirectAnalysis).toHaveBeenCalledOnce();
  expect(out.summary.normalized_result.kind).toBe("summary");
  expect(typeof out.summary.normalized_result.parent_evidence_id).toBe(
    "string",
  );
  expect(out.evidence_bundle.bytes).toBeGreaterThan(0);
  expect((await stat(destination)).size).toBeGreaterThan(0);
  // The saved bundle is the evidence-file source inspect-analysis-view reads back.
  const parentId = out.summary.normalized_result.parent_evidence_id;
  const page = await inspectAnalysisView({
    source: { kind: "evidence-file", path: destination, evidence_id: parentId },
    view: { kind: "native", facet: "pseudocode", offset: 0, limit: 16 },
  });
  if (!page.ok) throw page.error;
  expect(page.value.parameters).toMatchObject({ parent_evidence_id: parentId });
  expect(page.value.normalized_result).toMatchObject({
    kind: "native",
    item: {
      text: functionDossierSchema
        .parse(ghidraFunctionDossier())
        .pseudocode.slice(0, 16),
    },
  });
});
