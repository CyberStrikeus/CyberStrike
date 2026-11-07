import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import {
  BUILT_TEST_PROJECTS,
  SOURCE_TEST_PROJECTS,
  projectForTest,
} from "../../../scripts/lib/test-projects.mjs";
import {
  developmentTestPlan,
  parseDevelopmentTestRequest,
} from "../../../scripts/lib/development-tests.mjs";

import {
  execFileOutput,
  execFileOutputFailure,
} from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeRepositoryOxlintConfiguration } from "../../fixtures/oxlintConfiguration.js";

const repository = process.cwd();
const oxlint = join(repository, "node_modules/oxlint/bin/oxlint");
const oxlintConfig = join(repository, ".oxlintrc.json");

const runOxlint = async (
  cwd: string,
  config: string,
  files: readonly string[],
) => {
  let stdout: string;
  let exitCode: string | number = 0;
  try {
    ({ stdout } = await execFileOutput(
      process.execPath,
      [oxlint, "--threads=1", "--config", config, "--format", "json", ...files],
      {
        cwd,
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        stopSignal: "SIGTERM",
      },
    ));
  } catch (cause) {
    const failure = execFileOutputFailure(cause);
    if (
      failure === undefined ||
      failure.code !== 1 ||
      failure.signal !== null ||
      failure.killed ||
      failure.outputTruncated
    )
      throw cause;
    stdout = failure.stdout;
    exitCode = failure.code;
  }
  return {
    exitCode,
    report: JSON.parse(stdout) as {
      diagnostics?: Array<{ code?: string; severity: string }>;
    },
  };
};

