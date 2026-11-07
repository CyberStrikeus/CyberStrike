import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execFileAsync = promisify(execFile);
const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  "continue-on-error": z.union([z.boolean(), z.string()]).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
});
const jobSchema = z.object({
  "continue-on-error": z.union([z.boolean(), z.string()]).optional(),
  if: z.string().optional(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  steps: z.array(stepSchema),
});

async function readReleaseWorkflow() {
  return z
    .object({
      on: z.record(z.string(), z.unknown()),
      concurrency: z.object({ group: z.string() }),
      jobs: z.object({
        "release-proposal": jobSchema,
        "release-please": jobSchema,
        "merged-release": jobSchema,
        qualification: z.object({
          if: z.string(),
          needs: z.array(z.string()),
          uses: z.string(),
          secrets: z.record(z.string(), z.string()),
          with: z.record(z.string(), z.union([z.string(), z.boolean()])),
        }),
        publish: jobSchema,
        "verify-npm": jobSchema,
        rehearsal: jobSchema.extend({
          permissions: z.record(z.string(), z.string()),
        }),
        "publish-mcp": jobSchema,
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/release.yml", import.meta.url),
          "utf8",
        ),
      ),
    );
}

it("validates the source before release creation and the prepared candidate before generation", async () => {
  const steps = (await readReleaseWorkflow()).jobs["release-please"].steps;
  const source = steps.findIndex(
    (step) =>
      step.name ===
      "Validate checkpoint version and ancestry before release creation",
  );
  const action = steps.findIndex((step) =>
    step.uses?.startsWith("googleapis/release-please-action@"),
  );
  const candidate = steps.findIndex(
    (step) =>
      step.name === "Validate prepared release version and migration notes",
  );
  const generation = steps.findIndex(
    (step) => step.name === "Regenerate release documentation",
  );
  expect(source).toBeGreaterThanOrEqual(0);
  expect(source).toBeLessThan(action);
  expect(steps[source]?.if).toBeUndefined();
  expect(steps[source]?.run).toContain("--source-sha");
  expect(candidate).toBeGreaterThan(action);
  expect(candidate).toBeLessThan(generation);
  expect(steps[candidate]?.if).toBe(
    "inputs.phase == 'prepare' && steps.proposal.outputs.prs_created == 'true'",
  );
  expect(steps[candidate]?.run).toContain("--stage candidate");
  for (const name of [
    "Check out release controller and Git history",
    "Check out release pull request",
  ]) {
    expect(
      steps.find((step) => step.name === name)?.with?.["fetch-depth"],
    ).toBe(0);
  }
});

it("keeps main pushes proposal-only and gates merged-release automation", async () => {
  const workflow = await readReleaseWorkflow();
  expect(workflow.on.push).toEqual({ branches: ["main"] });
  expect(workflow.on.pull_request).toMatchObject({
    types: ["closed"],
    branches: ["main"],
  });
  const proposal = workflow.jobs["release-proposal"];
  expect(proposal.if).toBe("github.event_name == 'push'");
  const controller = proposal.steps.find((step) =>
    step.run?.includes("scripts/release-proposal.mjs"),
  );
  expect(controller?.env?.GH_TOKEN).toBe(
    "${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}",
  );
  expect(controller?.run).toContain("--target-branch main");
  expect(controller?.run).toContain('--source-sha "$SOURCE_SHA"');
  expect(controller?.env?.SOURCE_SHA).toBe("${{ github.sha }}");
  expect(controller?.if).toBe("steps.editorial.outputs.frozen != 'true'");
  expect(
    proposal.steps.some((step) =>
      step.uses?.startsWith("googleapis/release-please-action@"),
    ),
  ).toBe(false);
  expect(
    proposal.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      ?.with,
  ).toMatchObject({
    "fetch-depth": 0,
    "persist-credentials": false,
  });
  expect(proposal.steps[0]?.run).toContain("rea:release-notes-finalized");
  expect(proposal.steps[0]?.run).toContain("--paginate");
  const merged = workflow.jobs["merged-release"];
  expect(merged.if).toContain("github.event.pull_request.merged == true");
  expect(merged.if).toContain("github.repository");
  expect(merged.if).toContain("release-please--branches--main--");
  expect(merged.outputs).toEqual({
    release_created: "${{ steps.release.outputs.release_created }}",
    sha: "${{ steps.release.outputs.sha }}",
  });
  expect(workflow.jobs["release-please"].if).toBe(
    "github.event_name == 'workflow_dispatch'",
  );
  expect(workflow.concurrency.group).toBe(
    "release-${{ inputs.release_branch || github.event.pull_request.merge_commit_sha || github.ref_name }}",
  );
});

const finalizedRelease = {
  number: 1399,
  headRefName: "release-please--branches--main--components--rea-agents",
  headRepository: { nameWithOwner: "fixture/rea" },
};

function editorialPage(nodes: unknown[], hasNextPage = false) {
  return {
    data: {
      repository: {
        nameWithOwner: "fixture/rea",
        pullRequests: {
          nodes,
          pageInfo: { hasNextPage, endCursor: hasNextPage ? "next" : null },
        },
      },
    },
  };
}

it.each([
  {
    name: "finalized release",
    pages: [editorialPage([finalizedRelease])],
    frozen: true,
  },
  { name: "no finalized PR", pages: [editorialPage([])], frozen: false },
  {
    name: "fork and unrelated head branch",
    pages: [
      editorialPage([
        { ...finalizedRelease, headRepository: { nameWithOwner: "fork/rea" } },
        {
          ...finalizedRelease,
          headRefName: "release-please--branches--other--component",
        },
        { ...finalizedRelease, headRepository: null },
      ]),
    ],
    frozen: false,
  },
  {
    name: "finalized release on a later page",
    pages: [editorialPage([], true), editorialPage([finalizedRelease])],
    frozen: true,
  },
])("preserves the proposal freeze for $name", async ({ pages, frozen }) => {
  const step = (await readReleaseWorkflow()).jobs["release-proposal"].steps[0];
  const directory = await createTestTempDirectory("rea-release-editorial-");
  const output = join(directory, "output");
  const summary = join(directory, "summary");
  const args = join(directory, "args");
  await writeFile(output, "");
  await writeFile(summary, "");
  await writeFile(join(directory, "pages"), JSON.stringify(pages));
  await writeFile(
    join(directory, "gh"),
    '#!/bin/sh\nprintf "%s\n" "$@" > "$GH_ARGS"\ncat "$GH_PAGES"\n',
    { mode: 0o755 },
  );
  await execFileAsync(
    "bash",
    ["-e", "-o", "pipefail", "-c", z.string().parse(step?.run)],
    {
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        GH_REPO: "fixture/rea",
        GH_ARGS: args,
        GH_PAGES: join(directory, "pages"),
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
    },
  );
  const request = await readFile(args, "utf8");
  expect(request).toContain("api\ngraphql\n--paginate\n--slurp");
  expect(request).toContain("owner=fixture");
  expect(request).toContain("name=rea");
  expect(request).toContain(
    'states:OPEN,baseRefName:"main",labels:["rea:release-notes-finalized"]',
  );
  expect(request).toContain("after:$endCursor");
  expect(await readFile(output, "utf8")).toBe(frozen ? "frozen=true\n" : "");
  expect(await readFile(summary, "utf8")).toBe(
    frozen
      ? "Finalized release notes on PR 1399; automatic proposal refresh is paused.\n"
      : "",
  );
});

it.each([
  { name: "transport quota failure", pages: [], status: 1 },
  {
    name: "partial GraphQL error",
    pages: [{ ...editorialPage([]), errors: [{ message: "quota exceeded" }] }],
    status: 0,
  },
  {
    name: "unavailable repository",
    pages: [{ data: { repository: null } }],
    status: 0,
  },
  {
    name: "missing nodes",
    pages: [
      {
        data: {
          repository: { nameWithOwner: "fixture/rea", pullRequests: {} },
        },
      },
    ],
    status: 0,
  },
  {
    name: "malformed PR",
    pages: [editorialPage([{ ...finalizedRelease, headRefName: null }])],
    status: 0,
  },
  {
    name: "missing head repository identity",
    pages: [
      editorialPage([
        {
          number: finalizedRelease.number,
          headRefName: finalizedRelease.headRefName,
        },
      ]),
    ],
    status: 0,
  },
  {
    name: "incomplete pagination",
    pages: [editorialPage([], true)],
    status: 0,
  },
  { name: "empty response", pages: [], status: 0 },
])("fails closed before release-please on $name", async ({ pages, status }) => {
  const step = (await readReleaseWorkflow()).jobs["release-proposal"].steps[0];
  const directory = await createTestTempDirectory(
    "rea-release-editorial-error-",
  );
  const output = join(directory, "output");
  await writeFile(output, "");
  await writeFile(join(directory, "pages"), JSON.stringify(pages));
  await writeFile(
    join(directory, "gh"),
    `#!/bin/sh\ncat "$GH_PAGES"\nexit ${status}\n`,
    { mode: 0o755 },
  );
  await expect(
    execFileAsync(
      "bash",
      [
        "-e",
        "-o",
        "pipefail",
        "-c",
        `${z.string().parse(step?.run)}\nprintf 'action-ran\n' >> "$GITHUB_OUTPUT"`,
      ],
      {
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          GH_REPO: "fixture/rea",
          GH_PAGES: join(directory, "pages"),
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(directory, "summary"),
        },
      },
    ),
  ).rejects.toMatchObject({ code: expect.any(Number) });
  expect(await readFile(output, "utf8")).toBe("");
});

it("validates the reviewed merge before creating its release", async () => {
  const workflow = await readReleaseWorkflow();
  const steps = workflow.jobs["merged-release"].steps;
  const checkout = steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout?.with).toMatchObject({
    ref: "${{ github.event.pull_request.merge_commit_sha }}",
    "fetch-depth": 0,
  });
  const checkpoint = steps.find((step) =>
    step.run?.includes("verify-release-checkpoint.mjs"),
  );
  expect(checkpoint?.run).toContain("--phase publish --release-branch main");
  expect(checkpoint?.run).toContain('--source-sha "$SOURCE_SHA"');
  const release = steps.find((step) => step.id === "release");
  expect(release?.with).toMatchObject({
    "target-branch": "main",
    "skip-github-release": false,
    "skip-github-pull-request": true,
  });
  const bind = steps.find(
    (step) => step.name === "Bind publication to the reviewed merge",
  );
  expect(bind?.env).toMatchObject({
    SOURCE_SHA: "${{ github.event.pull_request.merge_commit_sha }}",
    RELEASE_SHA: "${{ steps.release.outputs.sha }}",
  });
  const notesIndex = steps.findIndex((step) =>
    step.run?.includes("release-notes.mjs publication"),
  );
  expect(notesIndex).toBeGreaterThan(steps.indexOf(checkpoint!));
  expect(notesIndex).toBeLessThan(steps.indexOf(release!));
  expect(steps[notesIndex]?.run).toContain('--pr "$RELEASE_PR"');
});

