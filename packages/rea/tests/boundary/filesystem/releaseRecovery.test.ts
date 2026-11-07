import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import {
  selectRecoveryRelease,
  verifyRecoveryPackage,
} from "../../../scripts/ci/release-recovery.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const sourceSha = "a".repeat(40);
const job = (name: string, conclusion = "success") => ({
  name,
  status: "completed",
  conclusion,
  steps: [],
});
const selection = () => ({
  repository: "fixture/rea",
  version: "6.5.0",
  tagSha: sourceSha,
  run: {
    id: 123,
    run_attempt: 1,
    path: ".github/workflows/release.yml",
    event: "pull_request",
    status: "completed",
    repository: { full_name: "fixture/rea" },
    head_repository: { full_name: "fixture/rea" },
  },
  release: {
    tag_name: "rea-agents-6.5.0",
    draft: false,
    published_at: "2026-10-14T12:32:45Z",
  },
  jobs: [
    job("Release reviewed main merge"),
    job("Qualify exact release revision / CI required"),
    {
      ...job("Publish to npm", "failure"),
      steps: [{ name: "Publish", conclusion: "success" }],
    },
  ],
});

it("recovers a failed post-publication run using its successful original qualification", () => {
  expect(selectRecoveryRelease(selection())).toEqual({
    version: "6.5.0",
    source_sha: sourceSha,
    run_id: 123,
    run_attempt: 1,
  });
});

it.each(["legacy publisher", "separate verification"])(
  "recovers a byte-verified existing version from %s when the npm write was skipped",
  (location) => {
    const input = selection();
    input.jobs[2]!.steps[0]!.conclusion = "skipped";
    const verified = {
      name: "Verify published npm bytes and dist-tag",
      conclusion: "success",
    };
    if (location === "legacy publisher") input.jobs[2]!.steps.push(verified);
    else
      input.jobs.push({
        ...job("Verify published npm package", "failure"),
        steps: [verified],
      });
    expect(selectRecoveryRelease(input)).toMatchObject({
      version: "6.5.0",
      run_id: 123,
    });
  },
);

it.each(["failure", "skipped", "cancelled"])(
  "refuses recovery when original qualification was %s",
  (conclusion) => {
    const input = selection();
    input.jobs[1]!.conclusion = conclusion;
    expect(() => selectRecoveryRelease(input)).toThrow("did not pass");
  },
);

it("refuses absent or ambiguous qualification and unsuccessful npm publication", () => {
  const missing = selection();
  missing.jobs.splice(1, 1);
  expect(() => selectRecoveryRelease(missing)).toThrow(
    "Expected one completed",
  );
  const duplicate = selection();
  duplicate.jobs.push(job("Qualify exact release revision / CI required"));
  expect(() => selectRecoveryRelease(duplicate)).toThrow(
    "Expected one completed",
  );
  const unpublished = selection();
  unpublished.jobs[2]!.steps[0]!.conclusion = "failure";
  expect(() => selectRecoveryRelease(unpublished)).toThrow(
    "publication did not succeed",
  );
});

it.each(["duplicate", "running"])(
  "refuses %s original npm verification jobs",
  (condition) => {
    const input = selection();
    const verification = {
      ...job("Verify published npm package"),
      steps: [
        {
          name: "Verify published npm bytes and dist-tag",
          conclusion: "success",
        },
      ],
    };
    input.jobs.push(verification);
    if (condition === "duplicate") input.jobs.push(verification);
    else verification.status = "in_progress";
    expect(() => selectRecoveryRelease(input)).toThrow(
      "Expected at most one completed",
    );
  },
);

it("refuses foreign runs, unrelated workflows and unpublished releases", () => {
  const foreign = selection();
  foreign.run.head_repository.full_name = "outside/rea";
  expect(() => selectRecoveryRelease(foreign)).toThrow();
  const unrelated = selection();
  unrelated.run.path = ".github/workflows/ci.yml";
  expect(() => selectRecoveryRelease(unrelated)).toThrow();
  const draft = selection();
  draft.release.draft = true;
  expect(() => selectRecoveryRelease(draft)).toThrow();
  const wrongTag = selection();
  wrongTag.release.tag_name = "rea-agents-6.6.0";
  expect(() => selectRecoveryRelease(wrongTag)).toThrow();
});

