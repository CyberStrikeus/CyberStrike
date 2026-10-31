import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import {
  diagnosticPaths,
  parseStaticArchive,
} from "../../../scripts/ci/artifacts.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const producer = fileURLToPath(
  new URL("../../../scripts/ci/static-check-report.mjs", import.meta.url),
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "archives real lint I/O errors with unavailable source and rule identity",
  async () => {
    const root = await createTestTempDirectory("rea-ci-static-io-");
    const source = join(root, "unreadable.js");
    await writeFile(source, "debugger;\n");
    await chmod(source, 0);
    try {
      await expect(
        execute(process.execPath, [producer, "lint", source], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
      const reports = join(root, ".cache/static-checks");
      const report = JSON.parse(
        await readFile(join(reports, "oxlint.json"), "utf8"),
      );
      expect(report.diagnostics).toEqual([
        {
          severity: "error",
          labels: [],
          message: expect.stringContaining("Permission denied"),
        },
      ]);
      await writeFile(
        join(reports, "static-task-context.json"),
        JSON.stringify({
          version: 1,
          sourceSha: "a".repeat(40),
          sourceClean: true,
          nodeVersion: process.version,
          npmVersion: "11.16.0",
          turboVersion: "2.11.7",
          platform: process.platform,
          architecture: process.arch,
          taskHashes: { lint: "a".repeat(16) },
        }),
      );
      const archive = join(root, "reports.zip");
      const pack = () =>
        execute(
          "zip",
          ["-q", archive, "oxlint.json", "static-task-context.json"],
          { cwd: reports },
        );
      await pack();
      const evidence = await parseStaticArchive(archive);
      expect(evidence.diagnostics).toEqual([
        {
          kind: "lint",
          message: report.diagnostics[0].message,
          severity: "error",
        },
      ]);
      expect(diagnosticPaths(evidence.diagnostics[0]!)).toEqual([]);
      for (const malformed of [
        { filename: null },
        { filename: "../outside.js" },
        { filename: source },
        { code: null },
        { code: 1 },
      ]) {
        await writeFile(
          join(reports, "oxlint.json"),
          JSON.stringify({
            ...report,
            diagnostics: [{ ...report.diagnostics[0], ...malformed }],
          }),
        );
        await pack();
        await expect(parseStaticArchive(archive)).rejects.toThrow(
          "oxlint error diagnostic is malformed",
        );
      }
    } finally {
      await chmod(source, 0o600);
    }
  },
);

it("uses the same repository path admission for archived and compared diagnostics", async () => {
  const root = await createTestTempDirectory("rea-ci-static-paths-");
  await writeFile(
    join(root, "static-task-context.json"),
    JSON.stringify({
      version: 1,
      sourceSha: "a".repeat(40),
      sourceClean: true,
      nodeVersion: process.version,
      npmVersion: "11.16.0",
      turboVersion: "2.11.7",
      platform: process.platform,
      architecture: process.arch,
      taskHashes: { lint: "a".repeat(16) },
    }),
  );
  const archive = join(root, "reports.zip");
  for (const path of [
    "src/space name.ts",
    "src/中文.ts",
    "",
    "/absolute.ts",
    "../outside.ts",
    "src/./file.ts",
    "src//file.ts",
    "src\\file.ts",
  ]) {
    await writeFile(
      join(root, "oxlint.json"),
      JSON.stringify({
        diagnostics: [
          { filename: path, severity: "error", message: "failure" },
        ],
      }),
    );
    await execute(
      "zip",
      ["-q", archive, "oxlint.json", "static-task-context.json"],
      {
        cwd: root,
      },
    );
    if (path === "src/space name.ts" || path === "src/中文.ts") {
      const evidence = await parseStaticArchive(archive);
      expect(diagnosticPaths(evidence.diagnostics[0]!)).toEqual([path]);
    } else {
      await expect(parseStaticArchive(archive)).rejects.toThrow(
        "oxlint error diagnostic is malformed",
      );
    }
  }
});

it.each([3.5, 100, 0])(
  "retains real lint failures when the duplication threshold is %s",
  async (threshold) => {
    const root = await createTestTempDirectory("rea-ci-static-archive-");
    await mkdir(join(root, "src"));
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, ".oxlintrc.json"),
      JSON.stringify({ rules: { "no-debugger": "error" } }),
    );
    await writeFile(
      join(root, ".jscpd.json"),
      JSON.stringify({ threshold, minLines: 5, minTokens: 50 }),
    );
    await writeFile(
      join(root, "src/example.ts"),
      "debugger;\nexport const example = true;\n",
    );
    const duplicate =
      "export function compute(value: number) {\n" +
      Array.from({ length: 20 }, (_, index) => `  value += ${index};\n`).join(
        "",
      ) +
      "  return value;\n}\n";
    for (const name of threshold === 3.5 ? [] : ["first", "second"])
      await writeFile(join(root, `src/${name}.ts`), duplicate);
    await expect(
      execute(process.execPath, [producer, "lint", "src/example.ts"], {
        cwd: root,
      }),
    ).rejects.toMatchObject({ code: 1 });
    const duplication = execute(process.execPath, [producer, "duplicates"], {
      cwd: root,
    });
    if (threshold === 0)
      await expect(duplication).rejects.toMatchObject({ code: 1 });
    else await duplication;
    const reports = join(root, ".cache/static-checks");
    expect(
      JSON.parse(
        await readFile(join(reports, "jscpd/jscpd-report.json"), "utf8"),
      ),
    ).toMatchObject({ reaCheck: { exitCode: threshold === 0 ? 1 : 0 } });
    await writeFile(
      join(reports, "static-task-context.json"),
      JSON.stringify({
        version: 1,
        sourceSha: "a".repeat(40),
        sourceClean: true,
        nodeVersion: process.version,
        npmVersion: "11.16.0",
        turboVersion: "2.11.7",
        platform: process.platform,
        architecture: process.arch,
        taskHashes: { lint: "a".repeat(16), jscpd: "b".repeat(16) },
      }),
    );
    const archive = join(root, "reports.zip");
    await execute(
      "zip",
      [
        "-q",
        archive,
        "oxlint.json",
        "jscpd/jscpd-report.json",
        "static-task-context.json",
      ],
      { cwd: reports },
    );
    const evidence = await parseStaticArchive(archive);
    expect(evidence.diagnostics.filter(({ kind }) => kind === "lint")).toEqual([
      expect.objectContaining({
        kind: "lint",
        path: "src/example.ts",
        severity: "error",
      }),
    ]);
    const duplicates = evidence.diagnostics.filter(
      ({ kind }) => kind === "jscpd",
    );
    if (threshold === 0) expect(duplicates.length).toBeGreaterThan(0);
    else expect(duplicates).toEqual([]);
  },
);
