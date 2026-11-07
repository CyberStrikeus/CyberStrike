import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  environmentServeFixture,
  environmentServeSource,
  writeEnvironmentServeFiles,
} from "../../../tests/fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { PACKAGE_METADATA } from "../../generatedPackageMetadata.js";
import {
  exportEnvironmentBundle,
  readEnvironmentExportInputs,
} from "./environmentExport.js";

const listFiles = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .split(sep)
        .join("/"),
    )
    .sort();

const prepare = async (prefix: string) => {
  const root = await createTestTempDirectory(prefix);
  const fixture = environmentServeFixture();
  const files = await writeEnvironmentServeFiles(root, fixture);
  const inputs = await readEnvironmentExportInputs(
    files.manifestPath,
    files.capturePath,
  );
  if (!inputs.ok) throw inputs.error;
  return {
    root,
    files,
    input: { ...inputs.value, source: environmentServeSource(fixture) },
    directory: join(root, "bundle"),
  };
};

describe("readEnvironmentExportInputs", () => {
  it("reads each file once as the bytes on disk and the value they parse to", async () => {
    const root = await createTestTempDirectory("rea-environment-inputs-");
    const fixture = environmentServeFixture();
    const files = await writeEnvironmentServeFiles(root, fixture);
    const inputs = await readEnvironmentExportInputs(
      files.manifestPath,
      files.capturePath,
    );
    if (!inputs.ok) throw inputs.error;
    expect(inputs.value.manifest.path).toBe(files.manifestPath);
    expect(
      Buffer.compare(
        inputs.value.manifest.bytes,
        await readFile(files.manifestPath),
      ),
    ).toBe(0);
    expect(inputs.value.manifest.value).toEqual(fixture.manifest);
    expect(
      Buffer.compare(
        inputs.value.evidence.bytes,
        await readFile(files.capturePath),
      ),
    ).toBe(0);
    expect(inputs.value.evidence.value).toEqual(fixture.capture);
  });

  it("refuses inline JSON, a directory and a file that is not JSON by role", async () => {
    const root = await createTestTempDirectory("rea-environment-inputs-bad-");
    const files = await writeEnvironmentServeFiles(root);
    const inline = await readEnvironmentExportInputs(
      await readFile(files.manifestPath, "utf8"),
      files.capturePath,
    );
    if (inline.ok) throw new Error("Expected the inline manifest refusal");
    expect(projectAnalysisError(inline.error)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "environment-export",
        issues: [{ path: ["manifest"], reason: "invalid_value" }],
      },
    });
    const directory = await readEnvironmentExportInputs(
      files.manifestPath,
      root,
    );
    if (directory.ok) throw new Error("Expected the directory refusal");
    expect(projectAnalysisError(directory.error).details?.issues).toEqual([
      expect.objectContaining({ path: ["evidence"], reason: "invalid_value" }),
    ]);
    const broken = join(root, "broken.json");
    await writeFile(broken, '{"evidence_id": ');
    const notJson = await readEnvironmentExportInputs(
      files.manifestPath,
      broken,
    );
    if (notJson.ok) throw new Error("Expected the malformed JSON refusal");
    expect(projectAnalysisError(notJson.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          { path: ["evidence"], reason: "invalid_format", expected: "JSON" },
        ],
      },
    });
    expect(projectAnalysisError(notJson.error).message).toContain(broken);
  });
});

const registerBundlePublicationCases = () => {
  it("writes the bundle into an absent directory with the read bytes copied unchanged", async () => {
    const { root, files, input, directory } = await prepare(
      "rea-environment-export-",
    );
    const exported = await exportEnvironmentBundle({ ...input, directory });
    if (!exported.ok) throw exported.error;
    expect(exported.value).toMatchObject({
      status: "exported",
      directory,
      name: "grafana-example",
      // The bundle serves the state the export derived: the manifest's read tools.
      tool_count: 14,
      evidence_id: input.source.evidenceId,
      manifest_evidence_id: input.source.manifestEvidenceId,
      state: { served: true, evidence_id: expect.stringMatching(/^ev_/u) },
      package_source: {
        kind: "registry",
        specifier: `rea-agents@${PACKAGE_METADATA.version}`,
      },
    });
    const written = exported.value.files.map((file) => file.path).sort();
    expect(written).toEqual(await listFiles(directory));
    expect(written).toEqual([
      "README.md",
      "artifacts/check_grafana-example/verify.py",
      "envs/grafana-example/Dockerfile",
      "envs/grafana-example/env.toml",
      "envs/grafana-example/evidence.json",
      "envs/grafana-example/manifest.json",
      "tasks/smoke.json",
    ]);
    for (const file of exported.value.files)
      expect(file.bytes).toBe(
        (await readFile(join(directory, file.path))).length,
      );
    expect(
      Buffer.compare(
        await readFile(join(directory, "envs/grafana-example/manifest.json")),
        await readFile(files.manifestPath),
      ),
    ).toBe(0);
    expect(
      Buffer.compare(
        await readFile(join(directory, "envs/grafana-example/evidence.json")),
        input.evidence.bytes,
      ),
    ).toBe(0);
    expect(await listFiles(root)).toEqual(
      expect.arrayContaining(["capture.json", "manifest.json"]),
    );
  });

  it("copies the package tarball beside the Dockerfile and reports it as the package source", async () => {
    const { root, input, directory } = await prepare(
      "rea-environment-export-tarball-",
    );
    const tarball = join(root, "rea-agents-0.0.0.tgz");
    await writeFile(tarball, Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]));
    const exported = await exportEnvironmentBundle({
      ...input,
      directory,
      packageTarball: tarball,
      name: "replay-copy",
    });
    if (!exported.ok) throw exported.error;
    expect(exported.value.package_source).toEqual({
      kind: "tarball",
      path: tarball,
    });
    expect(exported.value.files).toContainEqual({
      path: "envs/replay-copy/rea-agents.tgz",
      bytes: 7,
    });
    expect(
      Buffer.compare(
        await readFile(join(directory, "envs/replay-copy/rea-agents.tgz")),
        await readFile(tarball),
      ),
    ).toBe(0);
    expect(
      await readFile(join(directory, "envs/replay-copy/Dockerfile"), "utf8"),
    ).toContain("COPY rea-agents.tgz /tmp/");
  });
};

