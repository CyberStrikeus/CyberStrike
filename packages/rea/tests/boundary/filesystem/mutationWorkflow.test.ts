import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const stepSchema = z
  .object({
    name: z.string().optional(),
    run: z.string().optional(),
    if: z.string().optional(),
    uses: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const readWorkflow = async () =>
  z
    .object({
      on: z.record(z.string(), z.unknown()),
      permissions: z.object({ contents: z.literal("read") }).strict(),
      concurrency: z.object({ "cancel-in-progress": z.literal(false) }),
      jobs: z.object({
        mutation: z
          .object({
            strategy: z.object({
              "fail-fast": z.literal(false),
              "max-parallel": z.literal(2),
              matrix: z.object({
                include: z.array(
                  z.object({ suite: z.string(), config: z.string() }),
                ),
              }),
            }),
            steps: z.array(stepSchema),
          })
          .passthrough(),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/mutation.yml", import.meta.url),
          "utf8",
        ),
      ),
    );

it("runs both complete canonical sweeps independently of PR and release gates", async () => {
  const workflow = await readWorkflow();
  expect(Object.keys(workflow.on).sort()).toEqual([
    "schedule",
    "workflow_dispatch",
  ]);
  const job = workflow.jobs.mutation;
  expect(job["continue-on-error"]).toBeUndefined();
  expect(job.if).toBeUndefined();
  expect(job.strategy.matrix.include).toEqual([
    { suite: "reverse-tools", config: "stryker.config.mjs" },
    {
      suite: "reverse-tools-semantics",
      config: "stryker.semantics.config.mjs",
    },
  ]);
  const sweep = job.steps.find(
    (step) => step.env?.MUTATION_CONFIG !== undefined,
  );
  expect(sweep?.env?.MUTATION_CONFIG).toBe("${{ matrix.config }}");
  expect(sweep?.run?.trim().split("\n")).toEqual([
    "node scripts/prepare-reverse-tools-mutation.mjs",
    'npx --no-install stryker run "${MUTATION_CONFIG}"',
  ]);
  expect(job.steps.some((step) => step.run === "npm run test:prepare")).toBe(
    true,
  );
  const upload = job.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  expect(upload?.if).toBe("${{ !cancelled() }}");
  expect(upload?.with?.name).toBe(
    "mutation-${{ matrix.suite }}-${{ github.run_attempt }}",
  );
  expect(upload?.with?.["retention-days"]).toBe(7);
  const paths = z.string().parse(upload?.with?.path).trim().split("\n");
  for (const { suite, config } of job.strategy.matrix.include) {
    const canonical = z
      .object({
        default: z.object({
          jsonReporter: z.object({ fileName: z.string() }),
          htmlReporter: z.object({ fileName: z.string() }),
        }),
      })
      .parse(
        await import(new URL(`../../../${config}`, import.meta.url).href),
      ).default;
    expect(
      paths.map((path) => path.replace("${{ matrix.suite }}", suite)),
    ).toEqual([
      canonical.jsonReporter.fileName,
      canonical.htmlReporter.fileName,
    ]);
  }
  for (const step of job.steps)
    expect(step["continue-on-error"]).toBeUndefined();
});

it("fails a successful sweep when either required report is absent or empty", async () => {
  const steps = (await readWorkflow()).jobs.mutation.steps;
  const guard = steps.find((step) => step.env?.REPORT_BASE !== undefined);
  expect(guard?.if).toBeUndefined();
  const command = z.string().parse(guard?.run);
  const guardIndex = steps.indexOf(guard!);
  expect(guardIndex).toBeGreaterThan(
    steps.findIndex((step) => step.env?.MUTATION_CONFIG),
  );
  expect(guardIndex).toBeLessThan(
    steps.findIndex((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    ),
  );
  for (const state of ["missing", "empty-json", "empty-html", "complete"]) {
    const directory = await createTestTempDirectory("rea-mutation-reports-");
    const base = join(directory, "reports", "reverse-tools");
    await mkdir(join(directory, "reports"));
    if (state !== "missing") {
      await writeFile(`${base}.json`, state === "empty-json" ? "" : "{}");
      await writeFile(
        `${base}.html`,
        state === "empty-html" ? "" : "<html></html>",
      );
    }
    const result = execute("bash", ["-eu", "-c", command], {
      cwd: directory,
      env: { ...process.env, REPORT_BASE: base },
    });
    if (state === "complete")
      await expect(result).resolves.toMatchObject({ stderr: "" });
    else await expect(result).rejects.toMatchObject({ code: 1 });
  }
});
