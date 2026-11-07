import { execFile, spawnSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { inspectModuleBoundaries } from "../../scripts/lib/module-boundaries.mjs";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { writeRepositoryOxlintConfiguration } from "../fixtures/oxlintConfiguration.js";

describe("process capture implementation ownership", () => {
  it.each([
    ["../../application/process/ProcessEvidence.js", false],
    ["../../composition/binary.js", false],
    ["../../server/createServer.js", false],
    ["../../cli.ts", false],
    ["../../main.js", false],
    ["../../domain/process/processEvidenceProvider.js", true],
    ["../ProcessOwnership.js", true],
    ["../../windows/WindowsOwnedProcess.js", true],
    ["./TerminalRenderer.js", true],
  ])("checks capture importing %s", (dependency, allowed) => {
    const violations = inspectModuleBoundaries(
      "src/process/capture/ProcessHarness.ts",
      `import { value } from "${dependency}";`,
      process.cwd(),
    );
    if (allowed) expect(violations).toEqual([]);
    else expect(violations).toMatchObject([{ boundary: "process-capture" }]);
  });
});

describe("binary production construction ownership", () => {
  it.each([
    "hopper/HopperProvider.js",
    "ghidra/GhidraProvider.js",
    "ida/IdaProvider.js",
    "artifacts/ArtifactProvider.js",
    "dotnet/ManagedStaticProvider.js",
    "native/NativeMacOSProvider.js",
  ])("keeps %s in production composition", (provider) => {
    const source = `import { Provider } from "../${provider}";`;
    for (const file of ["src/application/runtime.ts", "src/server/probe.ts"])
      expect(
        inspectModuleBoundaries(file, source, process.cwd()),
      ).toMatchObject([{ boundary: "provider-construction" }]);
    expect(
      inspectModuleBoundaries(
        "src/composition/binary.ts",
        source,
        process.cwd(),
      ),
    ).toEqual([]);
  });

  it("rejects the former runtime composition exception", () => {
    expect(
      inspectModuleBoundaries(
        "src/application/runtime.ts",
        'export { createBinarySession } from "../composition/binary.js";',
        process.cwd(),
      ),
    ).toMatchObject([{ boundary: "application-composition" }]);
  });
});

const execute = promisify(execFile);
const verifier = resolve("scripts/verify-module-boundaries.mjs");

describe("incremental module import boundaries", () => {
  it.each([
    ["src/domain/probe.ts", "../application/Workflow.js", false],
    ["src/domain/probe.ts", "../browser/Provider.js", false],
    ["src/contracts/probe.ts", "../android/Provider.js", false],
    ["src/contracts/probe.ts", "../cli.js", false],
    ["src/contracts/probe.ts", "../composition/android.js", false],
    [
      "src/artifacts/javascript/probe.ts",
      "../../application/javascript/JavaScriptArtifactReconstruction.js",
      false,
    ],
    [
      "src/artifacts/javascript/probe.ts",
      "../../composition/android.js",
      false,
    ],
    ["src/artifacts/javascript/probe.ts", "../../cli.js", false],
    [
      "src/artifacts/ArtifactHash.ts",
      "../application/artifacts/ArtifactExtractionDestination.js",
      false,
    ],
    [
      "src/artifacts/javascript/probe.ts",
      "../../domain/artifactInventorySnapshot.js",
      true,
    ],
    ["src/artifacts/javascript/probe.ts", "../AsarArtifactReader.js", true],
    [
      "src/application/javascript/probe.ts",
      "../../artifacts/AsarArtifactReader.js",
      false,
    ],
    [
      "src/application/javascript/probe.ts",
      "../../artifacts/DirectoryArtifactReader.js",
      false,
    ],
    [
      "src/application/javascript/probe.ts",
      "../../artifacts/javascript/JavaScriptArtifactReader.js",
      true,
    ],
    ["src/artifacts/inventory/probe.ts", "../AsarArtifactReader.js", true],
    ["src/domain/probe.test.ts", "../composition/firmware.js", false],
    ["src/application/probe.ts", "../android/JadxProvider.js", false],
    ["src/application/probe.ts", "../composition/android.js", false],
    ["src/server/probe.ts", "../firmware/FirmwareProvider.js", false],
    ["src/server/probe.ts", "../browser/CdpBrowserProvider.js", false],
    ["src/application/probe.ts", "../inspector/V8InspectorProvider.js", false],
    ["src/server/probe.ts", "../inspector/V8InspectorEndpoint.js", false],
    ["src/composition/probe.ts", "../inspector/V8InspectorProvider.js", true],
    ["src/composition/probe.ts", "../browser/CdpBrowserProvider.js", true],
    [
      "src/application/probe.ts",
      "../javascript/recovery/WakaruProvider.js",
      false,
    ],
    ["src/domain/probe.ts", "../javascript/recovery/WakaruReport.js", false],
    ["src/server/probe.ts", "../javascript/recovery/WakaruProvider.js", false],
    ["src/domain/probe.ts", "./result.js", true],
    ["src/contracts/probe.ts", "../domain/result.js", true],
    ["src/application/probe.ts", "../domain/result.js", true],
    ["src/composition/probe.ts", "../ghidra/Provider.js", true],
    ["src/composition/probe.ts", "../android/JadxProvider.js", true],
    ["src/composition/probe.ts", "../firmware/FirmwareProvider.js", true],
    ["src/domain/android/probe.ts", "./types.js", true],
    ["src/domain/javascript/probe.ts", "./types.js", true],
    ["src/domain/inspector/probe.ts", "./types.js", true],
    ["src/domain/firmware/probe.ts", "../android/types.js", true],
    ["src/domain/android/probe.ts", "../../android/JadxProvider.js", false],
    ["src/application/android/probe.ts", "../../domain/android/types.js", true],
    [
      "src/application/android/probe.ts",
      "../../android/JadxProvider.js",
      false,
    ],
    ["src/application/runtime.ts", "../android/JadxProvider.js", false],
    [
      "src/application/android/runtime.ts",
      "../../android/JadxProvider.js",
      false,
    ],
    [
      "src/application/probe.test.ts",
      "../browser/CdpBrowserProvider.js",
      false,
    ],
    ["src/domain/probe.test.ts", "../dotnet/ManagedMemberInspector.js", false],
    ["src/server/probe.ts", "../composition/android.js", true],
    ["src/application/probe.ts", "../browser/CdpCaptureValues.js", true],
    ["src/ghidra/probe.ts", "../generatedPackageMetadata.js", true],
    ["src/hopper/probe.ts", "../contracts/officialToolContracts.js", true],
  ])("checks %s importing %s", (file, dependency, allowed) => {
    const violations = inspectModuleBoundaries(
      file,
      `import { value } from ${JSON.stringify(dependency)}; export { value };\n`,
      process.cwd(),
    );
    if (allowed) expect(violations).toEqual([]);
    else
      expect(violations).toMatchObject([
        { file, boundary: expect.any(String) },
      ]);
  });
});

describe("module import syntax and source discovery", () => {
  it.each([
    'import { value } from "../android/Provider.js";',
    'import type { Value } from "../android/Provider.js";',
    'export { value } from "../android/Provider.js";',
    'export * from "../android/Provider.js";',
    'type Value = import("../android/Provider.js").Value;',
    'const loaded = import("../android/Provider.js");',
    "const loaded = import(`../android/Provider.js`);",
    'import provider = require("../android/Provider.js");',
    'import { value } from "../domain/../android/Provider.js";',
    'const loaded = import("../%61ndroid/Provider.js?view=one#fragment");',
  ])("checks the resolved owner in %s", (source) => {
    expect(
      inspectModuleBoundaries("src/domain/probe.ts", source, process.cwd()),
    ).toEqual([
      expect.objectContaining({
        target: "src/android/Provider.js",
        boundary: "pure-layer",
      }),
    ]);
  });

  it("ignores imports mentioned in comments and analyst fixture strings", () => {
    expect(
      inspectModuleBoundaries(
        "src/domain/probe.ts",
        '// import("../android/Provider.js");\nconst text = \'import("../android/Provider.js")\';',
        process.cwd(),
      ),
    ).toEqual([]);
  });

  it.each(["absolute", "file-url"])("resolves %s source imports", (kind) => {
    const target = resolve("src/android/Provider.js");
    const specifier = kind === "file-url" ? pathToFileURL(target).href : target;
    expect(
      inspectModuleBoundaries(
        "src/domain/probe.ts",
        `export * from ${JSON.stringify(specifier)};`,
        process.cwd(),
      ),
    ).toEqual([
      expect.objectContaining({
        target: "src/android/Provider.js",
        boundary: "pure-layer",
      }),
    ]);
  });

  it("rejects unsupported selected arguments instead of checking zero files", () => {
    const result = spawnSync(process.execPath, [verifier, "--unknown"], {
      encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected an exact TypeScript source file");
  });

  it("reports malformed source with the selected file and parsing reason", async () => {
    const temporary = await createTestTempDirectory("rea-module-syntax-");
    await mkdir(join(temporary, "src", "domain"), { recursive: true });
    await writeFile(join(temporary, "src/domain/probe.ts"), "import {");
    const result = spawnSync(
      process.execPath,
      [verifier, "src/domain/probe.ts"],
      {
        cwd: temporary,
        encoding: "utf8",
      },
    );
    if (result.error !== undefined) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not inspect src/domain/probe.ts");
    expect(result.stderr).toContain("Unexpected token");
  });

  it("checks untracked source files and ignores cached paths removed during a move", async () => {
    const temporary = await createTestTempDirectory("rea-module-discovery-");
    await mkdir(join(temporary, "src", "domain"), { recursive: true });
    await writeFile(join(temporary, "src/domain/old.ts"), "export const x=1;");
    await execute("git", ["init", "--quiet"], { cwd: temporary });
    await execute("git", ["add", "--", "src"], { cwd: temporary });
    await rename(
      join(temporary, "src/domain/old.ts"),
      join(temporary, "src/domain/new.ts"),
    );
    await writeFile(
      join(temporary, "src/domain/probe.ts"),
      'export * from "../android/Provider.js";',
    );
    const result = spawnSync(process.execPath, [verifier], {
      cwd: temporary,
      encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/domain/probe.ts:1: pure-layer");
    expect(result.stderr).not.toContain("old.ts");
  });

  it("discovers forbidden nested sources without a Git worktree", async () => {
    const temporary = await createTestTempDirectory("rea-module-no-git-");
    await mkdir(join(temporary, "src", "domain", "nested"), {
      recursive: true,
    });
    await writeFile(
      join(temporary, "src/domain/nested/probe.ts"),
      'import { createServer } from "../../server/createServer.js";\n',
    );
    const result = spawnSync(process.execPath, [verifier], {
      cwd: temporary,
      encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/domain/nested/probe.ts");
    expect(result.stderr).toContain("src/server/createServer.js");
  });

  it("discovers sources in an ignored archive nested under an ancestor Git worktree", async () => {
    const outer = await createTestTempDirectory("rea-module-ancestor-git-");
    const archive = join(outer, "archive");
    await writeFile(join(outer, ".gitignore"), "archive/\n");
    await execute("git", ["init", "--quiet"], { cwd: outer });
    await execute("git", ["add", "--", ".gitignore"], { cwd: outer });
    await mkdir(join(archive, "src", "domain"), { recursive: true });
    await writeFile(
      join(archive, "src/domain/probe.ts"),
      'import { createServer } from "../server/createServer.js";\n',
    );

    const result = spawnSync(process.execPath, [verifier], {
      cwd: archive,
      encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/domain/probe.ts:1: pure-layer");
    expect(result.stderr).toContain("src/server/createServer.js");
  });
});

describe("test lane import boundaries", () => {
  const cases: Array<[string, string, boolean]> = [
    ["src/application/probe.test.ts", "../server/createServer.js", false],
    ["tests/composition/process.test.ts", "node:child_process", false],
    ["tests/composition/net.test.ts", "node:net", false],
    ["tests/composition/browser.test.ts", "playwright", false],
    ["tests/composition/domain.test.ts", "../../src/domain/result.js", true],
  ];

  it("checks the test-lane import matrix in one lint invocation", async () => {
    const temporary = await createTestTempDirectory("rea-test-lane-");
    const config = await writeRepositoryOxlintConfiguration(temporary);
    for (const [file, dependency] of cases) {
      await mkdir(dirname(join(temporary, file)), { recursive: true });
      await writeFile(
        join(temporary, file),
        `import { value } from ${JSON.stringify(dependency)}; export { value };\n`,
      );
    }
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/oxlint/bin/oxlint"),
        "-c",
        config,
        "--threads",
        "1",
        "--format",
        "json",
        ...cases.map(([file]) => file),
      ],
      { cwd: temporary, encoding: "utf8" },
    );
    if (result.error !== undefined) throw result.error;
    expect(
      result.stdout.trimStart().startsWith("{"),
      `oxlint exited ${String(result.status)} (${String(result.signal)}): ${result.stdout}\n${result.stderr}`,
    ).toBe(true);
    const report = JSON.parse(result.stdout) as {
      diagnostics: Array<{ filename: string; code: string }>;
    };
    const violations = new Set(
      report.diagnostics
        .filter(({ code }) => code === "eslint(no-restricted-imports)")
        .map(({ filename }) => filename.replaceAll("\\", "/")),
    );
    for (const [file, , allowed] of cases)
      expect(violations.has(file)).toBe(!allowed);
    expect(result.status).toBe(cases.some(([, , allowed]) => !allowed) ? 1 : 0);
  });
});

describe.each(["apple", "inventory", "extraction"])(
  "%s artifact producer ownership",
  (owner) => {
    it.each([
      ["../../application/Workflow.js", false],
      ["../../composition/android.js", false],
      ["../../cli.js", false],
      ["../../server/registerEvidenceTools.js", false],
      ["../../main.ts", false],
      ["../../domain/apple/plistValue.js", true],
      ["../../domain/artifactInventorySnapshot.js", true],
      ["../../contracts/artifactGraph.js", true],
      ["../DirectoryArtifactReader.js", true],
      ["../ArtifactHash.js", true],
    ])("checks the producer dependency %s", (dependency, allowed) => {
      const violations = inspectModuleBoundaries(
        `src/artifacts/${owner}/probe.ts`,
        `import type { Value } from ${JSON.stringify(dependency)};`,
        process.cwd(),
      );

      expect(violations.length === 0).toBe(allowed);
      if (!allowed)
        expect(violations[0]?.boundary).toBe("artifact-acquisition");
    });
  },
);
