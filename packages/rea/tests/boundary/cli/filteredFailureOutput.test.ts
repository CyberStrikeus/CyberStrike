import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { Cli, z } from "incur";
import { parse as parseYaml } from "yaml";
import { expect, it } from "vitest";

import { parseCliOutputArguments } from "../../../src/cliOutput.js";
import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";
import { parseCliJsonInput } from "../../../src/cliJsonInput.js";
import { logCliCommand } from "../../../src/cliLogging.js";
import { silentLogger } from "../../../src/logger.js";

const runCli = async (arguments_: readonly string[]) => {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const output = createCliResultOutput(
    parseCliOutputArguments(arguments_),
    destination,
  );
  if (output === undefined) throw new Error("Missing CLI result output owner");
  const cli = Cli.create("filtered-failure-test", { sync: false });
  cli.command("trace-application-feature", {
    args: z.object({ path: z.string() }),
    run: ({ args }) =>
      logCliCommand(silentLogger, "trace-application-feature", async () => {
        const input = await parseCliJsonInput(
          args.path,
          "trace-application-feature",
        );
        return input.ok ? input.value : input.error;
      }),
  });
  streamCliCommandResults(cli, output);
  let fallback = "";
  await cli.serve([...arguments_], {
    stdout: (text) => {
      if (!output.handled) fallback += text;
    },
  });
  return {
    text: Buffer.concat(chunks).toString("utf8"),
    fallback,
    output,
  };
};

const expectMissingInputFailureText = (text: string, path: string): void => {
  const normalizedText = text.replace(/\s+/g, " ");
  for (const value of [
    "invalid_request",
    "invalid_input",
    "Read the declared input schema or CLI usage",
    "trace-application-feature",
    "tools/list",
    "Correct the listed fields, then retry.",
    "Do not repeat the unchanged call.",
    "inspect_input_contract",
    path,
    "read-failed",
    "ENOENT",
  ])
    expect(normalizedText).toContain(value);
};

it.each(["json", "toon", "yaml", "md"] as const)(
  "preserves the typed missing-file failure across filtered %s results",
  async (format) => {
    const formatArgs = format === "json" ? ["--json"] : ["--format", format];
    const missingPath = `./missing-evidence-${randomUUID()}.json`;
    for (const filter of ["missing", "code", "message"]) {
      const previousExitCode = process.exitCode;
      process.exitCode = 0;
      try {
        const result = await runCli([
          "trace-application-feature",
          missingPath,
          ...formatArgs,
          "--filter-output",
          filter,
        ]);
        expect(process.exitCode).toBe(1);
        expect(result.output.failed).toBe(false);
        expect(result.fallback).toBe("");
        expect(result.output.handled).toBe(true);
        expectMissingInputFailureText(result.text, missingPath);
        if (format === "json" || format === "yaml") {
          const document =
            format === "json"
              ? JSON.parse(result.text)
              : parseYaml(result.text);
          expect(document).toMatchObject({
            code: "invalid_request",
            category: "invalid_input",
            retryable: false,
            remediation: {
              action: expect.stringContaining("tools/list"),
            },
            recovery: {
              kind: "inspect_input_contract",
              operation: "trace-application-feature",
            },
            details: {
              input_path: missingPath,
              input_reason: "read-failed",
              issues: [
                expect.objectContaining({
                  message: expect.stringContaining("ENOENT"),
                }),
              ],
            },
          });
        }
      } finally {
        process.exitCode = previousExitCode;
      }
    }

    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      const result = await runCli([
        "trace-application-feature",
        missingPath,
        ...formatArgs,
        "--filter-output",
        "missing",
        "--full-output",
      ]);
      expect(process.exitCode).toBe(1);
      expect(result.fallback).toBe("");
      if (format === "json" || format === "yaml") {
        const document =
          format === "json" ? JSON.parse(result.text) : parseYaml(result.text);
        expect(document).toMatchObject({
          ok: false,
          error: {
            code: "invalid_request",
            category: "invalid_input",
            retryable: false,
            remediation: {
              action: expect.stringContaining("tools/list"),
            },
            recovery: {
              kind: "inspect_input_contract",
              operation: "trace-application-feature",
            },
            details: {
              input_path: missingPath,
              input_reason: "read-failed",
            },
          },
          meta: { command: "trace-application-feature" },
        });
      } else {
        if (format === "md") {
          expect(result.text).toContain("## ok\n\nfalse");
          expect(result.text).toContain("## error.code");
        } else expect(result.text).toContain("ok: false");
        expectMissingInputFailureText(result.text, missingPath);
      }
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);

it("keeps successful scalar filtering available", async () => {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const argv = ["open-control", "--json", "--filter-output", "open"];
  const output = createCliResultOutput(
    parseCliOutputArguments(argv),
    destination,
  );
  if (output === undefined) throw new Error("Missing CLI result output owner");
  const cli = Cli.create("filtered-failure-test", { sync: false });
  cli.command("open-control", { run: () => ({ open: false }) });
  streamCliCommandResults(cli, output);
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await cli.serve(argv);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("false\n");
    expect(process.exitCode).toBe(0);
  } finally {
    process.exitCode = previousExitCode;
  }
});
