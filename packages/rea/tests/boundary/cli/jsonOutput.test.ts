import { constants } from "node:buffer";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";

import { Cli } from "incur";
import { estimateTokenCount } from "tokenx";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { writeJsonOutput } from "../../../src/cli/jsonOutput.js";
import { parseCliOutputArguments } from "../../../src/cliOutput.js";
import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";
import { logCliCommand } from "../../../src/cliLogging.js";
import { registerManagedCommands } from "../../../src/cli/managedCommands.js";
import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { silentLogger } from "../../../src/logger.js";

const collect = async (
  value: unknown,
  format: "json" | "jsonl" = "json",
  terminal = true,
): Promise<string> => {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: unknown, _encoding, callback) {
      if (!Buffer.isBuffer(chunk)) {
        callback(new TypeError("Expected a UTF-8 output buffer"));
        return;
      }
      chunks.push(chunk);
      callback();
    },
  });
  if (terminal) Object.defineProperty(destination, "isTTY", { value: true });
  await writeJsonOutput(value, destination, format);
  return Buffer.concat(chunks).toString("utf8");
};

describe("SDK output completion", () => {
  it.each(["json", "toon"])(
    "waits for pending raw %s writes before exit",
    async (format) => {
      const document = JSON.stringify({
        code: "VALIDATION_ERROR",
        message: "x".repeat(8192),
      });
      let complete = false;
      const destination = new Writable({
        highWaterMark: 1,
        write(chunk, _encoding, callback) {
          if (chunk.length === 0) {
            callback();
            return;
          }
          setImmediate(() => {
            complete = true;
            callback();
          });
        },
      });
      const output = createCliResultOutput(
        parseCliOutputArguments(["--format", format]),
        destination,
      );
      if (output === undefined)
        throw new Error("Expected valid output controls");
      expect(output.captureSdkOutput(document)).toBe(false);
      destination.write(document);
      expect(complete).toBe(false);
      await output.finishSdkOutput(1);
      expect(complete).toBe(true);
      expect(destination.writableEnded).toBe(false);
    },
  );
});