const registerBundleDestinationAdmissionCases = () => {
  it("refuses a non-empty directory, a file path and a missing tarball before writing anything", async () => {
    const { root, input, directory } = await prepare(
      "rea-environment-export-refusals-",
    );
    await mkdir(directory);
    await writeFile(join(directory, "keep.txt"), "existing");
    const nonEmpty = await exportEnvironmentBundle({ ...input, directory });
    if (nonEmpty.ok)
      throw new Error("Expected the non-empty directory refusal");
    expect(projectAnalysisError(nonEmpty.error)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "environment-export",
        issues: [{ path: ["directory"], reason: "invalid_value" }],
      },
    });
    expect(projectAnalysisError(nonEmpty.error).message).toContain("not empty");
    expect(await listFiles(directory)).toEqual(["keep.txt"]);
    const asFile = await exportEnvironmentBundle({
      ...input,
      directory: join(directory, "keep.txt"),
    });
    if (asFile.ok) throw new Error("Expected the file path refusal");
    expect(projectAnalysisError(asFile.error).details?.issues).toEqual([
      expect.objectContaining({ path: ["directory"] }),
    ]);
    const fileRefusal = projectAnalysisError(asFile.error);
    expect(fileRefusal.message).toContain("must be a directory");
    expect(fileRefusal.message).not.toContain("identity changed");
    expect(fileRefusal.details?.issues).toEqual([
      expect.objectContaining({ message: fileRefusal.message }),
    ]);
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe(
      "existing",
    );
    const missingTarball = await exportEnvironmentBundle({
      ...input,
      directory: join(root, "fresh"),
      packageTarball: join(root, "absent.tgz"),
    });
    if (missingTarball.ok) throw new Error("Expected the tarball refusal");
    expect(projectAnalysisError(missingTarball.error).details?.issues).toEqual([
      expect.objectContaining({ path: ["package_tarball"] }),
    ]);
    expect(await listFiles(root)).not.toContain("fresh/README.md");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "distinguishes denied output writing from denied input reading and recovers with the same inputs",
    async () => {
      const { input, directory, files } = await prepare(
        "rea-environment-export-denied-",
      );
      await mkdir(directory, { mode: 0o500 });
      try {
        const denied = await exportEnvironmentBundle({ ...input, directory });
        if (denied.ok) throw new Error("Expected write denial");
        expect(projectAnalysisError(denied.error)).toMatchObject({
          message: expect.stringContaining("denied writing"),
          remediation: {
            action: expect.stringContaining("writable destination"),
          },
          details: {
            diagnostics: {
              boundary: "filesystem-write",
              system_code: "EACCES",
            },
          },
        });
        expect(await readdir(directory)).toEqual([]);
        await chmod(files.manifestPath, 0);
        const readDenied = await readEnvironmentExportInputs(
          files.manifestPath,
          files.capturePath,
        );
        if (readDenied.ok) throw new Error("Expected read denial");
        expect(readDenied.error).toMatchObject({
          _tag: "AnalysisAccessDeniedError",
          path: files.manifestPath,
          cause: { code: "EACCES", path: files.manifestPath },
        });
        expect(projectAnalysisError(readDenied.error)).toMatchObject({
          code: "access_denied",
          details: { boundary: "filesystem-read" },
        });
      } finally {
        await chmod(directory, 0o700);
        await chmod(files.manifestPath, 0o600);
      }
      expect((await exportEnvironmentBundle({ ...input, directory })).ok).toBe(
        true,
      );
    },
  );

  it("accepts an existing empty directory", async () => {
    const { input, directory } = await prepare("rea-environment-export-empty-");
    await mkdir(directory);
    const exported = await exportEnvironmentBundle({ ...input, directory });
    expect(exported.ok).toBe(true);
    expect(await listFiles(directory)).toHaveLength(7);
  });
};

describe("exportEnvironmentBundle", () => {
  registerBundlePublicationCases();
  registerBundleDestinationAdmissionCases();
});

describe("exportEnvironmentBundle file modes", () => {
  it.skipIf(process.platform === "win32")(
    "writes the captured manifest and Evidence copies readable by their owner only",
    async () => {
      const { input, directory } = await prepare(
        "rea-environment-export-mode-",
      );
      const exported = await exportEnvironmentBundle({ ...input, directory });
      if (!exported.ok) throw exported.error;
      for (const copy of ["manifest.json", "evidence.json"]) {
        const { mode } = await stat(
          join(directory, "envs/grafana-example", copy),
        );
        expect(mode & 0o777).toBe(0o600);
      }
    },
  );
});
