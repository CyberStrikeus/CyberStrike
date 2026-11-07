import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { exportWebScripts } from "../../../src/application/WebScriptExportService.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { LocalWebScriptArtifacts } from "../../../src/browser/assets/LocalWebScriptArtifacts.js";
import { LocalWebModuleArtifacts } from "../../../src/browser/modules/WebModuleArtifacts.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { webScriptExportResultSchema } from "../../../src/domain/webScriptExport.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { scriptScenarioFixture } from "../../fixtures/webScriptCapture.js";

const fixture = async (bytes = Buffer.from('import "./dep.js";')) => {
  const root = await createTestTempDirectory("rea-module-artifacts-");
  const capturePath = join(root, "capture.json");
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  await writeFile(
    capturePath,
    JSON.stringify(
      scriptScenarioFixture([{ url: "https://app.test/main.js", bytes }]),
    ),
  );
  const response = await exportWebScripts(
    {
      capture_path: capturePath,
      output_directory: join(root, "export"),
    },
    resources,
  );
  if (!response.ok) throw response.error;
  const result = webScriptExportResultSchema.parse(
    response.value.normalized_result,
  );
  const script = result.scripts[0];
  if (script?.content.state !== "exported")
    throw new Error("fixture needs source");
  return {
    root,
    result,
    manifestPath: result.manifest.path,
    sourcePath: join(
      result.output_directory,
      "files",
      script.content.relative_path,
    ),
  };
};

describe("selected captured module artifact boundary", () => {
  it("reports selected unavailable source bytes as a capability limitation", async () => {
    const f = await fixture();
    const parsed: unknown = JSON.parse(await readFile(f.manifestPath, "utf8"));
    const manifest = webScriptExportResultSchema
      .omit({ manifest: true })
      .parse(parsed);
    const script = manifest.scripts[0];
    if (script === undefined) throw new Error("fixture script missing");
    script.content = {
      state: "unavailable",
      reason: "not-captured",
      message: "Source bytes were not selected in this capture.",
    };
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 0,
    });
    if (response.ok) throw new Error("expected unavailable source");
    expect(projectAnalysisError(response.error)).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining("not-captured"),
    });
  });
  it("verifies original bytes and tolerates relocation without inventing URL paths", async () => {
    const f = await fixture();
    const relocated = join(f.root, "relocated");
    await rename(f.result.output_directory, relocated);
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: join(relocated, "manifest.json"),
      script_index: 0,
    });
    if (!response.ok) throw response.error;
    expect(response.value.source).toBe('import "./dep.js";');
    expect(response.value.sourceFile.path.startsWith(relocated)).toBe(true);
    expect(response.value.manifest.output_directory).toBe(
      f.result.output_directory,
    );
  });
  it("reports actual and expected identities after source tampering", async () => {
    const f = await fixture();
    await writeFile(f.sourcePath, "changed");
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 0,
    });
    if (response.ok) throw new Error("expected mismatch");
    expect(projectAnalysisError(response.error).code).toBe(
      "artifact_integrity_mismatch",
    );
    expect(response.error.message).toContain("declared_sha256=");
  });
  it("rejects an unavailable index", async () => {
    const f = await fixture();
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 10,
    });
    expect(response.ok).toBe(false);
    if (!response.ok)
      expect(projectAnalysisError(response.error).code).toBe("invalid_request");
  });
  it.each(["trace_web_module_imports", "trace_web_source_location"] as const)(
    "attributes selected source UTF-8 failure to the artifact for %s",
    async (operation) => {
      const f = await fixture(Buffer.from([255, 254]));
      const response = await new LocalWebScriptArtifacts(operation).load({
        manifest_path: f.manifestPath,
        script_index: 0,
      });
      if (response.ok) throw new Error("expected invalid source bytes");
      expect(projectAnalysisError(response.error)).toMatchObject({
        code: "artifact_operation_failed",
        details: {
          operation,
          reason: "format",
          detail: expect.stringContaining(f.sourcePath),
        },
      });
      expect(projectAnalysisError(response.error).details).not.toHaveProperty(
        "issues",
      );
    },
  );
  it("rejects source symlinks even when bytes have the expected digest", async () => {
    const f = await fixture();
    const real = join(f.root, "original.js");
    await rename(f.sourcePath, real);
    await symlink(real, f.sourcePath);
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 0,
    });
    expect(response.ok).toBe(false);
  });
  it("rejects directory symlinks and traversal in selected manifest paths", async () => {
    const f = await fixture();
    const original = dirname(f.sourcePath);
    const moved = join(f.root, "moved");
    await rename(original, moved);
    await symlink(moved, original, "dir");
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 0,
    });
    expect(response.ok).toBe(false);
    const manifest: unknown = JSON.parse(
      await readFile(f.manifestPath, "utf8"),
    );
    const result = webScriptExportResultSchema
      .omit({ manifest: true })
      .parse(manifest);
    const selected = result.scripts[0];
    if (selected?.content.state !== "exported")
      throw new Error("fixture source missing");
    selected.content.relative_path = "../capture.json";
    await writeFile(f.manifestPath, JSON.stringify(result));
    const escaped = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 0,
    });
    if (escaped.ok) throw new Error("expected malformed source path");
    expect(projectAnalysisError(escaped.error)).toMatchObject({
      code: "artifact_operation_failed",
      details: {
        operation: "trace_web_module_imports",
        reason: "path",
        detail: expect.stringContaining("../capture.json"),
      },
    });
  });
  it("reads only an explicit local map and rejects non-object JSON", async () => {
    const f = await fixture();
    const map = join(f.root, "map.json");
    await writeFile(map, '{"imports":{"blocked":null}}');
    const input = {
      manifest_path: f.manifestPath,
      script_index: 0,
      import_map: { path: map, base_url: "https://map.test/base/" },
    };
    const response = await new LocalWebModuleArtifacts().load(input);
    if (!response.ok) throw response.error;
    expect(response.value.importMap?.value).toEqual({
      imports: { blocked: null },
    });
    await writeFile(map, "[]");
    expect((await new LocalWebModuleArtifacts().load(input)).ok).toBe(false);
  });
});

