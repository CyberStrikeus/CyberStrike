import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "yaml";
import { z } from "zod";

const WORKFLOW = join(".github", "workflows", "ci.yml");

const workflowSchema = z.object({
  jobs: z.record(
    z.string(),
    z.object({
      steps: z
        .array(
          z.object({
            run: z.string().optional(),
            with: z.object({ name: z.string().optional() }).optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const explicitPaths = async (
  lane: "windows" | "focused",
): Promise<string[]> => {
  const workflow = workflowSchema.parse(
    parse(await readFile(WORKFLOW, "utf8")),
  );
  const runs =
    lane === "windows"
      ? (workflow.jobs["windows-curated"]?.steps
          ?.map((step) => step.run)
          .filter((value) => value?.includes("npx vitest run")) ?? [])
      : Object.values(workflow.jobs)
          .flatMap((job) => job.steps ?? [])
          .map((step) => step.run)
          .filter((value) =>
            value?.trim().startsWith("npm run test:focused -- "),
          );
  expect(
    runs.length,
    `expected explicit ${lane} CI test invocations`,
  ).toBeGreaterThan(0);
  return [
    ...new Set(
      runs.flatMap(
        (run) =>
          run?.split(/\s+/).filter((token) => token.endsWith(".test.ts")) ?? [],
      ),
    ),
  ].sort();
};

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

describe("curated Windows test lane", () => {
  it("references only test files that exist", async () => {
    const paths = await explicitPaths("windows");
    expect(paths.length).toBeGreaterThan(0);
    const missing = await Promise.all(
      paths.map(async (path) => ((await exists(path)) ? undefined : path)),
    );
    expect(missing.filter((path) => path !== undefined)).toEqual([]);
  }, 10_000);

  it("keeps the native multi-megabyte output regression in the lane", async () => {
    expect(await explicitPaths("windows")).toContain(
      "tests/boundary/process/windowsOutputCapture.test.ts",
    );
  });

  it("keeps the adjacent npm fallback regression in the lane", async () => {
    expect(await explicitPaths("windows")).toContain(
      "tests/boundary/process/packageNpmInvocation.test.ts",
    );
  });

  it("keeps real Git dependency-patch admission in the Windows lane", async () => {
    expect(await explicitPaths("windows")).toContain(
      "tests/boundary/filesystem/releaseProposal.test.ts",
    );
  });

  it("keeps Windows environment identity and layered setup regressions in the lane", async () => {
    expect(await explicitPaths("windows")).toEqual(
      expect.arrayContaining([
        "tests/boundary/filesystem/clientConfigurationEnvironment.test.ts",
        "tests/boundary/filesystem/clientConfigurationLayeredEnvironment.test.ts",
        "tests/acceptance/setup/registrationRuntimeEnvironmentCli.test.ts",
      ]),
    );
  });

  it("keeps packed bridge verification under the retained native runtime lease in the lane", async () => {
    expect(await explicitPaths("windows")).toContain(
      "tests/boundary/process/packedBridgeVerification.test.ts",
    );
  });

  it("keeps Windows-only path and snapshot admission cases in the lane", async () => {
    // These files have cases that run only on Windows, so outside this lane
    // CI never executes them.
    expect(await explicitPaths("windows")).toEqual(
      expect.arrayContaining([
        "src/contracts/sessionPathInputs.test.ts",
        "tests/boundary/filesystem/directAnalysisSnapshotReplay.test.ts",
        "tests/boundary/mcp/rawBinaryMcp.test.ts",
      ]),
    );
  });

  it("keeps Windows runner cancellation coverage in the lane", async () => {
    expect(await explicitPaths("windows")).toEqual(
      expect.arrayContaining([
        "tests/process-global/runnerCancellation.test.ts",
        "tests/process-global/windowsOwnedCommand.test.ts",
      ]),
    );
  });

  it("installs and verifies native command ownership before the source build", async () => {
    const workflow = workflowSchema.parse(
      parse(await readFile(WORKFLOW, "utf8")),
    );
    const steps = workflow.jobs["windows-curated"]?.steps ?? [];
    const download = steps.findIndex(
      (step) => step.with?.name === "windows-native-controls",
    );
    const verify = steps.findIndex(
      (step) => step.run === "npm run verify:windows-native:artifact",
    );
    const build = steps.findIndex(
      (step) => step.run === "npm run build:cached",
    );
    expect(download).toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(download);
    expect(build).toBeGreaterThan(verify);
  });

  it("executes native behavior and recovery proofs before unrelated curated tests", async () => {
    const workflow = workflowSchema.parse(
      parse(await readFile(WORKFLOW, "utf8")),
    );
    const steps = workflow.jobs["windows-curated"]?.steps ?? [];
    const build = steps.findIndex(
      (step) => step.run === "npm run build:cached",
    );
    const boundary = steps.findIndex(
      (step) => step.with?.name === "windows-process-boundary-fixture",
    );
    const native = steps.findIndex((step) =>
      step.run?.startsWith("npm run verify:windows-native -- "),
    );
    const inspectionFixture = steps.findIndex(
      (step) => step.with?.name === "windows-native-inspection-fixture",
    );
    const inspection = steps.findIndex(
      (step) =>
        step.run === "node scripts/verify-windows-native-inspection.mjs",
    );
    const curated = steps.findIndex(
      (step) =>
        step.run?.includes("src/windows/WindowsNativeLoader.test.ts") &&
        step.run.includes("npx vitest run"),
    );
    expect(build).toBeGreaterThanOrEqual(0);
    expect(boundary).toBeGreaterThan(build);
    expect(native).toBeGreaterThan(boundary);
    expect(steps[native]?.run).toContain("process-boundary.exe");
    expect(inspectionFixture).toBeGreaterThan(native);
    expect(inspection).toBeGreaterThan(inspectionFixture);
    expect(curated).toBeGreaterThan(inspection);
  });
});

it("keeps every explicit focused CI test path executable after file moves", async () => {
  const paths = await explicitPaths("focused");
  expect(paths.length).toBeGreaterThan(0);
  const missing = await Promise.all(
    paths.map(async (path) => ((await exists(path)) ? undefined : path)),
  );
  expect(missing.filter((path) => path !== undefined)).toEqual([]);
}, 10_000);

it("checks the complete source with the fallback compiler before Windows build reuse", async () => {
  const workflow = workflowSchema.parse(
    parse(await readFile(WORKFLOW, "utf8")),
  );
  const steps = workflow.jobs["windows-curated"]?.steps ?? [];
  const checked = steps.findIndex(
    (step) => step.run === "npm run typecheck -- --checkers 2",
  );
  const built = steps.findIndex((step) => step.run === "npm run build:cached");
  expect(checked).toBeGreaterThan(-1);
  expect(built).toBeGreaterThan(checked);
});