it("keeps frozen candidate preparation and publication explicit", async () => {
  const workflow = await readReleaseWorkflow();
  expect(workflow.on.workflow_dispatch).toMatchObject({
    inputs: {
      release_branch: { required: true, type: "string" },
      phase: {
        required: true,
        type: "choice",
        default: "prepare",
        options: ["prepare", "publish"],
      },
    },
  });
  const release = workflow.jobs["release-please"].steps.find((step) =>
    step.uses?.startsWith("googleapis/release-please-action@"),
  );
  expect(release?.with).toMatchObject({
    token: "${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}",
    "target-branch": "${{ inputs.release_branch }}",
    "skip-github-release": false,
    "skip-github-pull-request": true,
  });
  expect(release?.if).toBe("inputs.phase == 'publish'");
  const steps = workflow.jobs["release-please"].steps;
  const proposal = steps.find((step) => step.id === "proposal");
  expect(proposal?.if).toBe("inputs.phase == 'prepare'");
  expect(proposal?.run).toContain("scripts/release-proposal.mjs");
  expect(proposal?.run).toContain('--target-branch "$RELEASE_BRANCH"');
  expect(proposal?.env?.SOURCE_SHA).toBe("${{ steps.branch.outputs.sha }}");
  expect(proposal?.run).toContain('--source-sha "$SOURCE_SHA"');
  const notesIndex = steps.findIndex((step) =>
    step.run?.includes("release-notes.mjs publication"),
  );
  expect(notesIndex).toBeGreaterThan(
    steps.findIndex((step) =>
      step.run?.includes("verify-release-checkpoint.mjs"),
    ),
  );
  expect(notesIndex).toBeLessThan(steps.indexOf(release!));
  expect(steps[notesIndex]?.if).toBe("inputs.phase == 'publish'");
  const catalogValidation = workflow.jobs["release-please"].steps.find(
    (step) => step.name === "Validate generated release documentation",
  );
  expect(catalogValidation?.run).toBe(
    "npm run docs:check && git diff --exit-code",
  );
});

