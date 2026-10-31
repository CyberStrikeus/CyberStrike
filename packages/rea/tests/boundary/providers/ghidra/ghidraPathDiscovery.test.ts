import { execFile } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "doctor preserves POSIX PATH cwd entries and discovery order without executing launchers",
  async () => {
    const root = await createTestTempDirectory("rea-ghidra-cwd-discovery-");
    const marker = join(root, "launched");
    const installation = async (name: string) => {
      const directory = join(root, name);
      await mkdir(join(directory, "Ghidra"), { recursive: true });
      await mkdir(join(directory, "support"), { recursive: true });
      await writeFile(
        join(directory, "Ghidra/application.properties"),
        "application.version=12.1.4\n",
      );
      const launcher = join(directory, "ghidraRun");
      await writeFile(
        launcher,
        '#!/bin/sh\nprintf "launched\\n" >> "$REA_PATH_TEST_MARKER"\n',
        { mode: 0o700 },
      );
      await writeFile(join(directory, "support/analyzeHeadless"), "", {
        mode: 0o700,
      });
      return { directory, launcher };
    };
    const local = await installation("local");
    const other = await installation("other");
    await symlink(local.launcher, join(root, "ghidra"));
    const absent = join(root, "absent");
    const paths = [
      `:${other.directory}`,
      `${absent}::${other.directory}`,
      `${absent}:`,
      "",
      `${other.directory}:`,
    ];
    const environment = {
      ...process.env,
      JAVA_HOME: join(root, "missing-jdk"),
      GHIDRA_INSTALL_DIR: undefined,
      REA_PATH_TEST_MARKER: marker,
    };
    // A real exec search establishes what the empty components select.
    for (const path of paths.slice(0, 4))
      await execute("ghidra", [], {
        cwd: root,
        env: { ...environment, PATH: path },
      });
    const before = await readFile(marker, "utf8");
    const doctorModule = new URL(
      "../../../../src/ghidra/GhidraDoctor.ts",
      import.meta.url,
    ).href;
    const resourceModule = new URL(
      "../../../fixtures/inspectionResources.ts",
      import.meta.url,
    ).href;
    const source = `
      import { inspectSystemGhidraProvider } from ${JSON.stringify(doctorModule)};
      import { createInspectionResources } from ${JSON.stringify(resourceModule)};
      const scope = createInspectionResources();
      try {
        const cases = ${JSON.stringify(paths)}.map(PATH => ({ ...process.env, PATH }));
        cases.push({ ...process.env, PATH: undefined });
        cases.push({ ...process.env, PATH: '', GHIDRA_INSTALL_DIR: ${JSON.stringify(absent)} });
        const results = [];
        for (const env of cases) {
          const result = await inspectSystemGhidraProvider(env, scope.owner);
          results.push({ configured: result.configured, configuration: result.checks.find(c => c.name === 'configuration') });
        }
        console.log(JSON.stringify(results));
      } finally { await scope.close(); }
    `;
    const { stdout } = await execute(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        source,
      ],
      { cwd: root, env: environment, timeout: 20_000 },
    );
    const results: unknown = JSON.parse(stdout);
    expect(results).toEqual([
      ...[
        local.directory,
        local.directory,
        local.directory,
        local.directory,
        other.directory,
      ].map((detail) => ({
        configured: true,
        configuration: expect.objectContaining({ detail, ok: true }),
      })),
      {
        configured: false,
        configuration: expect.objectContaining({ code: "not_configured" }),
      },
      {
        configured: true,
        configuration: expect.objectContaining({ detail: absent, ok: true }),
      },
    ]);
    expect(await readFile(marker, "utf8")).toBe(before);
  },
);
