import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { readEvidenceBundle } from "../../src/application/EvidenceBundleFiles.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { elfNoteFixture } from "../../src/native/elf/ElfNotes.fixture.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { safetensorsFixture } from "../fixtures/model/model.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "retains format-specific CLI selections in complete and published Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-format-caller-path-");
    const model = join(root, "model.safetensors");
    const elf = join(root, "image.elf");
    await writeFile(model, safetensorsFixture().bytes);
    await writeFile(elf, elfNoteFixture({ ownership: "program" }));
    for (const [command, selection] of [
      ["inspect-model-artifact", "./model.safetensors"],
      ["inspect-elf-notes", "./image.elf"],
      ["inspect-byte-entropy", "./image.elf"],
    ] as const) {
      const result = await cli.run({
        arguments: [command, selection, "--json"],
        cwd: root,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = parseEvidence(result.json);
      expect(evidence.caller_input_path).toBe(selection);
      expect(evidence.parameters).toMatchObject({
        path: join(root, selection.slice(2)),
      });
    }
    const summary = await cli.run({
      arguments: [
        "inspect-model-artifact",
        "./model.safetensors",
        "--detail",
        "summary",
        "--evidence_output",
        "./model-evidence.json",
        "--json",
      ],
      cwd: root,
    });
    expect(summary.exitCode, summary.stderr).toBe(0);
    expect(
      parseEvidence((summary.json as { summary: unknown }).summary)
        .caller_input_path,
    ).toBe("./model.safetensors");
    const bundle = await readEvidenceBundle(join(root, "model-evidence.json"));
    if (!bundle.ok) throw bundle.error;
    expect(
      bundle.value.records.find(
        (record) => record.operation === "inspect_model_artifact",
      )?.caller_input_path,
    ).toBe("./model.safetensors");

    const { call } = await connectLocalToolsMcp();
    const mcp = await call("inspect_model_artifact", { path: model });
    expect(mcp.isError).not.toBe(true);
    expect(parseEvidence(mcp.structuredContent)).not.toHaveProperty(
      "caller_input_path",
    );
  },
);
