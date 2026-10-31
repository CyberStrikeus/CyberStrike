import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { minVersion, subset } from "semver";
import { parse } from "yaml";
import { z } from "zod";
import { executeWorkflowFixture } from "../../support/workflowGit.js";

const workflow = async (filename = "ci.yml") =>
  z
    .object({
      jobs: z.record(
        z.string(),
        z
          .object({
            needs: z.union([z.string(), z.array(z.string())]).optional(),
          })
          .passthrough(),
      ),
    })
    .parse(
      parse(
        await readFile(
          new URL(`../../../.github/workflows/${filename}`, import.meta.url),
          "utf8",
        ),
      ),
    );

const scopeFlags = async () =>
  z
    .object({ CI_FLAGS: z.array(z.string()) })
    .parse(
      await import(
        new URL("../../../scripts/ci/scopes.mjs", import.meta.url).href
      ),
    ).CI_FLAGS;

it("keeps every SQLite runtime selector inside the published package engine range", async () => {
  const { engines } = z
    .object({ engines: z.object({ node: z.string() }) })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../../../package.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  const { strategy } = z
    .object({
      strategy: z.object({ matrix: z.object({ node: z.array(z.string()) }) }),
    })
    .parse((await workflow("sqlite-runtime.yml")).jobs.sqlite);
  const selectors = strategy.matrix.node;
  const pinned = (
    await readFile(new URL("../../../.nvmrc", import.meta.url), "utf8")
  ).trim();
  expect(selectors).toContain(pinned);
  expect(
    new Set(selectors.map((selector) => minVersion(selector)?.major)),
  ).toEqual(new Set([22, 24, 26]));
  for (const selector of selectors)
    expect(subset(selector, engines.node), selector).toBe(true);
});

it("binds SQLite compatibility jobs to the build's prepared runtime artifact and root layout", async () => {
  expect((await workflow()).jobs["sqlite-runtime"]?.if).toBe(
    "needs.changes.outputs.sqlite == 'true'",
  );
  const steps = z.array(
    z.object({
      uses: z.string().optional(),
      with: z
        .object({ name: z.string().optional(), path: z.string().optional() })
        .optional(),
    }),
  );
  const uploads = steps.parse((await workflow()).jobs.build?.steps).filter(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact@") &&
      step.with?.path
        ?.split(/\r?\n/u)
        .map((path) => path.trim())
        .includes("dist/"),
  );
  expect(uploads).toHaveLength(1);
  const name = z.string().min(1).parse(uploads[0]?.with?.name);
  const downloads = steps
    .parse((await workflow("sqlite-runtime.yml")).jobs.sqlite?.steps)
    .filter((step) => step.uses?.startsWith("actions/download-artifact@"));
  expect(downloads).toHaveLength(1);
  expect(downloads[0]?.with).toEqual({ name, path: "." });
});

it("requires each named SQLite compatibility test while retaining both directory suites", async () => {
  const { scripts } = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../../../package.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  const commands = z
    .string()
    .parse(scripts["test:sqlite:run"])
    .split("&&")
    .map((command) => command.trim().split(/\s+/u));
  const exact = commands.find(
    (command) =>
      command[0] === "node" &&
      command[1] === "scripts/run-exact-tests.mjs" &&
      command[2] === "run",
  );
  expect(exact).toEqual(
    expect.arrayContaining([
      "tests/acceptance/sqliteDatabaseCli.test.ts",
      "tests/boundary/mcp/serverLifecycleMcp.test.ts",
    ]),
  );
  const directories = commands.find(
    (command) => command[0] === "vitest" && command[1] === "run",
  );
  expect(directories).toEqual(
    expect.arrayContaining([
      "src/application/sqlite/",
      "tests/boundary/sqlite/",
    ]),
  );
  const steps = z
    .array(z.object({ run: z.string().optional() }))
    .parse((await workflow("sqlite-runtime.yml")).jobs.sqlite?.steps);
  expect(steps.some((step) => step.run === "npm run test:sqlite:run")).toBe(
    true,
  );
});