describe("canonical test-project ownership", () => {
  it("assigns every tracked test file exactly once to source or built", () => {
    const files = execFileSync("git", ["ls-files", "*.test.ts"], {
      cwd: repository,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const grouped = new Map<string, string[]>();
    for (const file of files) {
      const project = projectForTest(file);
      grouped.set(project.group, [...(grouped.get(project.group) ?? []), file]);
    }

    expect(grouped.get("source")).not.toBeUndefined();
    expect(grouped.get("built")).not.toBeUndefined();
    expect(
      (grouped.get("source")?.length ?? 0) +
        (grouped.get("built")?.length ?? 0),
    ).toBe(files.length);
    expect(
      SOURCE_TEST_PROJECTS.reduce(
        (count, project) => count + project.include.length,
        0,
      ),
    ).toBeGreaterThan(0);
    expect(
      BUILT_TEST_PROJECTS.every((project) => project.group === "built"),
    ).toBe(true);
    expect(() => projectForTest("tests/unowned/example.test.ts")).toThrow(
      "No test project owns",
    );
  });

  it("owns the Hopper real-provider conformance test as built and requires preparation", () => {
    const testPath =
      "tests/conformance/providers/hopper/realHopperSearch.test.ts";
    expect(projectForTest(testPath)).toMatchObject({
      name: "boundary",
      group: "built",
    });
    expect(() => parseDevelopmentTestRequest("local", [testPath])).toThrow(
      `Use test:focused for built test projects: ${testPath}`,
    );
    const request = parseDevelopmentTestRequest("focused", [testPath]);
    expect(developmentTestPlan(request)).toMatchObject({ needsBuild: true });
  });
});

describe("Vitest project configuration", () => {
  it("uses canonical test-project selectors in Vitest", async () => {
    const root = await createTestTempDirectory("rea-vitest-project-selectors-");
    const script = join(root, "project-selectors.mjs");
    await writeFile(
      script,
      `
      const { default: config } = await import(process.argv[2]);
      console.log(JSON.stringify(config.test.projects.map(({ test }) => ({
        name: test.name,
        include: test.include,
        exclude: test.exclude ?? [],
      }))));
    `,
    );
    const result = await execFileOutput(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        pathToFileURL(join(repository, "vitest.config.ts")).href,
      ],
      {
        cwd: repository,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        stopSignal: "SIGTERM",
      },
    );
    const selectors = JSON.parse(result.stdout) as Array<{
      name: string;
      include: string[];
      exclude: string[];
    }>;
    const canonical = [...SOURCE_TEST_PROJECTS, ...BUILT_TEST_PROJECTS].map(
      ({ name, include, exclude }) => ({
        name,
        include,
        exclude: exclude ?? [],
      }),
    );
    expect(selectors.sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      canonical.sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it.each([
    { flags: [], timeout: 30_000, lines: 68 },
    { flags: ["--coverage"], timeout: 60_000, lines: 68 },
    { flags: ["--coverage.enabled"], timeout: 60_000, lines: 68 },
    { flags: ["--coverage=false"], timeout: 30_000, lines: 68 },
    {
      flags: ["--coverage.enabled=false"],
      timeout: 30_000,
      lines: 68,
    },
    {
      flags: ["--coverage.provider=v8"],
      timeout: 30_000,
      lines: 68,
    },
    {
      flags: ["--coverage.enabled", "--shard", "1/6"],
      timeout: 60_000,
      lines: 0,
    },
    {
      flags: ["--coverage.enabled=false", "--shard=1/6"],
      timeout: 30_000,
      lines: 0,
    },
  ])(
    "resolves worker resources from actual CLI options: $flags",
    async ({ flags, timeout, lines }) => {
      const root = await createTestTempDirectory("rea-vitest-worker-policy-");
      const script = join(root, "worker-policy.mjs");
      await writeFile(
        script,
        `
      import config from ${JSON.stringify(pathToFileURL(join(repository, "vitest.config.ts")).href)};
      const project = config.test.projects.find(project => project.test.name === 'cli-boundary');
      console.log(JSON.stringify({
        execArgv: project.test.execArgv,
        timeout: config.test.testTimeout,
        lines: config.test.coverage.thresholds.lines,
      }));
    `,
      );
      const result = await execFileOutput(
        process.execPath,
        ["--import", "tsx", script, ...flags],
        {
          cwd: repository,
          timeout: 10_000,
          maxBuffer: 64 * 1024,
          stopSignal: "SIGTERM",
        },
      );
      expect(JSON.parse(result.stdout)).toEqual({
        execArgv: ["--max-old-space-size=512"],
        timeout,
        lines,
      });
    },
  );
});

describe("test module isolation", () => {
  it.each([
    [
      "tests/process-global/evidenceBundleHeadroom.test.ts",
      "process-global",
      "built",
    ],
    [
      "tests/process-global/javascriptAnalysisCancellation.test.ts",
      "process-global",
      "built",
    ],
  ])("keeps %s in its isolated preparation group", (path, name, group) => {
    expect(projectForTest(path)).toMatchObject({ name, group });
  });

  it("uses one isolation policy for Vitest and binding-aware mock lint", async () => {
    const files = execFileSync("git", ["ls-files", "*.test.ts"], {
      cwd: repository,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const root = await createTestTempDirectory("rea-vitest-project-policy-");
    const script = join(root, "project-isolation.mjs");
    await writeFile(
      script,
      `
      import config from ${JSON.stringify(pathToFileURL(join(repository, "vitest.config.ts")).href)};
      console.log(JSON.stringify(Object.fromEntries(
        config.test.projects.map(project => [project.test.name, project.test.isolate]),
      )));
    `,
    );
    const result = await execFileOutput(
      process.execPath,
      ["--import", "tsx", script],
      {
        cwd: repository,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        stopSignal: "SIGTERM",
      },
    );
    const isolated = JSON.parse(result.stdout) as Record<string, boolean>;
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.filter((file) => {
        const project = projectForTest(file);
        return isolated[project.name] !== (project.isolate !== false);
      }),
    ).toEqual([]);

    const { report } = await runOxlint(repository, oxlintConfig, files);
    expect(
      report.diagnostics?.filter(
        ({ code, severity }) =>
          code === "rea(no-shared-module-mock)" && severity === "error",
      ),
    ).toEqual([]);
  });

  it("rejects actual Vitest module-mock aliases only in shared projects", async () => {
    const root = await createTestTempDirectory("rea-vitest-mock-probe-");
    const sharedDirectory = join(root, "tests/evaluation");
    const isolatedDirectory = join(root, "tests/process-global");
    await mkdir(sharedDirectory, { recursive: true });
    await mkdir(isolatedDirectory, { recursive: true });
    const config = await writeRepositoryOxlintConfiguration(root);
    const probe = async (directory: string, source: string) => {
      const path = join(directory, "mock-probe.test.ts");
      await writeFile(path, source);
      return runOxlint(root, config, [path]);
    };
    const shared = await probe(
      sharedDirectory,
      'import { vi as testing } from "vitest"; testing.mock("./dependency.js");',
    );
    const isolated = await probe(
      isolatedDirectory,
      'import * as testing from "vitest"; testing.vi.doMock("./dependency.js");',
    );
    expect(shared.exitCode).toBe(1);
    expect(
      shared.report.diagnostics?.filter(
        ({ code, severity }) =>
          code === "rea(no-shared-module-mock)" && severity === "error",
      ),
    ).toHaveLength(1);
    expect(isolated.exitCode).toBe(0);
    expect(
      isolated.report.diagnostics?.filter(
        ({ code }) => code === "rea(no-shared-module-mock)",
      ),
    ).toEqual([]);
  });
});