it.skipIf(process.platform === "win32").each([
  { phase: "prepare", customToken: "" },
  { phase: "publish", customToken: "" },
  { phase: "prepare", customToken: "fixture-custom-token" },
  { phase: "publish", customToken: "fixture-custom-token" },
])(
  "accepts $phase with optional custom credentials: $customToken",
  async ({ phase, customToken }) => {
    const workflow = await readReleaseWorkflow();
    const steps = workflow.jobs["release-please"].steps;
    const actionIndex = steps.findIndex((step) =>
      step.uses?.startsWith("googleapis/release-please-action@"),
    );
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    const commands = steps
      .slice(0, actionIndex)
      .filter((step) =>
        [
          "Validate release selection",
          "Resolve release branch tip",
          "Require the publish dispatch to match the branch tip",
        ].includes(step.name ?? ""),
      )
      .filter(
        (step) =>
          step.if === undefined ||
          (phase === "publish" && step.if === "inputs.phase == 'publish'"),
      )
      .map((step) => z.string().parse(step.run));
    const directory = await createTestTempDirectory("rea-release-credential-");
    const output = join(directory, "github-output");
    await writeFile(
      join(directory, "gh"),
      '#!/bin/sh\nprintf "%s\\n" "$GITHUB_SHA"\n',
      { mode: 0o755 },
    );
    await expect(
      execFileAsync(
        "bash",
        ["-e", "-o", "pipefail", "-c", commands.join("\n")],
        {
          env: {
            ...process.env,
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
            RELEASE_PLEASE_TOKEN: customToken,
            GH_TOKEN: customToken || "fixture-built-in-token",
            RELEASE_PHASE: phase,
            RELEASE_BRANCH: "release/5.0.0",
            GITHUB_REF:
              phase === "prepare"
                ? "refs/heads/main"
                : "refs/heads/release/5.0.0",
            GITHUB_REPOSITORY: "fixture/fixture",
            GITHUB_SHA: "1111111111111111111111111111111111111111",
            BRANCH_SHA: "1111111111111111111111111111111111111111",
            GITHUB_OUTPUT: output,
          },
        },
      ),
    ).resolves.toMatchObject({ stderr: "" });
    expect(await readFile(output, "utf8")).toBe(
      "sha=1111111111111111111111111111111111111111\n",
    );
  },
);

