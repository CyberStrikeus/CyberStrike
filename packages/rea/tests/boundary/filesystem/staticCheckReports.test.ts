import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";

import { writeRepositoryOxlintConfiguration } from "../../fixtures/oxlintConfiguration.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const script = fileURLToPath(
  new URL("../../../scripts/ci/static-check-report.mjs", import.meta.url),
);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = async () => {
  const root = await createTestTempDirectory("rea-static-report-");
  await Promise.all([mkdir(join(root, "src")), mkdir(join(root, "tests"))]);
  await writeFile(
    join(root, ".oxlintrc.json"),
    JSON.stringify({
      rules: { "no-debugger": "error", "no-unused-vars": "warn" },
    }),
  );
  await writeFile(
    join(root, ".jscpd.json"),
    JSON.stringify({ threshold: 3, minLines: 5, minTokens: 50 }),
  );
  return root;
};
const invokeWithEnvironment = (
  root: string,
  mode: string,
  environment: NodeJS.ProcessEnv,
  ...arguments_: string[]
) =>
  spawnSync(process.execPath, [script, mode, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    env: environment,
  });
const invoke = (root: string, mode: string, ...arguments_: string[]) =>
  invokeWithEnvironment(root, mode, process.env, ...arguments_);
const lintDiagnostics = async (root: string) =>
  z
    .object({
      diagnostics: z.array(
        z.object({
          severity: z.string(),
          code: z.string().optional(),
          filename: z.string(),
        }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(join(root, ".cache/static-checks/oxlint.json"), "utf8"),
      ),
    ).diagnostics;

it("covers the lint inventory and root tool configs in resolved cache inputs", () => {
  const scan = spawnSync(
    process.execPath,
    [join(repository, "node_modules/oxlint/bin/oxlint"), "--debug=files"],
    { cwd: repository, encoding: "utf8", timeout: 15_000 },
  );
  expect(scan.error).toBeUndefined();
  expect(scan.status, scan.stderr).toBe(0);
  const files = scan.stdout
    .trim()
    .split(/\r?\n/u)
    .map((path) => path.split(sep).join("/"));
  expect(files.length).toBeGreaterThan(0);
  const dry = spawnSync(
    process.execPath,
    [
      join(repository, "node_modules/turbo/bin/turbo"),
      "run",
      "lint",
      "knip",
      "--dry=json",
    ],
    {
      cwd: repository,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  expect(dry.error).toBeUndefined();
  expect(dry.status, dry.stderr).toBe(0);
  const { tasks } = z
    .object({
      tasks: z.array(
        z.object({
          task: z.string(),
          inputs: z.record(z.string(), z.string()),
        }),
      ),
    })
    .parse(JSON.parse(dry.stdout));
  const lintTasks = tasks.filter(({ task }) => task === "lint");
  expect(lintTasks).toHaveLength(1);
  for (const task of lintTasks)
    expect(
      files.filter((file) => !Object.hasOwn(task.inputs, file)),
      `${task.task} omits actual checker inputs`,
    ).toEqual([]);
  const knip = tasks.find(({ task }) => task === "knip");
  expect(knip).toBeDefined();
  expect(
    files.filter(
      (file) => !file.includes("/") && !Object.hasOwn(knip!.inputs, file),
    ),
    "knip omits root tool configuration inputs",
  ).toEqual([]);
});

it("summarizes warnings without losing their complete diagnostic records", async () => {
  const root = await fixture();
  await writeFile(join(root, "src/warning.js"), "const forgotten = 1;\n");
  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("0 errors, 1 warnings");
  expect(result.stdout.split("\n").length).toBeLessThan(10);
  expect(await lintDiagnostics(root)).toEqual([
    expect.objectContaining({
      severity: "warning",
      code: "eslint(no-unused-vars)",
      filename: "src/warning.js",
    }),
  ]);
});

it("keeps lint errors failing and visible alongside the retained warnings", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "src/fault.js"),
    "const forgotten = 1;\ndebugger;\n",
  );
  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("1 errors, 1 warnings");
  expect(result.stderr).toContain("src/fault.js:2:1");
  expect(result.stderr).toContain("eslint(no-debugger)");
  expect(await lintDiagnostics(root)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ severity: "warning" }),
      expect.objectContaining({ severity: "error" }),
    ]),
  );
});