it.each([1, 2])(
  "requires npm bytes to match the original v%d archive/source/run",
  async (schemaVersion) => {
    const directory = await createTestTempDirectory("rea-release-recovery-");
    const archive = "original qualified archive";
    await writeFile(join(directory, "package.tgz"), archive);
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        schemaVersion,
        ...(schemaVersion === 2 ? { releaseTag: "latest" } : {}),
        sourceSha,
        runId: 123,
        runAttempt: 1,
        platform: "linux",
        architecture: "x64",
        packageVersion: "6.5.0",
        nodeVersion: process.version,
        sha256: createHash("sha256").update(archive).digest("hex"),
      }),
    );
    const input = {
      directory,
      sourceSha,
      runId: 123,
      runAttempt: 1,
      version: "6.5.0",
      integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    };
    await expect(verifyRecoveryPackage(input)).resolves.toMatchObject({
      version: "6.5.0",
      sourceSha,
    });
    await expect(
      verifyRecoveryPackage({ ...input, integrity: "sha512-wrong" }),
    ).rejects.toThrow("npm integrity differs");
    await expect(
      verifyRecoveryPackage({ ...input, sourceSha: "b".repeat(40) }),
    ).rejects.toThrow("source SHA mismatch");
    await expect(
      verifyRecoveryPackage({ ...input, runId: 456 }),
    ).rejects.toThrow("workflow run ID mismatch");
  },
);

it("limits recovery to verification and dependent MCP publication from the released source", async () => {
  const step = z.object({
    uses: z.string().optional(),
    run: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  });
  const workflow = z
    .object({
      on: z.record(z.string(), z.unknown()),
      jobs: z.object({
        verify: z.object({
          if: z.string(),
          permissions: z.record(z.string(), z.string()),
          steps: z.array(step),
        }),
        "publish-mcp": z.object({
          needs: z.string(),
          permissions: z.record(z.string(), z.string()),
          steps: z.array(step),
        }),
      }),
    })
    .parse(
      parse(await readFile(".github/workflows/release-recovery.yml", "utf8")),
    );
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.jobs.verify.if).toBe("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.verify.permissions).toEqual({
    contents: "read",
    actions: "read",
  });
  const steps = workflow.jobs.verify.steps;
  for (const name of ["verified-release-package", "rea-test-runtime"])
    expect(
      steps.find((candidate) => candidate.with?.name === name)?.with,
    ).toMatchObject({
      "run-id": "${{ steps.release.outputs.run_id }}",
      "github-token": "${{ github.token }}",
    });
  const digest = steps.findIndex(
    (candidate) =>
      candidate.run === "node scripts/ci/release-recovery.mjs verify",
  );
  const canary = steps.findIndex((candidate) =>
    candidate.run?.includes("verify-published-package.mjs"),
  );
  const rehearsal = steps.findIndex((candidate) =>
    candidate.run?.includes("verify-release-artifact.mjs"),
  );
  expect(digest).toBeGreaterThanOrEqual(0);
  expect(rehearsal).toBeGreaterThan(digest);
  expect(canary).toBeGreaterThan(rehearsal);
  const publisher = workflow.jobs["publish-mcp"];
  expect(publisher.needs).toBe("verify");
  expect(
    publisher.steps.find(
      (candidate) => candidate.with?.path === ".cache/release-source",
    )?.with?.ref,
  ).toBe("${{ needs.verify.outputs.source_sha }}");
  expect(
    publisher.steps.find(
      (candidate) => candidate.uses === "./.github/actions/publish-mcp",
    )?.with,
  ).toEqual({ directory: ".cache/release-source" });
  for (const candidate of [...steps, ...publisher.steps]) {
    expect(candidate.run ?? "").not.toMatch(
      /npm publish|git tag|gh release create/u,
    );
    expect(candidate.uses ?? "").not.toContain("release-please");
  }
});
