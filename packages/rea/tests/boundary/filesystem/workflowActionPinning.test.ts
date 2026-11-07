import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const github = fileURLToPath(new URL("../../../.github/", import.meta.url));
const steps = z.array(z.object({ uses: z.string().optional() })).optional();
const actionReferences = z.object({
  jobs: z
    .record(z.string(), z.object({ uses: z.string().optional(), steps }))
    .optional(),
  runs: z.object({ steps }).optional(),
});

// Inspect action/workflow call sites, not arbitrary inputs named `uses` or
// shell source. YAML parsing also covers flow syntax and quoted references.
const unpinnedReferences = (source: string): readonly string[] => {
  const document = actionReferences.parse(parse(source));
  const references = [
    ...Object.values(document.jobs ?? {}).flatMap((job) => [
      job.uses,
      ...(job.steps ?? []).map((step) => step.uses),
    ]),
    ...(document.runs?.steps ?? []).map((step) => step.uses),
  ];
  return references.filter(
    (reference): reference is string =>
      reference !== undefined &&
      !reference.startsWith("./") &&
      (reference.startsWith("docker://")
        ? !/@sha256:[0-9a-f]{64}$/iu.test(reference)
        : !/@[0-9a-f]{40}$/iu.test(reference)),
  );
};

describe("external GitHub action pinning", () => {
  const sha = "11d5960a326750d5838078e36cf38b85af677262";

  it("finds mutable GitHub and Docker references in all action call sites", () => {
    expect(
      unpinnedReferences(`
jobs:
  call:
    uses: owner/repo/.github/workflows/build.yml@main
  build:
    steps:
      - uses: actions/checkout@v4
      - { uses: actions/setup-node@v4 }
      - uses: docker://alpine:3.20
      - uses: docker://alpine@sha256:abcd
runs:
  using: composite
  steps:
    - uses: "actions/cache@v4"
`),
    ).toEqual([
      "owner/repo/.github/workflows/build.yml@main",
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "docker://alpine:3.20",
      "docker://alpine@sha256:abcd",
      "actions/cache@v4",
    ]);
  });

  it("accepts full GitHub SHAs, local calls and Docker SHA256 digests", () => {
    expect(
      unpinnedReferences(`
jobs:
  local:
    uses: ./.github/workflows/build.yml
  remote:
    uses: owner/repo/.github/workflows/build.yml@${sha}
  build:
    steps:
      - uses: "actions/checkout@${sha}" # version comment
      - uses: actions/cache/restore@${sha.toUpperCase()}
      - uses: './.github/actions/npm-cache'
      - uses: docker://alpine@sha256:${"a".repeat(64)}
`),
    ).toEqual([]);
  });

  it("ignores inputs, environment and shell source named uses", () => {
    expect(
      unpinnedReferences(`
env: { uses: ordinary-value }
jobs:
  build:
    steps:
      - uses: actions/checkout@${sha}
        with: { uses: ordinary-input }
      - run: 'echo "uses: actions/example@main"'
`),
    ).toEqual([]);
  });

  it("also runs the guard for workflow-only changes without preparing runtime artifacts", async () => {
    const workflow = z
      .object({
        jobs: z.object({
          static: z.object({
            steps: z.array(
              z.object({
                if: z.string().optional(),
                run: z.string().optional(),
              }),
            ),
          }),
        }),
      })
      .parse(parse(await readFile(join(github, "workflows/ci.yml"), "utf8")));
    const guard = workflow.jobs.static.steps.find((step) =>
      step.run?.includes("workflowActionPinning.test.ts"),
    );
    expect(guard?.if).toBe(
      "needs.changes.outputs.workflows == 'true' && needs.changes.outputs.code != 'true'",
    );
    expect(guard?.run).toBe(
      "node scripts/run-exact-tests.mjs run tests/boundary/filesystem/workflowActionPinning.test.ts",
    );
  });

  it("pins external actions in all repository workflows and composite actions", async () => {
    const workflows = join(github, "workflows");
    const actions = join(github, "actions");
    const files = [
      ...(await readdir(workflows))
        .filter((name) => /\.ya?ml$/u.test(name))
        .map((name) => join(workflows, name)),
      ...(await readdir(actions, { recursive: true }))
        .filter((name) => /(?:^|[/\\])action\.ya?ml$/u.test(name))
        .map((name) => join(actions, name)),
    ].sort();
    const unpinned: string[] = [];
    for (const file of files) {
      for (const reference of unpinnedReferences(
        await readFile(file, "utf8"),
      )) {
        unpinned.push(`${file}: ${reference}`);
      }
    }
    expect(unpinned).toEqual([]);
  });
});