describe("caller-selected web module files", () => {
  const selectionIssue = (field: readonly string[], message: string) => ({
    code: "invalid_request",
    details: {
      issues: [
        {
          path: field,
          reason: "invalid_value",
          message: expect.stringContaining(message),
        },
      ],
    },
  });

  it("reports a missing or non-file manifest selection as invalid input", async () => {
    const root = await createTestTempDirectory("rea-module-missing-");
    const missing = join(root, "missing.json");
    const directory = join(root, "directory");
    await mkdir(directory);
    for (const [manifest_path, message] of [
      [missing, `(ENOENT): ${missing}`],
      [join(missing, "manifest.json"), "(ENOENT)"],
      [directory, `Expected a regular file without a symlink: ${directory}`],
    ] as const) {
      const response = await new LocalWebModuleArtifacts().load({
        manifest_path,
        script_index: 0,
      });
      if (response.ok) throw new Error("expected selection failure");
      expect(projectAnalysisError(response.error)).toMatchObject(
        selectionIssue(["manifest_path"], message),
      );
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports an unreadable manifest as a host access denial",
    async () => {
      const { manifestPath } = await fixture();
      await chmod(manifestPath, 0o000);
      onTestFinished(() => chmod(manifestPath, 0o600));
      const response = await new LocalWebModuleArtifacts().load({
        manifest_path: manifestPath,
        script_index: 0,
      });
      if (response.ok) throw new Error("expected access denial");
      expect(projectAnalysisError(response.error)).toMatchObject({
        code: "access_denied",
        details: { path: manifestPath, system_code: "EACCES" },
      });
    },
  );

  it("reports a missing import map selection as invalid input", async () => {
    const { root, manifestPath } = await fixture();
    const map = join(root, "missing-import-map.json");
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: manifestPath,
      script_index: 0,
      import_map: { path: map, base_url: "https://app.test/" },
    });
    if (response.ok) throw new Error("expected missing import map");
    expect(projectAnalysisError(response.error)).toMatchObject(
      selectionIssue(["import_map", "path"], `(ENOENT): ${map}`),
    );
  });

  it("keeps a missing manifest-derived source as an artifact fault", async () => {
    const { manifestPath, sourcePath } = await fixture();
    await rm(sourcePath);
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: manifestPath,
      script_index: 0,
    });
    if (response.ok) throw new Error("expected missing source");
    expect(response.error).toMatchObject({
      _tag: "ArtifactOperationError",
      reason: "io",
      cause: expect.objectContaining({ code: "ENOENT" }),
    });
    expect(projectAnalysisError(response.error)).toMatchObject({
      details: { detail: expect.stringContaining(`${sourcePath}:`) },
    });
    expect(projectAnalysisError(response.error).details?.detail).not.toMatch(
      /^script_index:/u,
    );
  });
});

describe("selected captured script index", () => {
  it("reports an index past the manifest's scripts as an out-of-range selection", async () => {
    const f = await fixture();
    const response = await new LocalWebModuleArtifacts().load({
      manifest_path: f.manifestPath,
      script_index: 5,
    });
    if (response.ok) throw new Error("expected an out-of-range index");
    expect(projectAnalysisError(response.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["script_index"],
            reason: "out_of_range",
            minimum: 0,
            maximum: 0,
          },
        ],
      },
    });
  });

  it("distinguishes an empty valid manifest from a malformed manifest", async () => {
    const f = await fixture();
    const parsed: unknown = JSON.parse(await readFile(f.manifestPath, "utf8"));
    const manifest = webScriptExportResultSchema
      .omit({ manifest: true })
      .parse(parsed);
    manifest.scripts = [];
    await writeFile(f.manifestPath, JSON.stringify(manifest));

    const artifacts = new LocalWebModuleArtifacts();
    const input = { manifest_path: f.manifestPath, script_index: 0 };
    const empty = await artifacts.load(input);
    if (empty.ok) throw new Error("expected an empty-manifest selection fault");
    expect(projectAnalysisError(empty.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["script_index"], reason: "invalid_value" }],
      },
    });

    await writeFile(f.manifestPath, "{");
    const malformed = await artifacts.load(input);
    if (malformed.ok) throw new Error("expected a malformed manifest fault");
    expect(projectAnalysisError(malformed.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["manifest_path"], reason: "invalid_format" }],
      },
    });
  });
});
