import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import { recordedCrashSchema } from "../../../dist/domain/native/recordedCrash.js";
import { mcpTextValue } from "../../lib/mcp-verifier-results.mjs";

const execute = promisify(execFile);

/** Exercise the public installed CLI and SDK transport with the same selected environment. */
export async function connectRecordedCrash({ entrypoint, environment }) {
  const client = new Client({ name: "recorded-crash-verifier", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: environment,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
  } catch (cause) {
    await transport.close();
    throw cause;
  }
  return {
    client,
    async inspect(mode, path, { debuggerContext = false, category } = {}) {
      const original = await readFile(path);
      let evidence;
      if (mode === "mcp") {
        const response = await client.callTool(
          {
            name: "inspect_recorded_crash",
            arguments: { path, include_debugger_context: debuggerContext },
          },
          { timeout: 90_000 },
        );
        const value = JSON.parse(mcpTextValue(response));
        if (category !== undefined) {
          assert.equal(response.isError, true);
          assert.equal(value.error.category, category, JSON.stringify(value));
          assert.deepEqual(await readFile(path), original);
          return value.error;
        }
        assert.notEqual(response.isError, true, JSON.stringify(value));
        evidence = parseEvidence(value);
        assert.deepEqual(value.normalized_result, evidence.normalized_result);
      } else {
        assert.equal(mode, "cli");
        let response;
        try {
          response = await execute(
            process.execPath,
            [
              entrypoint,
              "inspect-recorded-crash",
              path,
              ...(debuggerContext ? ["--debugger-context"] : []),
              "--json",
            ],
            { env: environment, timeout: 90_000, maxBuffer: 32 * 1024 * 1024 },
          );
        } catch (cause) {
          if (category === undefined || typeof cause.code !== "number")
            throw cause;
          const error = JSON.parse(cause.stdout);
          assert.equal(error.category, category, JSON.stringify(error));
          assert.deepEqual(await readFile(path), original);
          return error;
        }
        assert.equal(category, undefined, "Expected an explicit failure");
        evidence = parseEvidence(JSON.parse(response.stdout));
      }
      const report = recordedCrashSchema.parse(evidence.normalized_result);
      assert.equal(
        evidence.confidence,
        debuggerContext ? "derived" : "observed",
      );
      assert.equal(evidence.raw_result, null);
      assert.equal(evidence.subject.local_path, path);
      assert.equal(report.artifact.path, path);
      assert.equal(
        report.artifact.sha256,
        createHash("sha256").update(original).digest("hex"),
      );
      assert.equal(report.artifact.bytes, original.length);
      assert.equal(
        evidence.provider.version,
        "pwntools@4.15.0;pyelftools@0.33;unicorn@2.1.2",
      );
      assert.equal(report.target_execution, "not-performed");
      assert.equal(report.live_process_identity, "unknown");
      assert.equal(report.diagnostics.truncated, false);
      assert.equal(
        report.debugger.status,
        debuggerContext ? "available" : "not-requested",
      );
      for (const note of report.notes) {
        for (const [encoded, range] of [
          [note.owner_bytes_base64, note.owner_location],
          [note.descriptor_bytes_base64, note.descriptor_location],
        ]) {
          const start = Number(BigInt(range.offset));
          assert.deepEqual(
            Buffer.from(encoded, "base64"),
            original.subarray(start, start + Number(BigInt(range.bytes))),
          );
        }
      }
      for (const thread of report.threads) {
        assert.equal(thread.registers.length, 27);
        for (const register of thread.registers)
          assert.equal(
            BigInt(register.value),
            original.readBigUInt64LE(Number(BigInt(register.location.offset))),
          );
      }
      assert.deepEqual(await readFile(path), original);
      return report;
    },
    async close() {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    },
  };
}
