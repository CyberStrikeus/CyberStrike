import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const require = createRequire(import.meta.url);
const finding = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  kind: z.string().optional(),
  specifier: z.string().optional(),
  line: z.number().optional(),
  col: z.number().optional(),
  pos: z.number().optional(),
});
const issue = z.strictObject({
  file: z.string(),
  owners: z.array(z.object({ name: z.string() })).optional(),
  files: z.array(finding).optional(),
  exports: z.array(finding).optional(),
  nsExports: z.array(finding).optional(),
  types: z.array(finding).optional(),
  nsTypes: z.array(finding).optional(),
  enumMembers: z.array(finding).optional(),
  namespaceMembers: z.array(finding).optional(),
  duplicates: z.array(z.array(finding)).optional(),
});
const reportSchema = z.strictObject({ issues: z.array(issue) });

/** Admit the installed Knip JSON reporter's candidate records. */
export const parseProductionReachabilityReport = (text) =>
  reportSchema.parse(JSON.parse(text));

/** Run production reachability without turning candidates into failures. */
export const recordProductionReachabilityReport = async (
  root = process.cwd(),
) => {
  const reportDirectory = join(root, ".cache", "static-checks");
  const reportPath = join(reportDirectory, "production-reachability.json");

  // Findings are advisory. Execution, configuration and report-admission failures
  // still fail, and must never leave an older successful report at this path.
  await mkdir(reportDirectory, { recursive: true });
  await rm(reportPath, { force: true });
  const result = spawnSync(
    process.execPath,
    [
      join(dirname(require.resolve("knip")), "..", "bin", "knip.js"),
      "--config",
      "knip.production.json",
      "--production",
      "--reporter",
      "json",
      "--no-exit-code",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    throw new Error(
      result.status === null
        ? `Production reachability analysis terminated by ${result.signal}`
        : `Production reachability analysis failed with status ${result.status}`,
    );
  }
  const report = parseProductionReachabilityReport(result.stdout);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Production reachability: ${report.issues.length} files with advisory candidates.`,
  );
  console.log(`Full report: ${reportPath}`);
  console.log(
    "Candidates require runtime, verifier and published-contract review before removal; ordinary Knip remains separate.",
  );
  return report;
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await recordProductionReachabilityReport();
