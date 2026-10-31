import { Writable } from "node:stream";

import { Cli } from "incur";
import { describe, expect, it } from "vitest";

import { parseCliOutputArguments } from "../../../src/cliOutput.js";
import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";
import {
  cliOperationFailureIdentity,
  cliOperationFailurePayload,
  logCliCommand,
} from "../../../src/cliLogging.js";
import { ArtifactOperationError } from "../../../src/domain/artifactOperationError.js";
import { silentLogger } from "../../../src/logger.js";
import {
  cliEvidencePublicationReceipt,
  recordCliEvidencePublication,
  withCliEvidencePublication,
} from "../../../src/cli/cliEvidencePublication.js";

const metadata = { command: "fixture", duration: "1ms", format: "toon" };

it("keeps receipts isolated across concurrent invocations", async () => {
  const results = await Promise.all(
    ["first", "second"].map((path) =>
      withCliEvidencePublication(async () => {
        recordCliEvidencePublication({ path, bytes: 1 });
        await Promise.resolve();
        return cliEvidencePublicationReceipt();
      }),
    ),
  );
  expect(results).toEqual([
    { path: "first", bytes: 1 },
    { path: "second", bytes: 1 },
  ]);
  expect(cliEvidencePublicationReceipt()).toBeUndefined();
});