it("binds npm and MCP publication to the same immutable release SHA", async () => {
  const workflow = await readReleaseWorkflow();
  expect(workflow.jobs["release-please"].outputs).toEqual({
    release_created: "${{ steps.release.outputs.release_created }}",
    sha: "${{ steps.release.outputs.sha }}",
  });
  expect(workflow.jobs.qualification.if).toContain("inputs.phase == 'publish'");
  expect(workflow.jobs.qualification.if).toContain(
    "needs.release-please.outputs.release_created",
  );
  expect(workflow.jobs.qualification.uses).toBe("./.github/workflows/ci.yml");
  expect(workflow.jobs.qualification.secrets).toEqual({
    TURBO_TOKEN: "${{ secrets.TURBO_TOKEN }}",
  });
  expect(workflow.jobs.qualification.with).toEqual({
    source_sha:
      "${{ needs.merged-release.outputs.sha || needs.release-please.outputs.sha }}",
    remote_cache_write: true,
  });
  expect(workflow.jobs.publish.needs).toContain("qualification");
  expect(workflow.jobs.publish.needs).toContain("rehearsal");
  expect(workflow.jobs.publish.if).toContain(
    "needs.rehearsal.result == 'success'",
  );
  expect(workflow.jobs.publish.if).toContain(
    "needs.qualification.result == 'success'",
  );
  expect(workflow.jobs["publish-mcp"].if).toContain(
    "needs.verify-npm.result == 'success'",
  );
  expect(workflow.jobs.publish.needs).toContain("merged-release");
  expect(workflow.jobs["publish-mcp"].needs).toContain("merged-release");
  for (const job of [
    workflow.jobs.rehearsal,
    workflow.jobs.publish,
    workflow.jobs["publish-mcp"],
  ]) {
    const checkout = job.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout?.with).toMatchObject({
      ref: "${{ needs.merged-release.outputs.sha || needs.release-please.outputs.sha }}",
      "persist-credentials": false,
    });
  }
  const preparation = [
    "Check out release pull request",
    "Set up Node.js for generated documentation",
    "Install dependencies",
    "Regenerate release documentation",
    "Validate generated release documentation",
  ];
  for (const name of preparation) {
    expect(
      workflow.jobs["release-please"].steps.find((step) => step.name === name)
        ?.if,
    ).toBe(
      "inputs.phase == 'prepare' && steps.proposal.outputs.prs_created == 'true'",
    );
  }
  const publishCommand = workflow.jobs.publish.steps.find(
    (step) => step.name === "Publish",
  )?.run;
  expect(publishCommand).toContain("--ignore-scripts");
  expect(publishCommand).toContain(
    '--registry=https://registry.npmjs.org --access=public --tag="$NPM_RELEASE_TAG"',
  );
});

