import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { createStrippedAsarAddon } from "../../fixtures/strippedAsarAddon.js";

const execute = promisify(execFile);
const run = async (arguments_: readonly string[]): Promise<unknown> => {
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", ...arguments_, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};

const runFailure = async (arguments_: readonly string[]): Promise<unknown> => {
  try {
    await run(arguments_);
  } catch (cause: unknown) {
    if (typeof cause !== "object" || cause === null || !("stdout" in cause))
      throw cause;
    const stdout = cause.stdout;
    if (typeof stdout !== "string") throw cause;
    return JSON.parse(stdout);
  }
  throw new Error("Expected the CLI command to fail");
};

it.each(["analyze-javascript-application", "analyze"])(
  "%s carries the integrity policy into shared JavaScript analysis",
  async (command) => {
    const { archive, addon } = await createStrippedAsarAddon();
    const result = await run([
      command,
      archive,
      "--integrity-policy",
      "record-and-continue",
    ]);
    expect(result).toMatchObject({
      operation: "analyze_javascript_application",
      parameters: { integrity_policy: "record-and-continue" },
      normalized_result: {
        integrity_contradictions: [
          { logical_path: addon, trust: "observed-untrusted" },
        ],
        graph: { coverage: { status: "partial" } },
      },
    });
  },
);

it("rejects the JavaScript integrity policy on binary-only inspection", async () => {
  await expect(
    run(["inspect", "unused.asar", "--integrityPolicy", "record-and-continue"]),
  ).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining("Unknown flag: --integrityPolicy"),
  });
});

it.each(["fail", "record-and-continue"] as const)(
  "rejects the explicitly selected %s integrity policy on a binary analyze target",
  async (policy) => {
    const failure = await runFailure([
      "analyze",
      "unused.bin",
      "--integrity-policy",
      policy,
    ]);
    expect(failure).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["integrity_policy"],
            reason: "invalid_value",
            message:
              "An integrity policy requires the static JavaScript ASAR/directory analysis lane; binary_overview accepts no input.",
          },
        ],
      },
    });
  },
);

it("still routes a binary analyze target without an integrity policy", async () => {
  await expect(run(["analyze", "unused.bin"])).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining("target does not exist"),
  });
});

it("advertises the optional integrity policy without an undefined union", async () => {
  const schema = (await run(["analyze", "--schema"])) as {
    options?: { properties?: { integrityPolicy?: unknown } };
  };
  const policy = schema.options?.properties?.integrityPolicy;
  expect(policy).toMatchObject({
    type: "string",
    enum: ["fail", "record-and-continue"],
    description: "Behavior when declared application integrity does not match",
  });
  expect(JSON.stringify(policy)).not.toContain("undefined");
});