it("preserves cross-file typed errors and explicit worker choices", async () => {
  const root = await fixture();
  await Promise.all([
    writeFile(join(root, "package.json"), '{"type":"module"}'),
    writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          target: "ES2023",
          lib: ["ES2023"],
          strict: true,
          types: [],
        },
        include: ["src/**/*.ts"],
      }),
    ),
    writeFile(
      join(root, ".oxlintrc.json"),
      JSON.stringify({
        plugins: ["typescript"],
        rules: {
          "no-unused-vars": "warn",
          "typescript/no-floating-promises": "error",
          "typescript/switch-exhaustiveness-check": "error",
        },
      }),
    ),
    writeFile(
      join(root, "src/types.ts"),
      'export type State = "ready" | "failed";\n' +
        "export function pending(): Promise<void> { return Promise.resolve(); }\n",
    ),
  ]);
  const caller = join(root, "src/caller.ts");
  const source =
    'import { pending, type State } from "./types.js";\n' +
    "const forgotten = 1;\n";
  await writeFile(
    caller,
    source +
      "pending();\n" +
      'export function inspect(state: State) { switch (state) { case "ready": return 1; } }\n',
  );
  const diagnostics: string[][] = [];
  const typedEnvironment = {
    ...process.env,
    PATH: [join(repository, "node_modules", ".bin"), process.env.PATH]
      .filter((path) => path !== undefined)
      .join(delimiter),
  };
  for (const workers of [undefined, "2"]) {
    const result = invokeWithEnvironment(root, "typed-lint", {
      ...typedEnvironment,
      GOMAXPROCS: workers,
      OXC_LOG: "debug",
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      `Starting linter with ${workers ?? "1"} workers`,
    );
    expect(result.stdout).toContain("2 errors, 1 warnings");
    const report = z
      .object({
        number_of_files: z.number(),
        diagnostics: z.array(
          z.object({ code: z.string(), severity: z.string() }).passthrough(),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(
            join(root, ".cache/static-checks/typed-oxlint.json"),
            "utf8",
          ),
        ),
      );
    expect(report.number_of_files).toBe(2);
    expect(
      report.diagnostics
        .filter(({ severity }) => severity === "error")
        .map(({ code }) => code)
        .sort(),
    ).toEqual([
      "typescript(no-floating-promises)",
      "typescript(switch-exhaustiveness-check)",
    ]);
    diagnostics.push(
      report.diagnostics.map((item) => JSON.stringify(item)).sort(),
    );
  }
  expect(diagnostics[1]).toEqual(diagnostics[0]);
  await writeFile(
    caller,
    source +
      "await pending();\n" +
      'export function inspect(state: State) { switch (state) { case "ready": return 1; case "failed": return 0; } }\n',
  );
  const corrected = invokeWithEnvironment(root, "typed-lint", {
    ...typedEnvironment,
    GOMAXPROCS: undefined,
  });
  expect(corrected.error).toBeUndefined();
  expect(corrected.status, corrected.stderr).toBe(0);
  expect(corrected.stdout).toContain("0 errors, 1 warnings");
});

it("excludes translation staging while retaining authored website errors", async () => {
  const root = await fixture();
  await writeFile(
    join(root, ".gitignore"),
    await readFile(join(repository, ".gitignore")),
  );
  await writeRepositoryOxlintConfiguration(root);
  const authored = "website/public/assets/authored.js";
  const staged =
    "website/.i18n-regression/site/examples/notes-electron/main.js";
  for (const name of [authored, staged]) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      'const source = require("node:fs");\nconsole.log(source);\n',
    );
  }

  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("1 errors, 0 warnings");
  expect(result.stderr).toContain(authored);
  expect(await lintDiagnostics(root)).toEqual([
    expect.objectContaining({
      severity: "error",
      code: "typescript(no-var-requires)",
      filename: authored,
    }),
  ]);
});

it("keeps malformed source failing with its parser diagnostic", async () => {
  const root = await fixture();
  await writeFile(join(root, "src/malformed.js"), "const value = ;\n");
  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("src/malformed.js:1:");
  expect(await lintDiagnostics(root)).toContainEqual(
    expect.objectContaining({ severity: "error" }),
  );
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "retains location-free lint I/O errors without inventing a source location",
  async () => {
    const root = await fixture();
    const source = join(root, "src/unreadable.js");
    await writeFile(source, "debugger;\n");
    await chmod(source, 0);
    try {
      const result = invoke(root, "lint", source);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("1 files, 1 errors, 0 warnings");
      expect(result.stdout).toContain("Full diagnostics:");
      const report = JSON.parse(
        await readFile(join(root, ".cache/static-checks/oxlint.json"), "utf8"),
      );
      expect(report.diagnostics).toEqual([
        {
          message: expect.stringContaining("Permission denied"),
          severity: "error",
          labels: [],
        },
      ]);
      expect(report.diagnostics[0].message).toContain(source);
      expect(result.stderr).toBe(`lint: ${report.diagnostics[0].message}\n`);
    } finally {
      await chmod(source, 0o600);
    }
  },
);

it("preserves the duplication threshold and complete clone locations", async () => {
  const root = await fixture();
  const source = [
    "export function calculate(value) {",
    ...Array.from({ length: 34 }, (_, index) => `  value += ${index + 1};`),
    "  return value;",
    "}",
  ].join("\n");
  await Promise.all([
    writeFile(join(root, "src/same.ts"), source),
    writeFile(join(root, "tests/same.ts"), source),
  ]);
  const result = invoke(root, "duplicates");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("Duplication:");
  expect(result.stdout.split("\n").length).toBeLessThan(15);
  const report = z
    .object({
      statistics: z.object({ total: z.object({ percentage: z.number() }) }),
      duplicates: z.array(
        z.object({
          firstFile: z.object({ name: z.string() }),
          secondFile: z.object({ name: z.string() }),
        }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(
          join(root, ".cache/static-checks/jscpd/jscpd-report.json"),
          "utf8",
        ),
      ),
    );
  expect(report.statistics.total.percentage).toBeGreaterThan(3);
  expect(report.duplicates).toHaveLength(1);
  expect(
    [
      report.duplicates[0]?.firstFile.name,
      report.duplicates[0]?.secondFile.name,
    ].sort(),
  ).toEqual(["src/same.ts", "tests/same.ts"]);
});

it.each([
  ["lint", "oxlint.json"],
  ["duplicates", "jscpd/jscpd-report.json"],
])(
  "removes stale %s evidence when the checker cannot run",
  async (mode, name) => {
    const root = await fixture();
    const reportPath = join(root, ".cache/static-checks", name);
    await mkdir(join(root, ".cache/static-checks/jscpd"), { recursive: true });
    await writeFile(reportPath, '{"previous_success":true}');
    const result = invoke(root, mode, "--rea-invalid-checker-option");
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rea-invalid-checker-option");
    await expect(access(reportPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
