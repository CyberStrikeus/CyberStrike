import {
  chmod,
  rm,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import {
  copyExistingGhidraProject,
  fingerprintGhidraProject,
  resolveGhidraProject,
} from "../../../../src/ghidra/GhidraProjectSnapshot.js";
import { parseConfig } from "../../../../src/config/parseConfig.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

let resources: ArtifactResourceScope;
beforeEach(() => {
  resources = new ArtifactResourceScope();
});
afterEach(async () => {
  await resources.close();
});
const fixture = async () => {
  const root = await createTestTempDirectory("rea-ghidra-selected-project-");
  const source = join(root, "source");
  const destination = join(root, "runtime", "project");
  await mkdir(join(source, "selected.rep"), { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(join(source, "selected.gpr"), "marker");
  await writeFile(join(source, "selected.rep", "data"), "original program");
  return { source, destination };
};

it.skipIf(process.platform === "win32")(
  "copies and fingerprints only the selected project, leaving unrelated siblings untouched",
  async () => {
    const { source, destination } = await fixture();
    await symlink("unrelated-missing-project", join(source, "unrelated.gpr"));
    const commitment = await resolveGhidraProject(
      { path: join(source, "selected.gpr"), programName: "target.elf" },
      { path: "/tmp/target.elf" },
      resources,
    );
    await copyExistingGhidraProject(source, destination, {
      projectName: "selected",
      expectedSha256: commitment.sha256,
      resources,
    });
    expect((await readdir(destination)).sort()).toEqual([
      "selected.gpr",
      "selected.rep",
    ]);
    expect(await fingerprintGhidraProject(source, "selected", resources)).toBe(
      commitment.sha256,
    );
    expect(
      await readFile(join(destination, "selected.rep", "data"), "utf8"),
    ).toBe("original program");
  },
);

it("rejects a project whose copied content differs from the committed analysis profile", async () => {
  const { source, destination } = await fixture();
  const original = await fingerprintGhidraProject(
    source,
    "selected",
    resources,
  );
  await writeFile(join(source, "selected.rep", "data"), "modified program");
  expect(
    await fingerprintGhidraProject(source, "selected", resources),
  ).not.toBe(original);
  await expect(
    copyExistingGhidraProject(source, destination, {
      projectName: "selected",
      expectedSha256: original,
      resources,
    }),
  ).rejects.toMatchObject({
    _tag: "AnalysisArtifactChangedError",
    cause: { name: "RegularFileChangedError" },
  });
});

it("parses an opt-in project once for shared CLI/MCP configuration and rejects import overrides", () => {
  const environment = {
    REA_GHIDRA_PROJECT_PATH: join(process.cwd(), "existing.gpr"),
    REA_GHIDRA_PROGRAM_NAME: "program.elf",
  };
  expect(parseConfig(environment)).toMatchObject({
    ok: true,
    value: {
      ghidraExistingProject: {
        path: environment.REA_GHIDRA_PROJECT_PATH,
        programName: "program.elf",
      },
    },
  });
  for (const extra of [
    { REA_GHIDRA_LANGUAGE_ID: "x86:LE:64:default" },
    { REA_GHIDRA_SEED_FILE: join(process.cwd(), "seeds") },
    { REA_GHIDRA_PROGRAM_NAME: "*" },
  ])
    expect(parseConfig({ ...environment, ...extra }).ok).toBe(false);
  expect(parseConfig({ REA_GHIDRA_PROGRAM_NAME: "program.elf" }).ok).toBe(
    false,
  );
});

it("accepts a blank analyzer override beside an existing project and rejects a named one", () => {
  const environment = {
    REA_GHIDRA_PROJECT_PATH: join(process.cwd(), "existing.gpr"),
  };
  for (const blank of ["", " ", ", ,"])
    expect(
      parseConfig({ ...environment, REA_GHIDRA_DISABLED_ANALYZERS: blank }).ok,
    ).toBe(true);
  expect(
    parseConfig({
      ...environment,
      REA_GHIDRA_DISABLED_ANALYZERS: "Decompiler Parameter ID",
    }).ok,
  ).toBe(false);
});

it("reports an invalid derived program name at its selection boundary", async () => {
  const { source } = await fixture();
  await expect(
    resolveGhidraProject(
      { path: join(source, "selected.gpr") },
      { path: "/tmp/*" },
      resources,
    ),
  ).rejects.toMatchObject({
    _tag: "ConfigurationError",
    settings: [{ setting: "REA_GHIDRA_PROGRAM_NAME" }],
  });
});

it("derives a bundle program from the resolved executable while preserving explicit names", async () => {
  const { source } = await fixture();
  const target = {
    path: join(source, "Demo.app", "Contents", "MacOS", "ActualExecutable"),
    sourcePath: join(source, "Demo.app"),
  };
  const selection = { path: join(source, "selected.gpr") };
  expect(
    (await resolveGhidraProject(selection, target, resources)).program_name,
  ).toBe("ActualExecutable");
  expect(
    (
      await resolveGhidraProject(
        { ...selection, programName: "CallerSelected" },
        target,
        resources,
      )
    ).program_name,
  ).toBe("CallerSelected");
});

it("allows selected project files beside an owned runtime under the same parent", async () => {
  const { source } = await fixture();
  const destination = join(source, "owned-runtime", "project");
  await mkdir(destination, { recursive: true });
  const sha256 = await fingerprintGhidraProject(source, "selected", resources);
  await copyExistingGhidraProject(source, destination, {
    projectName: "selected",
    expectedSha256: sha256,
    resources,
  });
  expect((await readdir(destination)).sort()).toEqual([
    "selected.gpr",
    "selected.rep",
  ]);
});

it.each([null, "caller stopped", { kind: "stop-project-read" }])(
  "preserves project cancellation and its exact reason: %j",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    await expect(
      resolveGhidraProject(
        { path: join(process.cwd(), "absent.gpr") },
        { path: "/tmp/target" },
        resources,
        controller.signal,
      ),
    ).rejects.toMatchObject({ _tag: "AnalysisCancelledError", cause: reason });
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a selected marker with a non-directory traversal before canonicalizing its parent",
  async () => {
    const root = await createTestTempDirectory("rea-ghidra-project-traversal-");
    await writeFile(join(root, "file"), "not a directory");
    await writeFile(join(root, "project.gpr"), "marker");
    await mkdir(join(root, "project.rep"));
    const path = `${root}/file/../project.gpr`;
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOTDIR" });
    await expect(
      resolveGhidraProject({ path }, { path: join(root, "target") }, resources),
    ).rejects.toMatchObject({ diagnostics: { system_code: "ENOTDIR" } });
  },
);

it("reports a missing project marker as an invalid REA_GHIDRA_PROJECT_PATH selection", async () => {
  const root = await createTestTempDirectory("rea-ghidra-project-missing-");
  await expect(
    resolveGhidraProject(
      { path: join(root, "missing", "app.gpr") },
      { path: join(root, "target") },
      resources,
    ),
  ).rejects.toMatchObject({
    _tag: "ConfigurationError",
    settings: [{ setting: "REA_GHIDRA_PROJECT_PATH" }],
    diagnostics: { system_code: "ENOENT" },
  });
});

it.skipIf(process.platform === "win32")(
  "follows native parent symlinks and preserves missing marker failures",
  async () => {
    const root = await createTestTempDirectory("rea-ghidra-project-selection-");
    await mkdir(join(root, "actual", "nested"), { recursive: true });
    await symlink("actual/nested", join(root, "link"));
    await writeFile(join(root, "actual", "project.gpr"), "marker");
    await mkdir(join(root, "actual", "project.rep"));
    const path = `${root}/link/../project.gpr`;
    const commitment = await resolveGhidraProject(
      { path },
      { path: join(root, "target") },
      resources,
    );
    expect(commitment).toMatchObject({
      configured_path: path,
      project_path: await realpath(join(root, "actual")),
      project_name: "project",
    });
    await expect(
      resolveGhidraProject(
        { path: join(root, "missing.gpr") },
        { path: join(root, "target") },
        resources,
      ),
    ).rejects.toMatchObject({ diagnostics: { system_code: "ENOENT" } });
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "preserves denied access between profile resolution and snapshot copying",
  async () => {
    const { source, destination } = await fixture();
    const project = await resolveGhidraProject(
      { path: join(source, "selected.gpr") },
      { path: "/tmp/target" },
      resources,
    );
    try {
      await chmod(source, 0);
      await expect(
        copyExistingGhidraProject(project.project_path, destination, {
          projectName: project.project_name,
          expectedSha256: project.sha256,
          resources,
        }),
      ).rejects.toMatchObject({
        _tag: "AnalysisAccessDeniedError",
        operation: "open_binary",
        systemCode: "EACCES",
        path: join(project.project_path, "selected.gpr"),
      });
    } finally {
      await chmod(source, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps missing entries and symbolic links classified as invalid selections",
  async () => {
    const { source, destination } = await fixture();
    await rm(join(source, "selected.gpr"));
    await expect(
      copyExistingGhidraProject(source, destination, {
        projectName: "selected",
      }),
    ).rejects.toMatchObject({ _tag: "ConfigurationError" });
    await writeFile(join(source, "other.gpr"), "marker");
    await symlink("other.gpr", join(source, "selected.gpr"));
    await expect(
      copyExistingGhidraProject(source, destination, {
        projectName: "selected",
      }),
    ).rejects.toMatchObject({ _tag: "ConfigurationError" });
  },
);