it("exports every canonical scope with read authority for admission and keeps telemetry outside the gate", async () => {
  const { jobs } = await workflow();
  const CI_FLAGS = await scopeFlags();
  const outputs = z.record(z.string(), z.string()).parse(jobs.changes?.outputs);
  expect(jobs.changes?.permissions).toEqual({
    contents: "read",
    actions: "read",
  });
  expect(jobs.build?.permissions).toEqual({
    contents: "read",
    actions: "read",
  });
  for (const flag of CI_FLAGS)
    expect(outputs[flag]).toBe(`\${{ steps.plan.outputs.${flag} }}`);
  const steps = z
    .array(
      z.object({
        run: z.string().optional(),
        if: z.string().optional(),
      }),
    )
    .parse(jobs.required?.steps);
  const telemetry = steps.find((step) =>
    step.run?.includes("scripts/ci/job-timings.mjs"),
  );
  expect(telemetry).toBeUndefined();
  const timings = z
    .object({
      on: z.object({
        schedule: z.array(z.object({ cron: z.string() })),
        workflow_dispatch: z.unknown(),
        workflow_run: z.unknown().optional(),
      }),
      permissions: z.record(z.string(), z.string()),
      jobs: z.object({
        report: z.object({
          steps: z.array(
            z.object({
              uses: z.string().optional(),
              run: z.string().optional(),
              with: z.record(z.string(), z.unknown()).optional(),
              env: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci-timings.yml", import.meta.url),
          "utf8",
        ),
      ),
    );
  expect(timings.on.workflow_run).toBeUndefined();
  expect(timings.on.schedule).toHaveLength(1);
  expect(timings.permissions).toEqual({
    contents: "read",
    actions: "read",
    "pull-requests": "read",
  });
  const checkout = timings.jobs.report.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout?.with).toEqual({
    ref: "${{ github.event.repository.default_branch }}",
    "persist-credentials": false,
  });
  const report = timings.jobs.report.steps.find((step) =>
    step.run?.includes("scripts/ci/job-timings-batch.mjs"),
  );
  expect(report?.env?.CI_REPOSITORY).toBe("${{ github.repository }}");
});

const requiredNeeds = async () => {
  const { jobs } = await workflow();
  return { jobs, needs: z.array(z.string()).parse(jobs.required?.needs) };
};

it("makes the required gate wait for every CI lane, including future additions", async () => {
  const { jobs, needs } = await requiredNeeds();
  expect(new Set(needs)).toEqual(
    new Set(Object.keys(jobs).filter((name) => name !== "required")),
  );
});

it("runs architecture guards for fast code feedback before installing dependencies", async () => {
  const steps = z
    .array(
      z
        .object({
          run: z.string().optional(),
          uses: z.string().optional(),
          if: z.string().optional(),
        })
        .passthrough(),
    )
    .parse((await workflow()).jobs.static?.steps);
  const guard = steps.findIndex(
    (step) => step.run === "node scripts/verify/architecture-guards.mjs",
  );
  const setup = steps.findIndex((step) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  const install = steps.findIndex((step) => step.run === "npm ci");
  expect(guard).toBeGreaterThanOrEqual(0);
  expect(setup).toBeGreaterThanOrEqual(0);
  expect(install).toBeGreaterThan(guard);
  expect(guard).toBeGreaterThan(setup);
  expect(steps[guard]?.if).toBe("needs.changes.outputs.code == 'true'");
  expect(steps[guard]?.["continue-on-error"]).toBeUndefined();
});

it("holds native and provider fan-out behind static validation while portable feedback stays independent", async () => {
  const { jobs } = await workflow();
  const earlyJobs = new Set([
    "changes",
    "static",
    "static-deep",
    "python",
    "build",
    "test-shard",
    "test-source",
    "test",
    "docs",
    "required",
  ]);
  for (const [name, job] of Object.entries(jobs)) {
    if (earlyJobs.has(name)) continue;
    expect(job.needs, `${name} must wait for static validation`).toContain(
      "static",
    );
    expect(job.if).not.toMatch(/always\(|cancelled\(/u);
  }
  expect(jobs["test-shard"]?.needs).not.toContain("static");
  const stepRuns = z.array(z.object({ run: z.string().optional() }));
  expect(jobs["static-deep"]?.needs).toBe("changes");
  expect(String(jobs["static-deep"]?.if)).toContain("tier == 'full'");
  expect(String(jobs["static-deep"]?.if)).toContain("code == 'true'");
  const staticRuns = stepRuns.parse(jobs.static?.steps);
  const deepRuns = stepRuns.parse(jobs["static-deep"]?.steps);
  expect(staticRuns.some((step) => step.run === "npm run check:ci:fast")).toBe(
    true,
  );
  expect(
    staticRuns.some(
      (step) =>
        step.run === "npm run check:ci:deep" ||
        step.run === "npm run test:python",
    ),
  ).toBe(false);
  expect(deepRuns.some((step) => step.run === "npm run check:ci:deep")).toBe(
    true,
  );
  for (const [name, job] of Object.entries(jobs)) {
    if (
      name === "required" ||
      name === "static-deep" ||
      job.needs === undefined
    )
      continue;
    expect(job.needs, `${name} must not wait for deep static`).not.toContain(
      "static-deep",
    );
  }
});

const trustedRemoteCacheWrite =
  "${{ inputs.remote_cache_write == true || (github.ref == format('refs/heads/{0}', github.event.repository.default_branch) && (github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')) }}";

async function assertProviderCacheCallers(
  jobs: Awaited<ReturnType<typeof workflow>>["jobs"],
  consumers: readonly string[],
) {
  for (const name of consumers) {
    const caller = jobs[name];
    expect(caller?.needs).toContain("build");
    expect(caller?.secrets).toEqual({
      TURBO_TOKEN: "${{ secrets.TURBO_TOKEN }}",
    });
    expect(caller?.with).toEqual({
      build_cache_artifact: "rea-build-cache",
      remote_cache_write: trustedRemoteCacheWrite,
    });
    const path = z.string().parse(caller?.uses);
    const called = z
      .object({
        on: z.object({
          workflow_call: z.object({
            inputs: z.record(z.string(), z.unknown()),
            secrets: z.object({
              TURBO_TOKEN: z.object({ required: z.literal(false) }),
            }),
          }),
          workflow_dispatch: z.unknown(),
        }),
        jobs: z.record(
          z.string(),
          z.object({
            steps: z.array(
              z.object({
                uses: z.string().optional(),
                with: z.record(z.string(), z.unknown()).optional(),
              }),
            ),
          }),
        ),
      })
      .parse(
        parse(
          await readFile(new URL(`../../../${path}`, import.meta.url), "utf8"),
        ),
      );
    expect(called.on.workflow_call.inputs.build_cache_artifact).toMatchObject({
      type: "string",
      default: "",
    });
    expect(called.on.workflow_call.inputs.remote_cache_write).toMatchObject({
      type: "boolean",
      required: false,
      default: false,
    });
    expect(Object.hasOwn(called.on, "workflow_dispatch")).toBe(true);
    for (const job of Object.values(called.jobs))
      expect(
        job.steps.find(
          (step) => step.uses === "./.github/actions/portable-build-cache",
        )?.with,
      ).toEqual({
        build_cache_artifact: "${{ inputs.build_cache_artifact }}",
      });
  }
  for (const name of [
    "sqlite-runtime",
    "nativeaot",
    "ghidra_bridge",
    "website",
  ])
    expect(jobs[name]?.secrets, name).toBeUndefined();
}

it("binds provider build reuse to the current run while keeping standalone dispatches independent", async () => {
  const { jobs } = await workflow();
  const buildSteps = z
    .array(
      z.object({
        run: z.string().optional(),
        uses: z.string().optional(),
        shell: z.string().optional(),
        if: z.string().optional(),
        with: z.record(z.string(), z.unknown()).optional(),
        "continue-on-error": z.boolean().optional(),
      }),
    )
    .parse(jobs.build?.steps);
  const prepare = buildSteps.findIndex(
    (step) => step.run === "npm run test:prepare",
  );
  const stage = buildSteps.findIndex((step) =>
    step.run?.includes("portable-build-cache.mjs snapshot"),
  );
  const upload = buildSteps.findIndex(
    (step) => step.with?.name === "rea-build-cache",
  );
  expect(prepare).toBeGreaterThanOrEqual(0);
  expect(stage).toBeGreaterThan(prepare);
  expect(upload).toBeGreaterThan(stage);
  expect(buildSteps[stage]?.run).toContain(
    "node scripts/ci/portable-build-cache.mjs snapshot < .cache/ci-build-plan.json",
  );
  expect(buildSteps[stage]?.if).toBeUndefined();
  expect(buildSteps[stage]?.shell).toBe("bash");
  expect(buildSteps[stage]?.["continue-on-error"]).not.toBe(true);
  expect(buildSteps[upload]?.if).toBeUndefined();
  expect(buildSteps[upload]?.with).toMatchObject({
    path: ".cache/ci-build-cache/",
    "if-no-files-found": "error",
  });
  const consumers = [
    "browser",
    "binary_layout",
    "evm",
    "apk_signature",
    "javascript_recovery",
    "recorded_crash",
    "web_network",
    "web_runtime",
    "web_source_map",
    "agentenv",
    "packet_capture",
    "signal_recording",
  ];
  const buildTerms = z
    .string()
    .parse(jobs.build?.if)
    .split("||")
    .map((term) => term.trim());
  // Provider workflow edits select their lane without code=true. The build
  // producer must still run, without selecting the portable test shards.
  expect(new Set(buildTerms)).toEqual(
    new Set(
      ["code", ...consumers].map(
        (scope) => `needs.changes.outputs.${scope} == 'true'`,
      ),
    ),
  );
  expect(jobs["test-shard"]?.if).toBe("needs.changes.outputs.code == 'true'");
  await assertProviderCacheCallers(jobs, consumers);
  const action = z
    .object({
      runs: z.object({
        steps: z.array(
          z.object({
            id: z.string().optional(),
            uses: z.string().optional(),
            if: z.string().optional(),
            with: z.record(z.string(), z.unknown()).optional(),
            "continue-on-error": z.boolean().optional(),
            run: z.string().optional(),
          }),
        ),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL(
            "../../../.github/actions/portable-build-cache/action.yml",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
  const download = action.runs.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  expect(download?.with).toEqual({
    name: "${{ inputs.build_cache_artifact }}",
    path: ".turbo/cache/",
  });
  expect(download?.if).toBe("inputs.build_cache_artifact != ''");
  expect(download?.["continue-on-error"]).not.toBe(true);
  expect(action.runs.steps.find((step) => step.id === "plan")?.run).toContain(
    'node scripts/ci/portable-build-cache.mjs key >> "$GITHUB_OUTPUT"',
  );
  for (const step of action.runs.steps.filter(
    (step) => step.id === "plan" || step.uses?.startsWith("actions/cache"),
  ))
    expect(step.if).toContain("inputs.build_cache_artifact == ''");
});

it("runs workflow validation inside required static checks when selected", async () => {
  const { jobs } = await workflow();
  const steps = z
    .array(z.object({ run: z.string().optional(), if: z.string().optional() }))
    .parse(jobs.static?.steps);
  const validation = steps.filter((step) => step.run?.includes("actionlint"));
  expect(validation).toHaveLength(1);
  expect(validation[0]?.if).toBe("needs.changes.outputs.workflows == 'true'");
  expect(jobs.workflows).toBeUndefined();
});

it("leaves cancellation ownership with CI so child lanes cannot cancel another tier", async () => {
  const { jobs } = await workflow();
  const children = Object.values(jobs).flatMap((job) =>
    typeof job.uses === "string" && job.uses.startsWith("./.github/workflows/")
      ? [job.uses]
      : [],
  );
  expect(children.length).toBeGreaterThan(0);
  for (const path of children) {
    const child = z
      .object({ concurrency: z.unknown().optional() })
      .parse(
        parse(
          await readFile(new URL(`../../../${path}`, import.meta.url), "utf8"),
        ),
      );
    expect(
      child.concurrency,
      `${path} must use caller scheduling`,
    ).toBeUndefined();
  }
});

it("keeps fast feedback separate from complete qualification and release proof", async () => {
  const ci = z
    .object({
      on: z.object({
        push: z.unknown(),
        pull_request: z.unknown(),
        schedule: z.array(z.object({ cron: z.string() })),
        workflow_call: z.object({
          inputs: z.object({
            source_sha: z.object({
              required: z.literal(true),
              type: z.literal("string"),
            }),
            remote_cache_write: z.object({
              required: z.literal(false),
              type: z.literal("boolean"),
              default: z.literal(false),
            }),
          }),
          secrets: z.object({
            TURBO_TOKEN: z.object({ required: z.literal(false) }),
          }),
        }),
      }),
      concurrency: z.object({
        group: z.string(),
        "cancel-in-progress": z.string(),
      }),
      jobs: z.record(
        z.string(),
        z.object({
          if: z.string().optional(),
          steps: z
            .array(
              z.object({
                run: z.string().optional(),
                if: z.string().optional(),
                with: z.record(z.string(), z.unknown()).optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci.yml", import.meta.url),
          "utf8",
        ),
      ),
    );
  expect(ci.on.schedule).toEqual([
    { cron: "23 0-2,4-23 * * *" },
    { cron: "23 3 * * *" },
  ]);
  expect(ci.concurrency.group).toContain("'qualification' || 'feedback'");
  expect(ci.concurrency.group).toContain("inputs.source_sha ||");
  expect(ci.concurrency.group).toContain("github.ref");
  expect(ci.concurrency["cancel-in-progress"]).toBe(
    "${{ github.event_name == 'pull_request' && inputs.source_sha == '' && !contains(github.event.pull_request.labels.*.name, 'ci:full') }}",
  );
  // Failed dependencies still reach the gate, but superseded PR runs must
  // release their concurrency slot without waiting for another runner.
  expect(ci.jobs.required?.if).toBe("${{ !cancelled() }}");
  const shards = ci.jobs["test-shard"]?.steps ?? [];
  const fast = shards.find((step) => step.run?.includes("npm run test:built"));
  const full = shards.find((step) => step.run?.includes("test:ci:shard:run"));
  expect(fast?.if).toBe("needs.changes.outputs.tier == 'fast'");
  expect(fast?.run).toContain("--reporter=blob");
  expect(fast?.run).not.toContain("--coverage");
  expect(full?.if).toBe("needs.changes.outputs.tier == 'full'");
  const proof = ci.jobs["package-e2e"]?.steps?.find(
    (step) => step.with?.name === "verified-release-package",
  );
  expect(proof?.if).toContain("needs.changes.outputs.tier == 'full'");
  expect(proof?.if).toContain("matrix.platform == 'linux'");
  expect(proof?.if).toContain("matrix.architecture == 'x64'");
});

it.each([
  ["true", "success", true],
  ["true", "failure", false],
  ["true", "cancelled", false],
  ["true", "skipped", false],
  ["true", "missing", false],
  ["false", "skipped", true],
  ["false", "failure", false],
] as const)(
  "enforces mapped required scopes for selected=%s and result=%s",
  async (selected, result, passes) => {
    const workflow = await requiredNeeds();
    for (const [scope, lane] of [
      ["sqlite", "sqlite-runtime"],
      ["workflows", "static"],
      ["ghidra_bridge", "ghidra_bridge"],
      ["agentenv", "agentenv"],
      ["python", "python"],
      ["packet_capture", "packet_capture"],
      ["signal_recording", "signal_recording"],
    ] as const) {
      // GitHub exposes only direct dependencies in the required job's needs context.
      const needs: Record<
        string,
        { result: string; outputs?: Record<string, string> }
      > = Object.fromEntries(
        workflow.needs.map((name) => [name, { result: "success" }]),
      );
      needs.changes = {
        result: "success",
        outputs: {
          ...Object.fromEntries(
            (await scopeFlags()).map((flag) => [flag, "false"]),
          ),
          tier: "fast",
          code: "true",
          [scope]: selected,
        },
      };
      if (result === "missing") delete needs[lane];
      else needs[lane] = { result };
      const execution = executeWorkflowFixture(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../../scripts/ci/required.mjs", import.meta.url),
          ),
        ],
        { env: { ...process.env, CI_JOBS: JSON.stringify(needs) } },
      );
      // Static checks remain required even without workflow edits.
      const expected = passes && !(lane === "static" && result !== "success");
      if (expected)
        await expect(execution).resolves.toMatchObject({ stderr: "" });
      else
        await expect(execution).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(lane),
        });
    }
  },
);

it("rejects incomplete or malformed classification even when available jobs succeeded", async () => {
  const flags = await scopeFlags();
  const valid = {
    ...Object.fromEntries(flags.map((flag) => [flag, "false"])),
    tier: "fast",
  };
  const run = (outputs: unknown) =>
    executeWorkflowFixture(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../scripts/ci/required.mjs", import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          CI_JOBS: JSON.stringify({
            changes: { result: "success", outputs },
            static: { result: "success" },
            test: { result: "success" },
          }),
          CI_QUALIFICATION_DIRECTORY: "",
        },
      },
    );
  await expect(run(valid)).resolves.toMatchObject({ stderr: "" });
  // Metadata is not a scope, even when its string happens to be "true".
  await expect(
    run({ ...valid, qualification_run_id: "true" }),
  ).resolves.toMatchObject({ stderr: "" });
  for (const outputs of [
    undefined,
    null,
    {},
    { ...valid, tier: undefined },
    { ...valid, tier: "" },
    { ...valid, tier: "unknown" },
  ]) {
    await expect(run(outputs)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("valid tier"),
    });
  }
  for (const flag of flags) {
    await expect(run({ ...valid, [flag]: undefined })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`scope outputs: ${flag}`),
    });
  }
  for (const value of ["", "TRUE", "yes", true, false, 0, null, [], {}]) {
    await expect(run({ ...valid, sqlite: value })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("scope outputs: sqlite"),
    });
  }
  for (const tier of ["full", "reused"]) {
    await expect(
      run({ ...valid, tier, sqlite: undefined }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("scope outputs: sqlite"),
    });
  }
});

it("fails fast only for ordinary PR matrices and rejects partial portable feedback", async () => {
  const { jobs } = await workflow();
  expect(jobs["test-shard"]?.strategy).toMatchObject({
    "fail-fast":
      "${{ github.event_name == 'pull_request' && needs.changes.outputs.tier == 'fast' }}",
  });
  expect(jobs["package-e2e"]?.strategy).toMatchObject({ "fail-fast": false });
  const flags = await scopeFlags();
  for (const result of ["failure", "cancelled", "skipped", "missing"]) {
    // Even an incorrectly successful report merge cannot hide matrix failure.
    const needs: Record<string, unknown> = {
      changes: {
        result: "success",
        outputs: {
          ...Object.fromEntries(flags.map((flag) => [flag, "false"])),
          tier: "fast",
          code: "true",
        },
      },
      static: { result: "success" },
      build: { result: "success" },
      test: { result: "success" },
      ...(result === "missing" ? {} : { "test-shard": { result } }),
    };
    await expect(
      executeWorkflowFixture(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../../scripts/ci/required.mjs", import.meta.url),
          ),
        ],
        { env: { ...process.env, CI_JOBS: JSON.stringify(needs) } },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("test-shard"),
    });
  }
});

it("binds each canonical lane to its explicit fast and full workflow jobs", async () => {
  const { jobs, needs } = await requiredNeeds();
  const { CI_LANES } = await import(
    new URL("../../../scripts/ci/scopes.mjs", import.meta.url).href
  );
  // Independent contract: adding or changing a lane requires a workflow and
  // gate decision, rather than silently assuming that its job has the same name.
  const expected: Record<string, { fast: string[]; full: string[] }> = {
    code: {
      fast: ["build", "test-shard", "test-source"],
      full: ["build", "test-shard"],
    },
    runtime: {
      fast: ["windows-native-build", "package-e2e"],
      full: ["windows-native-build", "package-e2e"],
    },
    package: { fast: ["windows-curated"], full: ["windows-curated"] },
    apple: { fast: ["apple-artifacts"], full: ["apple-artifacts"] },
    fixtures: {
      fast: ["conformance-fixtures"],
      full: ["conformance-fixtures"],
    },
    readiness: {
      fast: ["reconstruction-readiness"],
      full: ["reconstruction-readiness"],
    },
    docs: { fast: ["docs"], full: ["docs"] },
    workflows: { fast: ["static"], full: ["static"] },
    python: { fast: ["python"], full: ["static-deep"] },
    reverse_tools: {
      fast: ["reverse-tools-quality"],
      full: ["reverse-tools-quality"],
    },
    sqlite: { fast: ["sqlite-runtime"], full: ["sqlite-runtime"] },
    ...Object.fromEntries(
      [
        "packet_capture",
        "signal_recording",
        "browser",
        "binary_layout",
        "evm",
        "apk_signature",
        "javascript_recovery",
        "recorded_crash",
        "web_network",
        "web_runtime",
        "web_source_map",
        "agentenv",
        "nativeaot",
        "ghidra_bridge",
        "website",
      ].map((name) => [name, { fast: [name], full: [name] }]),
    ),
  };
  expect(Object.keys(CI_LANES).sort()).toEqual(Object.keys(expected).sort());
  for (const [scope, required] of Object.entries(expected)) {
    expect(CI_LANES[scope].required, scope).toEqual(required);
    for (const name of new Set([...required.fast, ...required.full])) {
      expect(needs, `${scope}: ${name}`).toContain(name);
      expect(jobs[name], `${scope}: ${name}`).toBeDefined();
      // Static and deep-static are shared gates; other mapped jobs are admitted
      // by their scope output in the workflow itself.
      if (name !== "static" && name !== "static-deep")
        expect(String(jobs[name]?.if), `${scope}: ${name}`).toContain(
          `needs.changes.outputs.${scope}`,
        );
    }
  }

  const executeGate = (context: Record<string, unknown>) =>
    executeWorkflowFixture(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../scripts/ci/required.mjs", import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          CI_JOBS: JSON.stringify(context),
          CI_QUALIFICATION_DIRECTORY: "",
        },
      },
    );
  const flags = Object.keys(expected);
  for (const [scope, required] of Object.entries(expected)) {
    const context: Record<string, unknown> = Object.fromEntries(
      needs.map((name) => [name, { result: "skipped" }]),
    );
    context.changes = {
      result: "success",
      outputs: {
        ...Object.fromEntries(flags.map((name) => [name, "false"])),
        tier: "fast",
        [scope]: "true",
      },
    };
    context.static = { result: "success" };
    context.test = { result: "success" };
    for (const name of required.fast) context[name] = { result: "success" };
    await expect(executeGate(context), scope).resolves.toMatchObject({
      stderr: "",
    });
    for (const name of required.fast) {
      await expect(
        executeGate({ ...context, [name]: { result: "skipped" } }),
        `${scope}: ${name}`,
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(name),
      });
    }
  }
  const fullContext: Record<string, unknown> = Object.fromEntries(
    needs.map((name) => [name, { result: "success" }]),
  );
  fullContext.changes = {
    result: "success",
    outputs: {
      ...Object.fromEntries(flags.map((name) => [name, "true"])),
      tier: "full",
    },
  };
  await expect(executeGate(fullContext)).resolves.toMatchObject({ stderr: "" });
  for (const name of new Set(
    Object.values(expected).flatMap(({ full }) => full),
  )) {
    await expect(
      executeGate({ ...fullContext, [name]: { result: "skipped" } }),
      name,
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(name) });
  }
});
