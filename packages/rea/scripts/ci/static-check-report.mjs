import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";

const require = createRequire(import.meta.url);
const mode = process.argv[2];
const reportRoot = join(".cache", "static-checks");
const extraArguments = process.argv.slice(3);
const lintReport = z.object({
  number_of_files: z.number(),
  diagnostics: z.array(
    z.object({
      message: z.string(),
      code: z.string().optional(),
      severity: z.enum(["error", "warning", "advice"]),
      filename: z.string().optional(),
      labels: z.array(
        z.object({
          span: z.object({ line: z.number(), column: z.number() }),
        }),
      ),
    }),
  ),
});
const duplicateReport = z
  .object({
    duplicates: z.array(
      z
        .object({
          firstFile: z.object({ name: z.string() }).passthrough(),
          secondFile: z.object({ name: z.string() }).passthrough(),
        })
        .passthrough(),
    ),
    statistics: z
      .object({
        total: z
          .object({
            sources: z.number(),
            clones: z.number(),
            percentage: z.number(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const run = (
  packageName,
  entrypoint,
  arguments_,
  environment = process.env,
) => {
  const executable = join(
    dirname(require.resolve(`${packageName}/package.json`)),
    entrypoint,
  );
  const result = spawnSync(process.execPath, [executable, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: environment,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error !== undefined) throw result.error;
  if (result.status === null)
    throw new Error(`${packageName} terminated by ${result.signal}`);
  return result;
};

try {
  await mkdir(reportRoot, { recursive: true });
  if (mode === "lint" || mode === "typed-lint") {
    const typed = mode === "typed-lint";
    const reportPath = join(
      reportRoot,
      typed ? "typed-oxlint.json" : "oxlint.json",
    );
    await rm(reportPath, { force: true });
    const result = run(
      "oxlint",
      "bin/oxlint",
      [
        ...(typed ? ["--type-aware", "--threads", "1"] : []),
        ...extraArguments,
        "--format",
        "json",
      ],
      typed
        ? {
            ...process.env,
            // One worker reuses its checker caches across the full file queue.
            GOMAXPROCS: process.env.GOMAXPROCS ?? "1",
            GOMEMLIMIT: process.env.GOMEMLIMIT ?? "1024MiB",
          }
        : process.env,
    );
    let report;
    try {
      report = lintReport.parse(JSON.parse(result.stdout));
    } catch (cause) {
      process.stderr.write(result.stdout);
      throw cause;
    }
    await writeFile(reportPath, result.stdout);
    const warnings = report.diagnostics.filter(
      ({ severity }) => severity === "warning",
    );
    const errors = report.diagnostics.filter(
      ({ severity }) => severity === "error",
    );
    console.log(
      `${typed ? "Typed lint" : "Lint"}: ${report.number_of_files} files, ${errors.length} errors, ${warnings.length} warnings.`,
    );
    for (const diagnostic of errors) {
      const location = diagnostic.labels[0]?.span;
      const source =
        diagnostic.filename === undefined
          ? ""
          : `${diagnostic.filename}${location === undefined ? "" : `:${location.line}:${location.column}`}: `;
      console.error(
        `${source}${diagnostic.code ?? "lint"}: ${diagnostic.message}`,
      );
    }
    const counts = new Map();
    for (const { code } of warnings)
      counts.set(code ?? "warning", (counts.get(code ?? "warning") ?? 0) + 1);
    for (const [rule, count] of [...counts]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .slice(0, 8))
      console.log(`  ${rule}: ${count} warnings`);
    console.log(
      `Full diagnostics: ${reportPath}${typed ? "" : "; npm run lint:details"}`,
    );
    process.exitCode = result.status;
  } else if (mode === "duplicates") {
    const output = join(reportRoot, "jscpd");
    const reportPath = join(output, "jscpd-report.json");
    await rm(reportPath, { force: true });
    const result = run("jscpd", "run-jscpd.js", [
      "src/",
      "tests/",
      ...extraArguments,
      "--reporters",
      "json",
      "--output",
      output,
      "--no-colors",
      "--no-tips",
      "--absolute",
    ]);
    if (result.stdout) process.stdout.write(result.stdout);
    const report = duplicateReport.parse(
      JSON.parse(await readFile(reportPath, "utf8")),
    );
    // jscpd otherwise strips each scan root, making src/ and tests/ names
    // ambiguous. Normalize absolute producer paths once for portable reports.
    for (const clone of report.duplicates)
      for (const file of [clone.firstFile, clone.secondFile])
        file.name = relative(process.cwd(), file.name).split(sep).join("/");
    // Record the actual checker result, including caller-selected thresholds.
    report.reaCheck = { exitCode: result.status };
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    const { sources, clones, percentage } = report.statistics.total;
    console.log(
      `Duplication: ${sources} files, ${clones} clones, ${percentage.toFixed(2)}% duplicated lines.`,
    );
    console.log(`Full diagnostics: ${reportPath}; npm run jscpd:details`);
    process.exitCode = result.status;
  } else {
    throw new Error("Expected lint, typed-lint or duplicates");
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
}