it.skipIf(process.platform === "win32").each([
  {
    created: "false",
    releaseSha: "1111111111111111111111111111111111111111",
    succeeds: false,
    reason: "did not create a release",
  },
  {
    created: "true",
    releaseSha: "1111111111111111111111111111111111111111",
    succeeds: true,
  },
  {
    created: "true",
    releaseSha: "2222222222222222222222222222222222222222",
    succeeds: false,
    reason: "refusing mismatched publication provenance",
  },
])(
  "publishes a merged release only when Release Please creates it at the reviewed SHA: $created/$releaseSha",
  async ({ created, releaseSha, succeeds, reason }) => {
    const workflow = await readReleaseWorkflow();
    const command = z
      .string()
      .parse(
        workflow.jobs["merged-release"].steps.find(
          (step) => step.name === "Bind publication to the reviewed merge",
        )?.run,
      );
    const result = execFileAsync(
      "bash",
      ["-e", "-o", "pipefail", "-c", command],
      {
        env: {
          ...process.env,
          SOURCE_SHA: "1111111111111111111111111111111111111111",
          RELEASE_CREATED: created,
          RELEASE_SHA: releaseSha,
        },
      },
    );
    if (succeeds) {
      await expect(result).resolves.toMatchObject({ stderr: "" });
    } else {
      await expect(result).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(z.string().parse(reason)),
      });
    }
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["main", "feature/new-work", "release/", "release/../main"])(
  "rejects %s as a checkpoint before contacting GitHub",
  async (releaseBranch) => {
    const workflow = await readReleaseWorkflow();
    const command = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) => step.name === "Validate release selection",
        )?.run,
      );
    await expect(
      execFileAsync("bash", ["-e", "-o", "pipefail", "-c", command], {
        env: {
          ...process.env,
          GITHUB_REF: "refs/heads/main",
          RELEASE_BRANCH: releaseBranch,
          RELEASE_PHASE: "prepare",
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/release_branch/u),
    });
  },
);