it("retains a publication receipt when formatting fails after the invocation context ends", async () => {
  const chunks: Buffer[] = [];
  const output = createCliResultOutput(
    parseCliOutputArguments([]),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  if (output === undefined) throw new Error("Missing output owner");
  await withCliEvidencePublication(async () => {
    recordCliEvidencePublication({ path: "/tmp/result.json", bytes: 123 });
    expect(await output.write({ result: "completed" }, metadata)).toBe(false);
  });
  expect(
    await output.recoverFormattingFailure(
      new RangeError("Invalid string length"),
    ),
  ).toBe(true);
  expect(output.error).toMatchObject({
    code: "resource_constraint",
    details: {
      diagnostics: {
        evidence_bundle: { path: "/tmp/result.json", bytes: 123 },
      },
    },
  });
  expect(Buffer.concat(chunks).toString("utf8")).toContain("/tmp/result.json");
});

describe("CLI formatting stage admission", () => {
  it("preserves native CTA sentinel output", async () => {
    const replies: string[] = [];
    for (const wrapped of [false, true]) {
      const cli = Cli.create("rea-output-test", { sync: false });
      cli.command("fixture", {
        run: (context) =>
          context.ok(
            { value: 42 },
            { cta: { commands: [{ command: "next" }] } },
          ),
      });
      const output = createCliResultOutput(
        parseCliOutputArguments(["fixture"]),
        new Writable(),
      );
      if (output === undefined) throw new Error("Missing output owner");
      if (wrapped) streamCliCommandResults(cli, output);
      let reply = "";
      await cli.serve(["fixture"], {
        stdout: (text) => {
          reply += text;
        },
      });
      expect(output.handled).toBe(false);
      replies.push(reply);
    }
    expect(replies[1]).toBe(replies[0]);
    expect(replies[0]).toContain("next");
  });

  it("captures thrown integrity failures without re-reading diagnostics during recovery", async () => {
    const previousExitCode = process.exitCode;
    try {
      const value = await logCliCommand(silentLogger, "fixture", async () => {
        throw new ArtifactOperationError("inspect_artifact", "integrity", {
          logicalPath: "entry.js",
          declaredSha256: "a".repeat(64),
          calculatedSha256: "b".repeat(64),
          unpacked: false,
        });
      });
      // A second traversal would be observable here. The producer already
      // classified this exact projection before the formatter sees it.
      Object.defineProperty(value, "details", {
        get() {
          throw new Error("Diagnostics were interpreted again");
        },
      });
      expect(cliOperationFailurePayload(value)).toBe(value);
      expect(cliOperationFailureIdentity(value)).toEqual({
        code: "artifact_integrity_mismatch",
        category: "integrity_mismatch",
        retryable: false,
      });
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("declines errors before a result or from a different failure class", async () => {
    const output = createCliResultOutput(
      parseCliOutputArguments([]),
      new Writable(),
    );
    expect(output).toBeDefined();
    expect(
      await output?.recoverFormattingFailure(
        new RangeError("Invalid string length"),
      ),
    ).toBe(false);
    await output?.write({ result: "completed" }, metadata);
    for (const cause of [
      new Error("Invalid string length"),
      new RangeError("Maximum call stack size exceeded"),
      new Error("operation failed"),
    ])
      expect(await output?.recoverFormattingFailure(cause)).toBe(false);
    expect(output?.handled).toBe(false);
  });

  it("leaves command RangeErrors under Incur's command failure protocol", async () => {
    const cli = Cli.create("rea-output-test", { sync: false });
    cli.command("fixture", {
      run: () => {
        throw new RangeError("Invalid string length");
      },
    });
    const output = createCliResultOutput(
      parseCliOutputArguments([]),
      new Writable(),
    );
    if (output === undefined) throw new Error("Missing output owner");
    streamCliCommandResults(cli, output);
    let text = "";
    let status = 0;
    await cli.serve(["fixture"], {
      stdout: (part) => {
        text += part;
      },
      exit: (code) => {
        status = code;
      },
    });
    expect(status).toBe(1);
    expect(text).toContain("UNKNOWN");
    expect(text).not.toContain("resource_constraint");
    expect(output.error).toBeUndefined();
  });
});

describe("CLI formatting recovery outcomes", () => {
  it("formats a recovered Markdown result through the CLI Markdown owner", async () => {
    const cause = new RangeError("Invalid string length");
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments(["--format", "md"]),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    const value = new Proxy(
      {},
      {
        ownKeys: () => {
          throw cause;
        },
      },
    );

    expect(await output?.write(value, { ...metadata, format: "md" })).toBe(
      true,
    );
    expect(output?.error).toMatchObject({ code: "resource_constraint" });
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("resource_constraint");
    expect(text).toContain("original result was not written");
    expect(output?.failed).toBe(false);
  });

  it("retains ownership if the recovery document cannot be written", async () => {
    const cause = new RangeError("Invalid string length");
    const output = createCliResultOutput(
      parseCliOutputArguments([]),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(cause);
        },
      }),
    );
    await output?.write({ result: "completed" }, metadata);
    await expect(output?.recoverFormattingFailure(cause)).rejects.toBe(cause);
    expect(output?.handled).toBe(true);
    expect(output?.failed).toBe(true);
    expect(await output?.recoverFormattingFailure(cause)).toBe(false);
  });

  it("does not replace a failed destination, even for the same RangeError", async () => {
    const cause = new RangeError("Invalid string length");
    const output = createCliResultOutput(
      parseCliOutputArguments(["--json"]),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(cause);
        },
      }),
    );
    await expect(
      output?.write({ result: "completed" }, { ...metadata, format: "json" }),
    ).rejects.toBe(cause);
    expect(output?.handled).toBe(true);
    expect(output?.failed).toBe(true);
    expect(await output?.recoverFormattingFailure(cause)).toBe(false);
  });

  it("retains the original failure identity and ignores large details on recovery", async () => {
    const chunks: Buffer[] = [];
    const output = createCliResultOutput(
      parseCliOutputArguments([]),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    const previousExitCode = process.exitCode;
    try {
      const value = await logCliCommand(silentLogger, "fixture", async () => ({
        code: "target_unavailable",
        category: "unavailable",
        message: "The operation did not complete.",
        retryable: false,
        remediation: { action: "Check the selected path." },
        details: { partial_observation: { text: "captured" } },
      }));
      expect(await output?.write(value, metadata)).toBe(false);
      expect(
        await output?.recoverFormattingFailure(
          new RangeError("Invalid string length"),
        ),
      ).toBe(true);
      expect(output?.error).toMatchObject({
        code: "resource_constraint",
        details: {
          resource: "memory",
          reported_limits: {
            formatted_characters: null,
            original_failure: {
              code: "target_unavailable",
              category: "unavailable",
            },
          },
        },
      });
      const text = Buffer.concat(chunks).toString("utf8");
      expect(text).toContain("--format json");
      expect(text).not.toContain("partial_observation");
      expect(
        await output?.recoverFormattingFailure(
          new RangeError("Invalid string length"),
        ),
      ).toBe(false);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
