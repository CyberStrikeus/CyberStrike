import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { executeWorkflowFixture } from "../../support/workflowGit.js";

async function workflow(name: string) {
  return z
    .object({
      on: z.record(z.string(), z.unknown()),
      permissions: z.record(z.string(), z.string()),
      concurrency: z.object({ group: z.string() }).optional(),
      jobs: z.record(
        z.string(),
        z
          .object({
            name: z.string().optional(),
            if: z.string().optional(),
            uses: z.string().optional(),
            with: z.record(z.string(), z.string()).optional(),
            steps: z
              .array(
                z.object({
                  run: z.string().optional(),
                  uses: z.string().optional(),
                  env: z.record(z.string(), z.string()).optional(),
                }),
              )
              .optional(),
          })
          .passthrough(),
      ),
    })
    .parse(
      parse(
        await readFile(
          new URL(`../../../.github/workflows/${name}`, import.meta.url),
          "utf8",
        ),
      ),
    );
}

it("refreshes title validation on edits without checking out PR code or cancelling CI", async () => {
  const title = await workflow("pr-title.yml");
  expect(title.on.pull_request).toMatchObject({
    types: ["opened", "synchronize", "reopened", "edited"],
  });
  expect(title.permissions).toEqual({});
  expect(title.concurrency?.group).not.toBe(
    (await workflow("ci.yml")).concurrency?.group,
  );
  const jobs = Object.values(title.jobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.name).toBe("Conventional PR title");
  expect(jobs[0]?.if).toBeUndefined(); // A skipped check must not green-light an invalid title on body edits.
  const steps = jobs[0]?.steps ?? [];
  expect(steps).toHaveLength(1);
  expect(steps[0]?.uses).toBeUndefined();
  expect(steps[0]?.env).toEqual({
    PR_TITLE: "${{ github.event.pull_request.title }}",
  });
  const command = z.string().parse(steps[0]?.run);
  for (const title of [
    "fix(ci): repair workflow",
    "feat!: changed contract",
    "docs: literal $(exit 91) `exit 92` text",
  ]) {
    await expect(
      executeWorkflowFixture("bash", ["-c", command], {
        env: { ...process.env, PR_TITLE: title },
      }),
    ).resolves.toMatchObject({ stderr: "" });
  }
  for (const title of ["", "Fix CI", "feat: "]) {
    await expect(
      executeWorkflowFixture("bash", ["-c", command], {
        env: { ...process.env, PR_TITLE: title },
      }),
    ).rejects.toMatchObject({ code: 1 });
  }
  expect((await workflow("ci.yml")).jobs["pr-title"]).toBeUndefined();
});

it("qualifies only ci:full label additions at the caller's merge revision", async () => {
  const full = await workflow("ci-full-pr.yml");
  expect(full.on.pull_request).toMatchObject({ types: ["labeled"] });
  expect(full.permissions).toEqual({ contents: "read", actions: "read" });
  expect(Object.values(full.jobs)).toEqual([
    {
      name: "Qualify labeled PR revision",
      if: "github.event.label.name == 'ci:full'",
      uses: "./.github/workflows/ci.yml",
      with: { source_sha: "${{ github.sha }}" },
    },
  ]);
  expect(full.jobs.qualification).not.toHaveProperty("secrets");
  // Metadata events must not create skipped replacements for the main CI checks.
  expect(full.jobs.required).toBeUndefined();
  expect(full.concurrency).toBeUndefined();
});
