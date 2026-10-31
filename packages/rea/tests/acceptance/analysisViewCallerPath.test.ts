import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { analysisViewResultSchema } from "../../src/domain/analysisView/analysisView.js";
import {
  analysisViewJavaScriptEvidence,
  analysisViewLayoutEvidence,
} from "../fixtures/analysisView.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest
  .skipIf(process.platform === "win32")
  .for(["relative", "absolute"] as const)(
  "reads selected analysis-view Evidence through a %s caller path containing a symlink parent",
  async (pathKind, { cli }) => {
    const root = await createTestTempDirectory(
      "rea-analysis-view-caller-path-",
    );
    await mkdir(join(root, "real", "inner"), { recursive: true });
    await symlink("real/inner", join(root, "link"));

    const selected = analysisViewJavaScriptEvidence();
    const decoy = analysisViewLayoutEvidence();
    expect(selected.evidence_id).not.toBe(decoy.evidence_id);
    await writeFile(
      join(root, "real", "evidence.json"),
      JSON.stringify(selected),
    );
    await writeFile(join(root, "evidence.json"), JSON.stringify(decoy));

    const sourcePath =
      pathKind === "relative"
        ? "link/../evidence.json"
        : `${root}/link/../evidence.json`;
    const queryPath = join(root, "query.json");
    await writeFile(
      queryPath,
      JSON.stringify({
        source: { kind: "evidence-file", path: sourcePath },
        view: { kind: "summary" },
      }),
    );

    const result = await cli.run({
      arguments: ["inspect-analysis-view", queryPath, "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);

    const contractResult = toolContract(
      "inspect_analysis_view",
    ).outputSchema.parse(result.json);
    const output = parseEvidence(contractResult);
    const view = analysisViewResultSchema.parse(output.normalized_result);
    expect(view.kind).toBe("summary");
    expect(view.parent_evidence_id).toBe(selected.evidence_id);
    expect(output.evidence_links).toEqual([selected.evidence_id]);
  },
);
