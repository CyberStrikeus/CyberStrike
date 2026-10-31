import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const example = async () =>
  z
    .object({
      on: z.record(z.string(), z.null()),
      permissions: z.record(z.string(), z.string()),
      jobs: z.object({
        analyze: z.object({
          "runs-on": z.string(),
          env: z.object({ ARTIFACT_PATH: z.string() }),
          steps: z.array(
            z.object({
              id: z.string().optional(),
              name: z.string().optional(),
              run: z.string().optional(),
              uses: z.string().optional(),
              if: z.string().optional(),
              env: z.record(z.string(), z.string()).optional(),
              "continue-on-error": z.boolean().optional(),
              with: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL(
            "../../../examples/github-actions/rea-analysis.yml",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );

it("keeps the example manually triggered, least-privileged, pinned and failure-preserving", async () => {
  const workflow = await example();
  expect(workflow.on).toEqual({ workflow_dispatch: null });
  expect(workflow.permissions).toEqual({ contents: "read" });
  const job = workflow.jobs.analyze;
  expect(job["runs-on"]).toBe("ubuntu-24.04");
  expect(
    job.steps.find((step) => step.uses?.startsWith("actions/setup-node@"))
      ?.with,
  ).toMatchObject({
    "node-version": "24.22.1",
  });
  for (const step of job.steps) {
    expect(step["continue-on-error"]).toBeUndefined();
    if (step.uses !== undefined) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
  }
  expect(
    job.steps.find((step) => step.name === "Install pinned REA")?.run,
  ).toContain("--save-exact rea-agents@6.7.0");
  const upload = job.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  expect(job.steps[0]?.id).toBe("reports");
  expect(job.steps.find((step) => step.id === "analyze")?.env).toEqual({
    REPORT_DIR: "${{ steps.reports.outputs.directory }}",
  });
  expect(upload?.if).toBe(
    "${{ always() && steps.reports.outputs.directory != '' }}",
  );
  expect(upload?.with).toMatchObject({
    path: "${{ steps.reports.outputs.directory }}",
    "if-no-files-found": "warn",
    "retention-days": 7,
  });
});

it("links to the workflow asset outside the documentation site's base", async () => {
  const guide = await readFile(
    new URL("../../../docs/ci-analysis.md", import.meta.url),
    "utf8",
  );
  expect(guide).toContain(
    "[minimal workflow](https://github.com/morluto/rea/blob/main/examples/github-actions/rea-analysis.yml)",
  );
});

// This example explicitly targets an Ubuntu/Bash runner, not Windows shells.
describe.skipIf(process.platform === "win32")(
  "GitHub Actions example with the compiled CLI",
  () => {
    for (const kind of [
      "complete",
      "partial",
      "missing",
      "unsupported",
      "pre-analysis-failure",
    ] as const) {
      cliTest(
        `retains the real ${kind} result and exit status`,
        async ({ processes, cliCompileCache }) => {
          const job = (await example()).jobs.analyze;
          const build = job.steps.find((step) => step.id === "build")?.run;
          const analyze = job.steps.find((step) => step.id === "analyze")?.run;
          if (build === undefined || analyze === undefined)
            throw new Error("Example omitted build or analysis");
          const root = await createTestTempDirectory("rea-ci-example-");
          const workspace = join(root, "checkout");
          const runner = join(root, "runner");
          const home = join(root, "home");
          const bin = join(root, "bin");
          const outputs = join(root, "step-outputs");
          for (const directory of [workspace, runner, home, bin])
            await mkdir(directory);
          await writeFile(outputs, "");
          // Use the real executable, not a stub that invents a successful report.
          await symlink(resolve("scripts/rea.mjs"), join(bin, "rea"));
          const env = {
            PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(
              delimiter,
            ),
            HOME: home,
            TMPDIR: root,
            NODE_COMPILE_CACHE: cliCompileCache,
            GITHUB_WORKSPACE: workspace,
            GITHUB_OUTPUT: outputs,
            RUNNER_TEMP: runner,
            REPORT_DIR: "",
            ARTIFACT_PATH: job.env.ARTIFACT_PATH,
          };
          const run = (script: string) =>
            processes.run(
              "bash",
              ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
              {
                cwd: workspace,
                env,
                timeoutMs: 30_000,
              },
            );
          const checkoutReports = join(workspace, "reports", "rea");
          await mkdir(checkoutReports, { recursive: true });
          await writeFile(
            join(checkoutReports, "analysis.json"),
            '{"ok":true,"stale":true}\n',
          );
          await writeFile(
            join(checkoutReports, "unrelated.txt"),
            "Not a run report.\n",
          );
          let reports = checkoutReports;
          const prepare = job.steps.find((step) => step.id === "reports")?.run;
          if (prepare !== undefined) {
            const prepared = await run(prepare);
            expect(prepared.exitCode, prepared.stdout + prepared.stderr).toBe(
              0,
            );
            const output = (await readFile(outputs, "utf8"))
              .split("\n")
              .find((line) => line.startsWith("directory="));
            if (output === undefined)
              throw new Error("Report step omitted its directory output");
            reports = output.slice("directory=".length);
            env.REPORT_DIR = reports;
          }
          if (kind === "pre-analysis-failure") {
            const failed = await run("exit 23");
            expect(failed.exitCode).toBe(23);
            expect(await readdir(reports)).toEqual([]);
            expect(
              await readFile(join(checkoutReports, "analysis.json"), "utf8"),
            ).toContain('"stale":true');
            return;
          }
          const built = await run(build);
          expect(built.exitCode, built.stdout + built.stderr).toBe(0);
          if (kind === "partial")
            await appendFile(
              join(workspace, env.ARTIFACT_PATH, "index.js"),
              "\nexport const broken = ;\n",
            );
          if (kind === "missing") env.ARTIFACT_PATH = "build/missing-artifact";
          if (kind === "unsupported")
            env.ARTIFACT_PATH = "build/rea-ci-demo/index.js";
          const result = await run(analyze);
          expect(result.signal).toBeNull();
          const raw = await readFile(join(reports, "analysis.json"), "utf8");
          expect((await readdir(reports)).sort()).toEqual([
            "analysis.json",
            "analysis.stderr",
            "exit-code.txt",
          ]);
          const diagnostics = await readFile(
            join(reports, "analysis.stderr"),
            "utf8",
          );
          expect(await readFile(join(reports, "exit-code.txt"), "utf8")).toBe(
            `${result.exitCode}\n`,
          );
          expect(diagnostics).not.toContain(
            "This artifact must not be executed.",
          );
          const envelope: unknown = JSON.parse(raw);
          if (kind === "complete" || kind === "partial") {
            expect(result.exitCode).toBe(0);
            expect(envelope).toMatchObject({
              ok: true,
              data: {
                normalized_result: {
                  statistics: { parse_failures: kind === "partial" ? 1 : 0 },
                },
              },
            });
            if (kind === "partial")
              expect(raw).toContain("Graph coverage is incomplete");
          } else {
            expect(result.exitCode).toBe(1);
            expect(envelope).toMatchObject({
              ok: false,
              error: {
                category:
                  kind === "missing" ? "invalid_input" : "unsupported_target",
              },
            });
          }
        },
      );
    }
  },
);
