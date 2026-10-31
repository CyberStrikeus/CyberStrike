import { readEvidenceBundle } from "../../../src/application/EvidenceBundleFiles.js";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createDesktopApplicationService } from "../../../src/composition/desktop.js";
import { parseEvidence } from "../../../src/domain/evidence.js";

cliTest(
  "rejects an empty desktop selection while explicit . selects the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-desktop-empty-");
    await writeFile(join(root, "marker.txt"), "selected cwd control");
    const empty = await cli.run({
      arguments: ["inspect-desktop-application", "", "--json"],
      cwd: root,
    });
    expect(empty.exitCode).not.toBe(0);
    expect(empty.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({ path: "path", code: "too_small" }),
      ]),
    });
    const explicit = await cli.run({
      arguments: ["inspect-desktop-application", ".", "--json"],
      cwd: root,
    });
    expect(explicit.exitCode).toBe(0);
    expect(parseEvidence(explicit.json).normalized_result).toMatchObject({
      files: [{ path: "marker.txt" }],
    });
  },
);

cliTest(
  "shares directory facts and exact retained-field semantics with the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-desktop-cli-");
    const installation = join(root, "installation");
    await mkdir(join(installation, "resources"), { recursive: true });
    await writeFile(
      join(installation, "resources/app.asar"),
      "path convention",
    );
    const refused = await cli.run({
      arguments: [
        "inspect-desktop-application",
        join(root, "must-not-be-read"),
        "--detail",
        "summary",
        "--json",
      ],
    });
    expect(refused.exitCode).not.toBe(0);
    expect(refused.json).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "inspect_desktop_application",
        issues: [{ path: ["evidence_output"] }],
      },
    });
    const response = await cli.run({
      arguments: ["inspect-desktop-application", installation, "--json"],
    });
    expect(response.exitCode).toBe(0);
    const evidence = parseEvidence(response.json);
    const service = createDesktopApplicationService();
    try {
      const source = await service.inspect({ path: installation });
      if (!source.ok) throw source.error;
      expect(evidence).toEqual(source.value);
    } finally {
      await service.close();
    }
    const query = join(root, "view.json");
    await writeFile(
      query,
      JSON.stringify({
        source: { kind: "inline", evidence },
        view: {
          kind: "desktop-application",
          collection: "candidates",
          families: ["electron"],
          fields: ["family"],
          limit: 1,
        },
      }),
    );
    const page = await cli.run({
      arguments: ["inspect-analysis-view", query, "--json"],
    });
    expect(page.exitCode).toBe(0);
    expect(parseEvidence(page.json).normalized_result).toMatchObject({
      items: [{ candidate_id: expect.any(String), family: "electron" }],
      coverage: { total: 1, exhausted: true },
    });
    const bundlePath = join(root, "complete-evidence.json");
    const compact = await cli.run({
      arguments: [
        "inspect-desktop-application",
        installation,
        "--detail",
        "summary",
        "--evidence_output",
        bundlePath,
        "--json",
      ],
    });
    expect(compact.exitCode).toBe(0);
    expect(compact.json).toMatchObject({
      evidence_bundle: { path: bundlePath, bytes: expect.any(Number) },
      summary: {
        normalized_result: {
          kind: "summary",
          parent_evidence_id: evidence.evidence_id,
        },
      },
    });
    const saved = await readEvidenceBundle(bundlePath);
    if (!saved.ok) throw saved.error;
    expect(saved.value.records).toEqual([evidence]);
    const overwrite = await cli.run({
      arguments: [
        "inspect-desktop-application",
        installation,
        "--detail",
        "summary",
        "--evidence_output",
        bundlePath,
        "--json",
      ],
    });
    expect(overwrite.exitCode).not.toBe(0);
  },
);

cliTest(
  "refuses a non-directory or missing root as a target selection",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-desktop-cli-root-");
    const file = join(root, "regular-file");
    await writeFile(file, "fixture\n");
    const notDirectory = await cli.run({
      arguments: ["inspect-desktop-application", file, "--json"],
    });
    expect(notDirectory.exitCode).toBe(1);
    expect(notDirectory.json).toMatchObject({
      code: "unsupported_target",
      category: "unsupported_target",
      details: { operation: "inspect_desktop_application", path: file },
    });
    const missingPath = join(root, "missing-directory");
    const missing = await cli.run({
      arguments: ["inspect-desktop-application", missingPath, "--json"],
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.json).toMatchObject({
      code: "target_unavailable",
      category: "unavailable",
      details: { path: missingPath, reason: expect.stringContaining("ENOENT") },
    });
  },
);

cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports a read-denied root as host access denial with read-access recovery",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-desktop-cli-denied-");
    const locked = join(root, "locked-directory");
    await mkdir(locked);
    await chmod(locked, 0o000);
    try {
      const denied = await cli.run({
        arguments: ["inspect-desktop-application", locked, "--json"],
      });
      expect(denied.exitCode).toBe(1);
      expect(denied.json).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        remediation: { action: expect.stringContaining("read access") },
        details: {
          path: locked,
          system_code: "EACCES",
          boundary: "filesystem-read",
          partial_observation: expect.any(Object),
        },
      });
    } finally {
      await chmod(locked, 0o700);
    }
  },
);
