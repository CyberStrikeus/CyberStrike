import { Cli } from "incur";
import pino from "pino";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { registerCoreNativeCommands } from "../../../src/cli/coreNativeCommands.js";
import {
  createEvidence,
  parseEvidence,
  withEvidenceCallerInputPath,
} from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { nativeDosLoadImageFixture } from "../../fixtures/nativeLoadImage.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("preserves the relative request path in a load-image CLI summary and its complete bundle", async () => {
  const directory = await createTestTempDirectory("rea-load-image-cli-path-");
  const destination = join(directory, "complete.json");
  const selectedPath = "./alias/../selected.exe";
  const parent = withEvidenceCallerInputPath(
    createEvidence(
      { path: "/selected.exe", sha256: "a".repeat(64), format: "dos-mz" },
      { id: "ghidra", name: "Ghidra", version: "12.1.4" },
      {
        operation: "inspect_native_load_image",
        parameters: {},
        result: nativeDosLoadImageFixture(),
      },
    ),
    selectedPath,
  );
  const run = vi.fn(async () => ({ ok: true as const, value: parent }));
  const cli = Cli.create("rea-load-image-cli-test", { sync: false });
  registerCoreNativeCommands(cli, pino({ enabled: false }), run);
  let stdout = "";
  await cli.serve(
    [
      "inspect-native-load-image",
      selectedPath,
      "--detail",
      "summary",
      "--evidence_output",
      destination,
      "--json",
    ],
    {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => undefined,
    },
  );
  const receipt = JSON.parse(stdout);
  const summary = parseEvidence(receipt.summary);
  expect(summary.caller_input_path).toBe(selectedPath);
  expect(run).toHaveBeenCalledExactlyOnceWith(
    selectedPath,
    "inspect_native_load_image",
    {},
    expect.any(Object),
  );
  const bundle = parseEvidenceBundle(
    JSON.parse(await readFile(destination, "utf8")),
  );
  expect(bundle.records).toEqual([parent]);
  expect(summary.normalized_result).toMatchObject({
    parent_evidence_id: parent.evidence_id,
  });
  const later = await inspectAnalysisView({
    source: { kind: "inline", evidence: parent },
    view: { kind: "summary" },
  });
  if (!later.ok) throw later.error;
  expect(later.value).not.toHaveProperty("caller_input_path");
  expect(later.value.evidence_id).toBe(summary.evidence_id);
});