describe("incremental CLI JSON", () => {
  it.each([
    null,
    true,
    -0,
    1e-7,
    "",
    { empty: [], object: {}, nested: [{ value: null }] },
    { 'quoted"key': '\u0000\b\t\n\f\r\\"', unicode: "雪𝟠\ud800\udfff" },
    { text: `${"x".repeat(8191)}𝟠${"y".repeat(8191)}\ud800` },
  ])("matches native JSON encoding for %j", async (value) => {
    expect(await collect(value)).toBe(`${JSON.stringify(value, null, 2)}\n`);
  });

  it("preserves shared objects without interpreting them as cycles", async () => {
    const shared = { value: "shared" };
    const value = { copies: [shared, shared] };
    expect(await collect(value)).toBe(`${JSON.stringify(value, null, 2)}\n`);
  });

  it("indents JSON only for a terminal and writes piped JSON compactly", async () => {
    const value = { nested: [{ value: null }], text: "雪𝟠" };
    expect(await collect(value, "json", true)).toBe(
      `${JSON.stringify(value, null, 2)}\n`,
    );
    expect(await collect(value, "json", false)).toBe(
      `${JSON.stringify(value)}\n`,
    );
  });

  it("writes compact JSONL records and preserves an empty record set", async () => {
    const value = [{ text: "first\nrecord" }, { text: "雪𝟠" }];
    expect(await collect(value, "jsonl")).toBe(
      `${value.map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    expect(await collect([], "jsonl")).toBe("");
  });

  it("bounds escaped leaf writes and waits for a slow destination", async () => {
    const leaf = `\u0000雪𝟠`.repeat(32 * 1024);
    const chunks: Buffer[] = [];
    let largestChunk = 0;
    const destination = new Writable({
      highWaterMark: 1,
      write(chunk: unknown, _encoding, callback) {
        if (!Buffer.isBuffer(chunk)) {
          callback(new TypeError("Expected UTF-8 bytes"));
          return;
        }
        largestChunk = Math.max(largestChunk, chunk.length);
        setTimeout(() => {
          chunks.push(chunk);
          callback();
        }, 1);
      },
    });
    Object.defineProperty(destination, "isTTY", { value: true });
    await writeJsonOutput({ leaf }, destination);
    expect(largestChunk).toBeLessThan(Buffer.byteLength(leaf));
    const actual = Buffer.concat(chunks).toString("utf8");
    const expected = `${JSON.stringify({ leaf }, null, 2)}\n`;
    expect(actual.length).toBe(expected.length);
    expect(actual === expected).toBe(true);
    expect(destination.writableEnded).toBe(false);
  });

  it("waits for the final write even when it fits the destination buffer", async () => {
    let completed = false;
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        setTimeout(() => {
          completed = true;
          callback();
        }, 5);
      },
    });
    await writeJsonOutput({ result: "small" }, destination);
    expect(completed).toBe(true);
  });

  it.each([false, true])(
    "propagates a failed destination (deferred: %s)",
    async (deferred) => {
      const cause = new Error("Fixture destination failed");
      const destination = new Writable({
        write(_chunk, _encoding, callback) {
          if (deferred) setTimeout(() => callback(cause), 5);
          else callback(cause);
        },
      });
      await expect(
        writeJsonOutput({ result: "small" }, destination),
      ).rejects.toBe(cause);
    },
  );

  it("leaves a reusable destination open without adding error listeners", async () => {
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const listeners = destination.listenerCount("error");
    await writeJsonOutput({ result: "first" }, destination);
    await writeJsonOutput({ result: "second" }, destination);
    expect(destination.listenerCount("error")).toBe(listeners);
    expect(destination.writableEnded).toBe(false);
  });

  it("rejects a cycle at the serialization boundary", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(collect(cycle)).rejects.toThrow("circular reference");
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date(0)])(
    "rejects non-JSON input %s",
    async (value) => {
      await expect(collect(value)).rejects.toThrow("ordinary JSON");
    },
  );
});

describe("CLI command output wrapping", () => {
  it("wraps a mounted group root reached through its alias", async () => {
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const output = createCliResultOutput(
      parseCliOutputArguments(["--format", "json", "--full-output"]),
      destination,
    );
    if (output === undefined)
      throw new Error("Missing structured output surface");

    const group = Cli.create("nested", {
      aliases: ["nested-alias"],
      run: () => ({ kind: "group-root" }),
    }).command("child", { run: () => ({ kind: "child" }) });
    const cli = Cli.create("rea-output-group-test", { sync: false }).command(
      group,
    );
    streamCliCommandResults(cli, output);

    let fallback = "";
    await cli.serve(["nested-alias", "--format", "json"], {
      stdout: (text) => {
        if (!output.handled) fallback += text;
      },
    });

    expect(output.handled).toBe(true);
    expect(fallback).toBe("");
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toMatchObject({
      ok: true,
      data: { kind: "group-root" },
      meta: { command: "nested" },
    });
  });
});

describe("CLI result output surface", () => {
  it.each(["json", "yaml", "toon", "md"] as const)(
    "places typed analysis failures in the full-output error envelope (%s)",
    async (format) => {
      const chunks: Buffer[] = [];
      const destination = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });
      const failure = {
        error: "Analysis failed",
        code: "target_unavailable",
        category: "unavailable",
        message: "The selected artifact is missing.",
        retryable: false,
        remediation: { action: "Check that the path exists." },
        details: { source: "artifact-open" },
        input_path: "missing.dll",
        input_reason: "read-failed",
      };
      const argv = [
        "inspect-managed-artifact",
        "missing.dll",
        "--format",
        format,
        "--full-output",
        "--filter-output",
        "message",
      ];
      const output = createCliResultOutput(
        parseCliOutputArguments(argv),
        destination,
      );
      if (output === undefined)
        throw new Error("Missing structured output surface");
      const cli = Cli.create("rea-output-test", { sync: false });
      registerManagedCommands(cli, silentLogger, async () => ({
        ok: false,
        error: failure,
      }));
      streamCliCommandResults(cli, output);
      let fallback = "";
      const previousExitCode = process.exitCode;
      try {
        await cli.serve(argv, {
          stdout: (text) => {
            if (!output.handled) fallback += text;
          },
        });
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }

      const text = Buffer.concat(chunks).toString("utf8");
      expect(output.handled).toBe(true);
      expect(fallback).toBe("");
      if (format === "json" || format === "yaml") {
        const document = format === "json" ? JSON.parse(text) : parseYaml(text);
        expect(document).toMatchObject({
          ok: false,
          error: {
            code: failure.code,
            category: failure.category,
            message: failure.message,
            retryable: false,
            remediation: failure.remediation,
            details: {
              ...failure.details,
              input_path: failure.input_path,
              input_reason: failure.input_reason,
            },
          },
          meta: { command: "inspect-managed-artifact" },
        });
        expect(() =>
          analysisErrorProjectionSchema.parse(document.error),
        ).not.toThrow();
        expect(document).not.toHaveProperty("data");
      } else {
        expect(text).toContain("false");
        expect(text).toContain(failure.code);
        expect(text).not.toContain("true");
      }
    },
  );

  it.each([
    {
      name: "custom command failure",
      value: {
        status: "failed",
        message: "Update was not applied.",
        remediation: "Check the package manager, then retry.",
        details: { stage: "install" },
      },
      isFailure: () => true,
    },
    {
      name: "unhealthy doctor result",
      value: { healthy: false, checks: [{ name: "provider", ok: false }] },
      isFailure: undefined,
    },
  ])("preserves $name as a full-output error payload", async (scenario) => {
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const argv = ["fixture", "--json", "--full-output"];
    const output = createCliResultOutput(
      parseCliOutputArguments(argv),
      destination,
    );
    if (output === undefined) throw new Error("Missing JSON output surface");
    const cli = Cli.create("rea-output-test", { sync: false });
    cli.command("fixture", {
      run: () =>
        logCliCommand(
          silentLogger,
          "fixture",
          async () => scenario.value,
          scenario.isFailure,
        ),
    });
    streamCliCommandResults(cli, output);
    const previousExitCode = process.exitCode;
    try {
      await cli.serve(argv, { stdout: () => undefined });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toMatchObject({
      ok: false,
      error: scenario.value,
    });
  });
});

describe("full-output token windows", () => {
  it("preserves Incur token-window metadata when truncating a TOON failure", async () => {
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const argv = [
      "inspect-managed-artifact",
      "missing.dll",
      "--format",
      "toon",
      "--full-output",
      "--token-limit",
      "3",
    ];
    const output = createCliResultOutput(
      parseCliOutputArguments(argv),
      destination,
    );
    if (output === undefined) throw new Error("Missing TOON output surface");
    const cli = Cli.create("rea-output-test", { sync: false });
    registerManagedCommands(cli, silentLogger, async () => ({
      ok: false,
      error: {
        code: "target_unavailable",
        category: "unavailable",
        message: "The selected artifact is missing.",
        retryable: false,
        remediation: { action: "Check that the path exists." },
        details: { source: "artifact-open" },
      },
    }));
    streamCliCommandResults(cli, output);
    const previousExitCode = process.exitCode;
    try {
      await cli.serve(argv, { stdout: () => undefined });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("[truncated: showing tokens 0–3 of");
    expect(text).toMatch(/nextOffset:?\s*3/);
    expect(text).toContain("ok: false");
  });
});

describe("logger classification handoff", () => {
  it("honors an explicit success for data containing error-shaped fields", async () => {
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const result = {
      error: {
        code: "target_unavailable",
        category: "unavailable",
        message: "Source data describes a missing target.",
        retryable: false,
        remediation: { action: "Use the value as source data." },
      },
      source: "captured-metadata",
    };
    const argv = ["fixture", "--json", "--full-output"];
    const output = createCliResultOutput(
      parseCliOutputArguments(argv),
      destination,
    );
    if (output === undefined) throw new Error("Missing JSON output surface");
    const cli = Cli.create("rea-output-test", { sync: false });
    cli.command("fixture", {
      run: () =>
        logCliCommand(
          silentLogger,
          "fixture",
          async () => result,
          () => false,
        ),
    });
    streamCliCommandResults(cli, output);
    const previousExitCode = process.exitCode;
    try {
      await cli.serve(argv, { stdout: () => undefined });
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
    }
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toMatchObject({
      ok: true,
      data: result,
    });
  });
});

describe("full-output token counts", () => {
  it("counts the full failure payload before applying output filters", async () => {
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const failure = {
      code: "target_unavailable",
      category: "unavailable",
      message: "The selected artifact is missing.",
      retryable: false,
      remediation: { action: "Check that the path exists." },
      details: { source: "artifact-open" },
    };
    const argv = [
      "inspect-managed-artifact",
      "missing.dll",
      "--json",
      "--full-output",
      "--token-count",
      "--filter-output",
      "message",
    ];
    const output = createCliResultOutput(
      parseCliOutputArguments(argv),
      destination,
    );
    if (output === undefined) throw new Error("Missing JSON output surface");
    await output.write(failure, {
      command: "inspect-managed-artifact",
      duration: "0ms",
      format: "json",
    });
    expect(output.handled).toBe(true);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(
      `${estimateTokenCount(JSON.stringify({ ok: false, error: failure, meta: { command: "inspect-managed-artifact", duration: "0ms" } }) + "\n")}\n`,
    );
  });
  it("counts the exact emitted JSON representation and selected document", async () => {
    const metadata = { command: "fixture", duration: "0ms", format: "json" };
    for (const terminal of [false, true]) {
      for (const flags of [
        [],
        ["--full-output"],
        ["--filter-output", "missing"],
        ["--format", "jsonl"],
      ]) {
        const argv = ["fixture", "--json", ...flags];
        const render = async (count: boolean) => {
          const chunks: Buffer[] = [];
          const destination = new Writable({
            write(chunk: Buffer, _encoding, callback) {
              chunks.push(chunk);
              callback();
            },
          });
          Object.defineProperty(destination, "isTTY", { value: terminal });
          const output = createCliResultOutput(
            parseCliOutputArguments([
              ...argv,
              ...(count ? ["--token-count"] : []),
            ]),
            destination,
          );
          if (output === undefined) throw new Error("Missing output surface");
          await output.write({ value: ["hello", "雪😀"] }, metadata);
          return Buffer.concat(chunks).toString("utf8");
        };
        expect(Number((await render(true)).trim())).toBe(
          estimateTokenCount(await render(false)),
        );
      }
    }
  });

  it("normalizes exhausted failure window display coordinates", async () => {
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const output = createCliResultOutput(
      parseCliOutputArguments([
        "fixture",
        "--format",
        "toon",
        "--full-output",
        "--token-offset",
        "100000",
        "--token-limit",
        "3",
      ]),
      destination,
    );
    if (output === undefined) throw new Error("Missing output surface");
    await output.write(
      {
        code: "target_unavailable",
        category: "unavailable",
        message: "Missing target",
        retryable: false,
        remediation: { action: "Select an available target." },
      },
      { command: "fixture", duration: "0ms", format: "toon" },
    );
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toMatch(/showing tokens (\d+)–\1 of \1/);
    expect(text).not.toContain("nextOffset");
    expect(text).toContain("ok: false");
  });
});

describe("CLI result output surface", () => {
  it.each([
    ["--json", "--token-limit", "5"],
    ["--json", "--format", "invalid"],
  ])("delegates unsupported output controls %j", (...arguments_) => {
    expect(
      createCliResultOutput(
        parseCliOutputArguments(arguments_),
        new Writable(),
      ),
    ).toBe(undefined);
  });

  it("keeps ownership after a failed write so no second document is emitted", async () => {
    const cause = new Error("Fixture destination failed");
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback(cause);
      },
    });
    const output = createCliResultOutput(
      parseCliOutputArguments(["--json"]),
      destination,
    );
    if (output === undefined) throw new Error("Missing JSON output surface");
    await expect(
      output.write(
        { result: "small" },
        { command: "fixture", duration: "1ms", format: "json" },
      ),
    ).rejects.toBe(cause);
    expect(output.handled).toBe(true);
    expect(output.failed).toBe(true);
  });

  it("streams managed command output past the engine string limit and declines oversized token counting", async () => {
    const leaf = "x".repeat(64 * 1024);
    const count = Math.ceil(constants.MAX_STRING_LENGTH / leaf.length) + 1;
    const value = { methods: Array.from({ length: count }, () => leaf) };
    const expected = createHash("sha256");
    const encodedLeaf = JSON.stringify(leaf);
    const prefix = '{\n  "methods": [\n    ';
    const separator = ",\n    ";
    const suffix = "\n  ]\n}\n";
    expected.update(prefix);
    for (let index = 0; index < count; index += 1) {
      if (index > 0) expected.update(separator);
      expected.update(encodedLeaf);
    }
    expected.update(suffix);
    const expectedCharacters =
      prefix.length +
      count * encodedLeaf.length +
      (count - 1) * separator.length +
      suffix.length;
    expect(expectedCharacters).toBeGreaterThan(constants.MAX_STRING_LENGTH);

    const actual = createHash("sha256");
    let bytes = 0;
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        actual.update(chunk);
        callback();
      },
    });
    const cli = Cli.create("rea-output-test", { sync: false });
    registerManagedCommands(cli, silentLogger, async (...[path, operation]) => {
      expect(path).toBe("fixture.dll");
      expect(operation).toBe("inspect_managed_members");
      return { ok: false, error: value };
    });
    // A terminal destination exercises the indented encoding past the limit.
    Object.defineProperty(destination, "isTTY", { value: true });
    const argv = ["inspect-managed-members", "fixture.dll", "--json"];
    const output = createCliResultOutput(
      parseCliOutputArguments(argv),
      destination,
    );
    if (output === undefined) throw new Error("Missing JSON output surface");
    streamCliCommandResults(cli, output);
    let exitCode = 0;
    let fallbackBytes = 0;
    await cli.serve(argv, {
      stdout: (text) => {
        if (!output.handled) fallbackBytes += text.length;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
    expect(exitCode).toBe(0);
    expect(fallbackBytes).toBe(0);
    expect(bytes).toBe(expectedCharacters);
    expect(actual.digest("hex")).toBe(expected.digest("hex"));

    const chunks: Buffer[] = [];
    const tokenArgv = [...argv, "--token-count", "--full-output"];
    const tokenOutput = createCliResultOutput(
      parseCliOutputArguments(tokenArgv),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    if (tokenOutput === undefined)
      throw new Error("Missing token-count output surface");
    const tokenCli = Cli.create("rea-output-test", { sync: false });
    registerManagedCommands(tokenCli, silentLogger, async () => ({
      ok: false,
      error: value,
    }));
    streamCliCommandResults(tokenCli, tokenOutput);
    await tokenCli.serve(tokenArgv, {
      stdout: (text) => {
        if (!tokenOutput.handled) fallbackBytes += text.length;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
    expect(exitCode).toBe(1);
    expect(fallbackBytes).toBe(0);
    const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(report).toMatchObject({
      ok: false,
      error: {
        code: "resource_constraint",
        remediation: {
          action: expect.stringContaining("Remove --token-count"),
        },
        details: {
          reported_limits: {
            // Token counting uses the compact pipe encoding, unlike the
            // terminal digest above. Count leaves, separators and framing.
            formatted_characters:
              count * encodedLeaf.length +
              (count - 1) +
              '{"methods":[]}'.length +
              1 +
              JSON.stringify({ ok: true, data: null, meta: report.meta })
                .length -
              4,
            max_string_characters: constants.MAX_STRING_LENGTH,
          },
        },
      },
      meta: { command: "inspect-managed-members" },
    });
  }, 60_000);
});

describe("streamed CLI filtered selections", () => {
  it.each([
    ["raw_result", "json", "null\n"],
    ["raw_result", "jsonl", "JSONL_BOUNDARY_ERROR"],
    ["nested.value", "json", '{"nested":{"value":null}}\n'],
    ["missing", "json", "{}\n"],
    ["count", "json", "0\n"],
    ["enabled", "json", "false\n"],
  ] as const)(
    "keeps the selected value of --filter-output %s in %s",
    async (filter, format, expected) => {
      const chunks: Buffer[] = [];
      const destination = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });
      const output = createCliResultOutput(
        parseCliOutputArguments([
          "--format",
          format,
          "--filter-output",
          filter,
        ]),
        destination,
      );
      if (output === undefined) throw new Error("Missing JSON output surface");
      await output.write(
        { raw_result: null, nested: { value: null }, count: 0, enabled: false },
        { command: "fixture", duration: "1ms", format },
      );
      const text = Buffer.concat(chunks).toString("utf8");
      if (expected === "JSONL_BOUNDARY_ERROR")
        expect(JSON.parse(text)).toMatchObject({
          $rea: "jsonl/v1",
          type: "error",
          result: { code: "invalid_request", category: "invalid_input" },
        });
      else expect(text).toBe(expected);
    },
  );
});
