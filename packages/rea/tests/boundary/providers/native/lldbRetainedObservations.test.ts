import { describe, expect, it } from "vitest";
import type { FileHandle } from "node:fs/promises";
import { err, ok, type Result } from "../../../../src/domain/result.js";

import { nativeCallPartialObservationSchema } from "../../../../src/domain/native/nativeCallPartialObservation.js";
import {
  LLDB_OBSERVATION_JOURNAL_MAX_BYTES,
  parseLldbObservationJournal,
  projectLldbPartialObservation,
  readBoundedPrefix,
  readLldbObservationJournal,
  readPartialCapture,
} from "../../../../src/native/LldbRetainedObservations.js";
import type { LldbReadbackFiles } from "../../../../src/native/LldbReadbackFiles.js";

const event = {
  sequence: 0,
  elapsed_ms: 1,
  thread_id: 2,
  breakpoint_index: 0,
  load_address: "0x1000",
  file_address: "0x1000",
  module: "fixture",
  module_path: "/tmp/fixture",
  symbol: "main",
  receiver_class: null,
  selector: null,
  registers: [],
  backtrace: [],
};

const observation = (
  reason: "cancelled" | "tracer-failure" | "cleanup-failure",
  journalText: string,
) => {
  const parsed = parseLldbObservationJournal(Buffer.from(journalText));
  return nativeCallPartialObservationSchema.parse(
    projectLldbPartialObservation({
      target: {
        path: "/tmp/fixture",
        sha256: "a".repeat(64),
        architecture: "arm64",
        arguments: ["--selected"],
        environment: { SELECTED_VALUE: "retained" },
        working_directory: "/tmp",
      },
      pid: 42,
      stdout: { text: "prefix", bytes: 6, truncated: true, complete: false },
      stderr: null,
      version: null,
      journal: parsed,
      reason,
    }),
  );
};

describe("LLDB retained observations", () => {
  it.each([
    ["cancellation", "cancelled"],
    ["bridge failure", "tracer-failure"],
    ["cleanup failure", "cleanup-failure"],
  ] as const)("retains admitted events after %s", (_case, reason) => {
    const journal = `${JSON.stringify({ kind: "event", event })}\n`;
    const partial = observation(reason, journal);
    expect(partial.events).toEqual([event]);
    expect(partial.coverage).toEqual({ status: "partial", reason });
    expect(partial.process.stdout).toMatchObject({
      text: "prefix",
      bytes: 6,
      complete: false,
      truncated: true,
    });
    expect(partial.process.stderr).toBeNull();
    expect(partial.process).not.toHaveProperty("exit_status");
    expect(partial.process).not.toHaveProperty("terminated");
    expect(partial.target).not.toHaveProperty("launch_identity");
    expect(partial).not.toHaveProperty("breakpoints");
    expect(partial.limitations).toContain(
      "The target stderr capture was unavailable.",
    );
  });

  it("keeps valid rows around malformed data and ignores a torn final row", () => {
    const journal = [
      JSON.stringify({ kind: "event", event }),
      "{bad-json}",
      JSON.stringify({ kind: "other-stop", reason: "signal SIGTERM" }),
      '{"kind":"event","event":',
    ].join("\n");
    const partial = observation("tracer-failure", journal);
    expect(partial.events).toEqual([event]);
    expect(partial.process.other_stops).toEqual(["signal SIGTERM"]);
    expect(partial.limitations).toContain(
      "1 observation journal row(s) were malformed or invalid and ignored (first at row 2).",
    );
    expect(partial.limitations).toContain(
      "The final observation journal record was incomplete and was ignored.",
    );
  });

  it("rejects invalid UTF-8 rows while retaining valid neighbors and literal replacement characters", () => {
    const before = Buffer.from(`${JSON.stringify({ kind: "event", event })}\n`);
    const invalid = Buffer.concat([
      Buffer.from('{"kind":"other-stop","reason":"before'),
      Buffer.from([0xff]),
      Buffer.from('after"}\n'),
    ]);
    const literalReplacement = Buffer.from(
      `${JSON.stringify({ kind: "other-stop", reason: "literal �" })}\n`,
    );
    const after = Buffer.from(
      `${JSON.stringify({ kind: "event", event: { ...event, sequence: 1 } })}\n`,
    );
    const parsed = parseLldbObservationJournal(
      Buffer.concat([before, invalid, literalReplacement, after]),
    );

    expect(parsed.events).toEqual([event, { ...event, sequence: 1 }]);
    expect(parsed.otherStops).toEqual(["literal �"]);
    expect(parsed.limitations).toContain(
      "1 observation journal row(s) were malformed or invalid and ignored (first at row 2).",
    );
  });

  it("ignores a torn non-ASCII tail without discarding completed rows", () => {
    const complete = Buffer.from(
      `${JSON.stringify({ kind: "event", event })}\n`,
    );
    const torn = Buffer.concat([
      Buffer.from('{"kind":"other-stop","reason":"'),
      Buffer.from([0xe2, 0x82]),
    ]);
    const parsed = parseLldbObservationJournal(Buffer.concat([complete, torn]));

    expect(parsed.events).toEqual([event]);
    expect(parsed.otherStops).toEqual([]);
    expect(parsed.limitations).toContain(
      "The final observation journal record was incomplete and was ignored.",
    );
    expect(parsed.limitations).not.toContain(
      expect.stringContaining("malformed or invalid"),
    );
  });
});

