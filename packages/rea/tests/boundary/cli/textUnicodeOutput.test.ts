import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { createCliResultOutput } from "../../../src/cli/cliResultOutput.js";
import { parseCliOutputArguments } from "../../../src/cliOutput.js";
import { logCliCommand } from "../../../src/cliLogging.js";
import { silentLogger } from "../../../src/logger.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import {
  formatCliOutput,
  prepareDelimitedOutput,
} from "../../../src/cli/cliOutputFormatter.js";

it("refuses TOON values or keys that UTF-8 cannot preserve", async () => {
  for (const value of [{ name: "a\ud800b" }, { ["a\udc00b"]: "value" }]) {
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(["--format", "toon"]),
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      }),
    );
    if (output === undefined) throw new Error("invalid output settings");
    expect(
      await output.write(value, {
        command: "fixture",
        duration: "1ms",
        format: "toon",
      }),
    ).toBe(true);
    expect(output.error).toMatchObject({ code: "invalid_request" });
    expect(decode(Buffer.concat(chunks).toString("utf8"))).toMatchObject({
      code: "invalid_request",
      remediation: { action: expect.stringContaining("--format json") },
    });
  }
});

it.each([false, true])(
  "retains a classified operation failure when TOON cannot encode its diagnostic (token window: %s)",
  async (tokenWindow) => {
    const previousExitCode = process.exitCode;
    try {
      const value = await logCliCommand(silentLogger, "fixture", async () => {
        throw new AnalysisInputError("fixture", { userMessage: "bad \ud800" });
      });
      const output = createCliResultOutput(
        parseCliOutputArguments([
          "--format",
          "toon",
          "--full-output",
          ...(tokenWindow ? ["--token-limit", "1000"] : []),
        ]),
        new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
      );
      if (output === undefined) throw new Error("invalid output settings");
      expect(
        await output.write(value, {
          command: "fixture",
          duration: "1ms",
          format: "toon",
        }),
      ).toBe(true);
      expect(output.error).toMatchObject({
        code: "invalid_request",
        details: {
          diagnostics: {
            original_failure: {
              code: "invalid_request",
              category: "invalid_input",
              retryable: false,
            },
          },
        },
      });
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);

it("keeps valid supplementary characters and an authored replacement character", async () => {
  const output = createCliResultOutput(
    parseCliOutputArguments(["--format", "toon"]),
    new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  );
  if (output === undefined) throw new Error("invalid output settings");
  expect(
    await output.write(
      { value: "😀�" },
      { command: "fixture", duration: "1ms", format: "toon" },
    ),
  ).toBe(false);
});

it("only refuses malformed code units in selected TOON output", async () => {
  const chunks: Buffer[] = [];
  const output = createCliResultOutput(
    parseCliOutputArguments(["--format", "toon", "--filter-output", "safe"]),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    }),
  );
  if (output === undefined) throw new Error("invalid output settings");
  expect(
    await output.write(
      { safe: "retained", other: "\ud800" },
      { command: "fixture", duration: "1ms", format: "toon" },
    ),
  ).toBe(true);
  expect(output.error).toBeUndefined();
  expect(decode(Buffer.concat(chunks).toString("utf8"))).toBe("retained");
});

it("refuses malformed code units retained in a TOON token window", async () => {
  const chunks: Buffer[] = [];
  const output = createCliResultOutput(
    parseCliOutputArguments(["--format", "toon", "--token-limit", "1000"]),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    }),
  );
  if (output === undefined) throw new Error("invalid output settings");
  expect(
    await output.write(
      { value: "\ud800" },
      { command: "fixture", duration: "1ms", format: "toon" },
    ),
  ).toBe(true);
  expect(output.error).toMatchObject({ code: "invalid_request" });
});

it("shows NUL visibly in Markdown", () => {
  const markdown = formatCliOutput({ rows: [{ value: "a\u0000b�😀" }] }, "md");
  expect(markdown).toContain("a\\\\u0000b�😀");
  expect(markdown).not.toContain("\u0000");
});

it.each(["\ud800", "\u0000"])(
  "refuses unrepresentable Markdown code units without substituting them",
  async (value) => {
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(["--format", "md"]),
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      }),
    );
    if (output === undefined) throw new Error("invalid output settings");
    expect(
      await output.write(
        { value },
        { command: "fixture", duration: "1ms", format: "md" },
      ),
    ).toBe(true);
    expect(output.error).toMatchObject({ code: "invalid_request" });
    expect(Buffer.concat(chunks).toString("utf8")).not.toContain("�");
  },
);

it("refuses unrepresentable delimited cells and column names before output", () => {
  for (const [rows, fields] of [
    [[{ x: "\ud800" }], ["x"]],
    [[{ ["\udc00"]: "x" }], ["\udc00"]],
  ] as const) {
    const result = prepareDelimitedOutput(rows, "csv", {
      fields,
      metadata: {},
    });
    expect(result.ok).toBe(false);
  }
});
