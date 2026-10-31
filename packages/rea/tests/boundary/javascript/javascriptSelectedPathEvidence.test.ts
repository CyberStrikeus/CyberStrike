import {
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { parseApplicationGraphEvidence } from "../../../src/application/javascript/JavaScriptApplicationEvidenceGraph.js";
import { JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE } from "../../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains selected JavaScript path separately from resolved identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-selected-path-");
    const physicalPath = join(root, "physical-app");
    const selectedPath = join(root, "selected-app");
    await mkdir(physicalPath);
    await writeFile(join(physicalPath, "main.js"), "export const value = 7;\n");
    await symlink(
      physicalPath,
      selectedPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    const resolvedPath = await realpath(physicalPath);
    expect(await realpath(selectedPath)).toBe(resolvedPath);

    const cliResponse = await cli.run({
      arguments: [
        "analyze-javascript-application",
        selectedPath,
        "--artifact-format",
        "directory",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(cliResponse.exitCode, cliResponse.stderr).toBe(0);
    const cliEvidence = parseEvidence(cliResponse.json);

    for (const command of ["analyze", "analyze-javascript-application"]) {
      const relativeResponse = await cli.run({
        arguments: [command, "./selected-app", "--json"],
        cwd: root,
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(relativeResponse.exitCode, relativeResponse.stderr).toBe(0);
      const relativeEvidence = parseEvidence(relativeResponse.json);
      expect(relativeEvidence.parameters.input_path, command).toBe(
        selectedPath,
      );
      expect(relativeEvidence.subject).toEqual(cliEvidence.subject);
      expect(relativeEvidence.normalized_result).toEqual(
        cliEvidence.normalized_result,
      );
    }

    const { call } = await connectLocalToolsMcp({ REA_LOG_LEVEL: "silent" });
    const aliasResponse = await call("analyze_javascript_application", {
      input_path: selectedPath,
      format: "directory",
      integrity_policy: "fail",
    });
    expect(
      aliasResponse.isError,
      JSON.stringify(aliasResponse.content),
    ).not.toBe(true);
    const aliasEvidence = parseEvidence(aliasResponse.structuredContent);
    const physicalResponse = await call("analyze_javascript_application", {
      input_path: physicalPath,
      format: "directory",
      integrity_policy: "fail",
    });
    expect(
      physicalResponse.isError,
      JSON.stringify(physicalResponse.content),
    ).not.toBe(true);
    const physicalEvidence = parseEvidence(physicalResponse.structuredContent);

    for (const evidence of [cliEvidence, aliasEvidence]) {
      expect(evidence.parameters.input_path).toBe(selectedPath);
      expect(evidence.subject?.local_path).toBe(resolvedPath);
      expect(evidence.normalized_result).toMatchObject({
        input_path: resolvedPath,
      });
      expect(parseApplicationGraphEvidence(evidence).ok).toBe(true);
    }
    expect(cliEvidence.normalized_result).toEqual(
      aliasEvidence.normalized_result,
    );
    expect(physicalEvidence.parameters.input_path).toBe(physicalPath);
    expect(physicalEvidence.subject?.local_path).toBe(resolvedPath);
    expect(physicalEvidence.normalized_result).toEqual(
      aliasEvidence.normalized_result,
    );
    expect(physicalEvidence.subject?.digest.sha256).toBe(
      aliasEvidence.subject?.digest.sha256,
    );
    expect(physicalEvidence.evidence_id).not.toBe(aliasEvidence.evidence_id);
    const bundlePath = join(root, "retained-evidence.json");
    expect(
      (await call("export_evidence_bundle", { path: bundlePath })).isError,
    ).not.toBe(true);
    await rm(selectedPath);
    await rm(physicalPath, { recursive: true });
    const bundle = parseEvidenceBundle(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    const retained = bundle.records.find(
      (record) => record.evidence_id === aliasEvidence.evidence_id,
    );
    expect(retained?.parameters.input_path).toBe(selectedPath);
    for (const evidence of [
      cliEvidence,
      aliasEvidence,
      physicalEvidence,
      retained,
    ])
      expect(
        parseApplicationGraphEvidence(JSON.parse(JSON.stringify(evidence))).ok,
      ).toBe(true);
    expect((await call("close_binary", {})).isError).not.toBe(true);
    expect(
      (await call("import_evidence_bundle", { path: bundlePath })).isError,
    ).not.toBe(true);

    expect(
      JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE.parameters,
    ).not.toHaveProperty("input_path");
    expect(
      parseApplicationGraphEvidence(JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE).ok,
    ).toBe(true);
  },
);

// Anchoring must not turn an empty selection into the working directory.
cliTest.for([
  {
    command: "analyze-javascript-application",
    rejection: {
      code: "invalid_request",
      details: { issues: [expect.objectContaining({ path: ["input_path"] })] },
    },
  },
  { command: "analyze", rejection: { code: "VALIDATION_ERROR" } },
])(
  "$command rejects an empty path instead of analyzing the working directory",
  async ({ command, rejection }, { cli }) => {
    const root = await createTestTempDirectory("rea-js-empty-path-");
    await writeFile(join(root, "main.js"), "export const value = 7;\n");
    const response = await cli.run({
      arguments: [command, "", "--json"],
      cwd: root,
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, response.stderr).toBe(1);
    expect(response.json).toMatchObject(rejection);
  },
);