describe("LLDB retained observation read failures", () => {
  it("bounds malformed-row diagnostics for an 8 MiB journal", () => {
    const valid = JSON.stringify({ kind: "event", event });
    const malformed = '{"kind":"unknown"}\n';
    const malformedRows = Math.floor(
      (LLDB_OBSERVATION_JOURNAL_MAX_BYTES - valid.length * 2 - 2) /
        malformed.length,
    );
    const journal = `${valid}\n${malformed.repeat(malformedRows)}${valid}\n`;
    expect(Buffer.byteLength(journal)).toBeLessThanOrEqual(
      LLDB_OBSERVATION_JOURNAL_MAX_BYTES,
    );
    const partial = observation("tracer-failure", journal);
    expect(partial.events).toEqual([event, event]);
    expect(partial.limitations.length).toBeLessThanOrEqual(6);
    expect(
      partial.limitations.find((limitation) =>
        limitation.includes("malformed"),
      ),
    ).toMatch(
      /^\d+ observation journal row\(s\) were malformed or invalid and ignored \(first at row 2\)\.$/u,
    );
  });

  it("continues a bounded prefix read after short reads", async () => {
    const source = Buffer.from("retained prefix");
    let position = 0;
    const result = await readBoundedPrefix(
      source.length,
      async (buffer, offset, length, requestedPosition) => {
        expect(requestedPosition).toBe(position);
        const count = Math.min(2, length, source.length - position);
        source.copy(buffer, offset, position, position + count);
        position += count;
        return count;
      },
    );
    expect(result.bytesRead).toBe(source.length);
    expect(result.buffer.toString("utf8", 0, result.bytesRead)).toBe(
      "retained prefix",
    );
  });

  it("retains completed journal rows and the exact cause after a later read fails", async () => {
    const completeRow = `${JSON.stringify({ kind: "event", event })}\n`;
    const source = Buffer.from(`${completeRow}{"kind":"event"`);
    const failure = Object.assign(new Error("controlled EIO"), { code: "EIO" });
    const files = readbackFilesFailingAfter(
      source,
      Buffer.byteLength(completeRow),
      failure,
    );
    const result = await readLldbObservationJournal("journal", files);

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.status).toBe("read-failure");
    if (result.value.status !== "read-failure")
      throw new Error("Expected partial journal read failure");
    expect(result.value.parsed.events).toEqual([event]);
    expect(result.value.readFailure).toBe(failure);
    expect(result.value.limitations).toContain(
      `The observation journal read failed after ${String(Buffer.byteLength(completeRow))} bytes: controlled EIO`,
    );
  });

  it("retains an output prefix with a tagged read failure, but zero-byte failure remains an error", async () => {
    const prefix = "first output prefix";
    const source = Buffer.from(`${prefix} followed by unavailable bytes`);
    const failure = Object.assign(new Error("controlled EIO"), { code: "EIO" });
    const partial = await readPartialCapture(
      "stdout",
      readbackFilesFailingAfter(source, Buffer.byteLength(prefix), failure),
    );
    expect(partial.ok).toBe(true);
    if (!partial.ok) throw partial.error;
    expect(partial.value.status).toBe("read-failure");
    if (partial.value.status !== "read-failure")
      throw new Error("Expected partial output read failure");
    expect(partial.value.capture).toMatchObject({
      text: prefix,
      truncated: true,
      complete: false,
    });
    expect(partial.value.readFailure).toBe(failure);

    const firstReadFailure = await readPartialCapture(
      "stdout",
      readbackFilesFailingAfter(source, 0, failure),
    );
    expect(firstReadFailure.ok).toBe(false);
    if (!firstReadFailure.ok) expect(firstReadFailure.error).toBe(failure);
  });
});

const readbackFilesFailingAfter = (
  source: Buffer,
  retainedBytes: number,
  failure: Error,
): LldbReadbackFiles => {
  let calls = 0;
  const handle = {
    stat: async () => ({ size: source.byteLength }),
    read: async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      calls += 1;
      if (calls === 1 && retainedBytes === 0) throw failure;
      if (calls > 1) throw failure;
      const bytesRead = Math.min(retainedBytes, length);
      source.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead, buffer };
    },
  } as unknown as FileHandle;
  return {
    read: async <Value>(
      _path: string,
      read: (file: FileHandle) => Promise<Value>,
    ): Promise<Result<Value, unknown>> => {
      try {
        return ok(await read(handle));
      } catch (cause: unknown) {
        return err(cause);
      }
    },
  } as LldbReadbackFiles;
};