it.skipIf(process.platform === "win32").each([
  { phase: "prepare", ref: "refs/heads/feature/unreviewed-workflow" },
  { phase: "publish", ref: "refs/heads/main" },
  { phase: "publish", ref: "refs/heads/release/another-version" },
])(
  "rejects $phase from $ref before contacting GitHub",
  async ({ phase, ref }) => {
    const workflow = await readReleaseWorkflow();
    const command = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) => step.name === "Validate release selection",
        )?.run,
      );
    await expect(
      execFileAsync("bash", ["-e", "-o", "pipefail", "-c", command], {
        env: {
          ...process.env,
          GITHUB_REF: ref,
          RELEASE_BRANCH: "release/5.0.0",
          RELEASE_PHASE: phase,
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Run ${phase} from`),
    });
  },
);

it.skipIf(process.platform === "win32")(
  "checks the checkpoint locally and resolves the branch tip separately",
  async () => {
    const workflow = await readReleaseWorkflow();
    const validate = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) => step.name === "Validate release selection",
        )?.run,
      );
    expect(validate).not.toMatch(/\bgh\b/u);
    const resolve = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) => step.name === "Resolve release branch tip",
        )?.run,
      );
    expect(resolve).toContain("gh api");
    for (const releaseBranch of ["release/5.0.0", "release/5.0.0-rc.1"]) {
      await expect(
        execFileAsync("bash", ["-e", "-o", "pipefail", "-c", validate], {
          env: {
            ...process.env,
            GITHUB_REF: "refs/heads/main",
            RELEASE_BRANCH: releaseBranch,
            RELEASE_PHASE: "prepare",
          },
        }),
      ).resolves.toMatchObject({ stderr: "" });
    }
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["", "release", "prepare ", "true"])(
  "rejects phase %j before contacting GitHub",
  async (phase) => {
    const workflow = await readReleaseWorkflow();
    const command = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) => step.name === "Validate release selection",
        )?.run,
      );
    await expect(
      execFileAsync("bash", ["-e", "-o", "pipefail", "-c", command], {
        env: {
          ...process.env,
          GITHUB_REF: "refs/heads/main",
          RELEASE_BRANCH: "release/5.0.0",
          RELEASE_PHASE: phase,
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("phase must be prepare or publish"),
    });
  },
);

it.skipIf(process.platform === "win32").each([true, false])(
  "creates a release only when the branch tip is the dispatched checkpoint (match: %s)",
  async (match) => {
    const workflow = await readReleaseWorkflow();
    const command = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) =>
            step.name ===
            "Require the publish dispatch to match the branch tip",
        )?.run,
      );
    const result = execFileAsync(
      "bash",
      ["-e", "-o", "pipefail", "-c", command],
      {
        env: {
          ...process.env,
          GITHUB_SHA: "1111111111111111111111111111111111111111",
          BRANCH_SHA: match
            ? "1111111111111111111111111111111111111111"
            : "2222222222222222222222222222222222222222",
        },
      },
    );
    if (match) {
      await expect(result).resolves.toMatchObject({ stderr: "" });
    } else {
      await expect(result).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "refusing to create a release for a moved source",
        ),
      });
    }
  },
);

it.skipIf(process.platform === "win32").each([true, false])(
  "publishes only when the tag and provenance source match (match: %s)",
  async (match) => {
    const workflow = await readReleaseWorkflow();
    const command = z
      .string()
      .parse(
        workflow.jobs["release-please"].steps.find(
          (step) =>
            step.name === "Bind publication to the dispatched checkpoint",
        )?.run,
      );
    const result = execFileAsync(
      "bash",
      ["-e", "-o", "pipefail", "-c", command],
      {
        env: {
          ...process.env,
          GITHUB_SHA: "1111111111111111111111111111111111111111",
          RELEASE_SHA: match
            ? "1111111111111111111111111111111111111111"
            : "2222222222222222222222222222222222222222",
        },
      },
    );
    if (match) {
      await expect(result).resolves.toMatchObject({ stderr: "" });
    } else {
      await expect(result).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "refusing to publish mismatched source provenance",
        ),
      });
    }
  },
);

it("runs release PR CI without enabling implementation pushes on release branches", async () => {
  const workflow = z
    .object({
      on: z.object({
        push: z.object({ branches: z.array(z.string()) }),
        pull_request: z.object({ branches: z.array(z.string()) }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci.yml", import.meta.url),
          "utf8",
        ),
      ),
    );
  expect(workflow.on.push.branches).toEqual(["main"]);
  expect(workflow.on.pull_request.branches).toEqual(
    expect.arrayContaining(["main", "release/*"]),
  );
});

it("routes website verification through the central PR policy", async () => {
  const workflow = z
    .object({
      on: z
        .object({ workflow_call: z.null(), workflow_dispatch: z.null() })
        .passthrough(),
    })
    .parse(
      parse(
        await readFile(
          new URL(
            "../../../.github/workflows/website-check.yml",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
  expect(workflow.on).not.toHaveProperty("pull_request");
  const ci = z
    .object({
      jobs: z.object({
        website: z.object({
          uses: z.string(),
          if: z.string(),
        }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci.yml", import.meta.url),
          "utf8",
        ),
      ),
    );
  expect(ci.jobs.website.uses).toBe("./.github/workflows/website-check.yml");
  expect(ci.jobs.website.if).toBe("needs.changes.outputs.website == 'true'");
});

// The rehearsal executes the retained archive on a new read-only runner; the
// process boundary suite exercises its real installation and protocol checks.
it("rehearses the qualified archive before npm authority and retains registry verification", async () => {
  const workflow = await readReleaseWorkflow();
  const rehearsal = workflow.jobs.rehearsal;
  expect(rehearsal.permissions).toEqual({ contents: "read", actions: "read" });
  expect(rehearsal["continue-on-error"]).toBeUndefined();
  expect(rehearsal.needs).toContain("qualification");
  expect(rehearsal.if).toContain("needs.qualification.result == 'success'");
  const exerciseIndex = rehearsal.steps.findIndex((step) =>
    step.run?.includes("verify-release-artifact.mjs"),
  );
  const exercise = rehearsal.steps[exerciseIndex];
  expect(exercise?.env).toEqual({
    VERIFIED_PACKAGE_TARBALL: "${{ steps.package.outputs.tarball }}",
    VERIFIED_PACKAGE_VERSION: "${{ steps.package.outputs.version }}",
  });
  expect(exercise?.if).toBeUndefined();
  expect(exercise?.["continue-on-error"]).toBeUndefined();
  const publish = workflow.jobs.publish;
  expect(publish.needs).toContain("rehearsal");
  expect(publish.if).toContain("needs.rehearsal.result == 'success'");
  const verification = workflow.jobs["verify-npm"];
  for (const job of [rehearsal, verification]) {
    const inputs = job.steps.findIndex(
      (step) => step.uses === "./.github/actions/prepare-release-package",
    );
    expect(inputs).toBeGreaterThanOrEqual(0);
    expect(job.steps[inputs]?.id).toBe("package");
    expect(job.steps[inputs]?.if).toBeUndefined();
    expect(job.steps[inputs]?.["continue-on-error"]).toBeUndefined();
    if (job === rehearsal) expect(exerciseIndex).toBeGreaterThan(inputs);
  }
  const action = z
    .object({
      outputs: z.object({
        tarball: z.object({ value: z.string() }),
        version: z.object({ value: z.string() }),
      }),
      runs: z.object({ steps: z.array(stepSchema) }),
    })
    .parse(
      parse(
        await readFile(
          ".github/actions/prepare-release-package/action.yml",
          "utf8",
        ),
      ),
    );
  expect(action.outputs.tarball.value).toBe(
    "${{ steps.package.outputs.tarball }}",
  );
  expect(action.outputs.version.value).toBe(
    "${{ steps.package.outputs.version }}",
  );
  const archive = action.runs.steps.findIndex(
    (step) => step.with?.name === "verified-release-package",
  );
  const validation = action.runs.steps.findIndex((step) =>
    step.run?.includes("scripts/ci/verified-package.mjs validate"),
  );
  const runtime = action.runs.steps.findIndex(
    (step) => step.with?.name === "rea-test-runtime",
  );
  expect(archive).toBeGreaterThanOrEqual(0);
  expect(validation).toBeGreaterThan(archive);
  expect(runtime).toBeGreaterThan(validation);
  for (const step of action.runs.steps) {
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
  }
  expect(publish.permissions).toEqual({
    contents: "read",
    "id-token": "write",
  });
  expect(
    publish.steps.filter((step) => step.run).map((step) => step.run),
  ).toEqual([
    "node scripts/ci/prepare-npm-publication.mjs",
    expect.stringContaining(
      "npm publish .cache/verified-package/package.tgz --ignore-scripts",
    ),
  ]);
  expect(
    publish.steps
      .filter((step) => step.uses?.startsWith("actions/download-artifact@"))
      .map((step) => step.with?.name),
  ).toEqual(["verified-release-package"]);
  expect(publish.steps.find((step) => step.name === "Publish")?.if).toBe(
    "steps.package.outputs.published == 'false'",
  );
  expect(verification.needs).toContain("publish");
  expect(verification.if).toContain("needs.publish.result == 'success'");
  expect(verification.permissions).toEqual({
    contents: "read",
    actions: "read",
  });
  const commands = verification.steps.map((step) => step.run ?? "");
  const bytes = commands.findIndex((command) =>
    command.includes("npm-release.mjs verify"),
  );
  const canary = commands.findIndex((command) =>
    command.includes("verify-published-package.mjs"),
  );
  expect(bytes).toBeGreaterThanOrEqual(0);
  expect(canary).toBeGreaterThan(bytes);
  for (const index of [bytes, canary]) {
    expect(verification.steps[index]?.if).toBeUndefined();
    expect(verification.steps[index]?.["continue-on-error"]).toBeUndefined();
  }
  expect(workflow.jobs["publish-mcp"].needs).toContain("verify-npm");
  for (const job of [
    rehearsal,
    publish,
    verification,
    workflow.jobs["publish-mcp"],
  ]) {
    expect(job.env?.TURBO_TOKEN).toBe("");
    expect(job.env?.TURBO_CACHE).toBe("local:rw");
  }
});
