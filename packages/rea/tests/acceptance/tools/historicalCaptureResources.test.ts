import {
  captureDecoderHeapRecovery,
  DEFAULT_CAPTURE_DECODER_HEAP,
} from "../../../src/config/captureDecoderHeap.js";
import { execFile } from "node:child_process";
import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES } from "../../../src/browser/history/CaptureRelease.js";
import { WEB_NETWORK_CAPTURE_LIMITS } from "../../../src/domain/webNetworkCapture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../../../scripts/rea.mjs", import.meta.url));
const entry = JSON.stringify({
  startedDateTime: "2026-01-01T00:00:00.000Z",
  time: 1,
  request: {
    method: "GET",
    url: "https://example.invalid/data",
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: -1,
    bodySize: 0,
  },
  response: {
    status: 200,
    statusText: "OK",
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: [],
    content: { size: 512, mimeType: "text/plain", text: "x".repeat(512) },
    redirectURL: "",
    headersSize: -1,
    bodySize: 512,
  },
  cache: {},
  timings: { send: 0, wait: 1, receive: 0 },
});
const capture = (count: number) =>
  `{"log":{"version":"1.2","creator":{"name":"synthetic","version":"1"},"entries":[${Array<string>(count).fill(entry).join(",")}]}}`;

// Node.js enforces the decoder's V8 heap flags. Bun ignores them; on Windows
// the decoder's Job Object commit limit is the enforced bound instead, and
// Bun elsewhere has no bound this capture can reach.
const jobLimit = NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES;
it.skipIf(process.versions.bun !== undefined && jobLimit === null)(
  "reports real HAR memory exhaustion through CLI and MCP and preserves server usability",
  async () => {
    const root = await createTestTempDirectory("rea-har-capacity-");
    const path = join(root, "caller-marked.har");
    const dense = capture(34_098);
    expect(Buffer.byteLength(dense)).toBeLessThan(
      WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
    );
    await writeFile(path, dense);
    const { call, client } = await connectLocalToolsMcp();
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
      sensitive_values: ["caller-marked"],
    });
    expect(response.isError).toBe(true);
    const exhausted = parseMcpToolError(response);
    expect(exhausted).toMatchObject({
      error: {
        code: "resource_constraint",
        retryable: false,
        details: {
          resource: "memory",
          limit: {
            setting: "capture.decoder_old_generation_mib",
            effective_value: 192,
            source: "default",
            rea_restart_required: false,
          },
          reported_limits:
            jobLimit === null
              ? {
                  old_generation_heap_mib: 192,
                  observed_exit_code: process.platform === "win32" ? 134 : null,
                  observed_signal:
                    process.platform === "win32" ? null : "SIGABRT",
                }
              : { process_memory_limit_bytes: jobLimit, observed_signal: null },
          captured_output:
            jobLimit === null
              ? {
                  stderr: expect.stringContaining("heap out of memory"),
                  truncated: false,
                }
              : { truncated: false },
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("caller-marked");
    expect(JSON.stringify(response)).not.toContain("rea doctor");
    const remediation = String(exhausted.error.remediation?.action ?? "");
    expect(remediation).toContain(
      captureDecoderHeapRecovery(DEFAULT_CAPTURE_DECODER_HEAP),
    );
    const failed: unknown = await execute(process.execPath, [
      cli,
      "inspect-web-network-capture",
      path,
      "har",
      "--json",
    ]).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failed).toMatchObject({ code: 1 });
    const stdout =
      typeof failed === "object" && failed !== null && "stdout" in failed
        ? String(failed.stdout)
        : "";
    expect(JSON.parse(stdout)).toMatchObject({
      code: "resource_constraint",
      details: {
        limit: {
          setting: "capture.decoder_old_generation_mib",
          effective_value: 192,
          source: "default",
          rea_restart_required: false,
        },
      },
      remediation: {
        action: expect.stringContaining(
          captureDecoderHeapRecovery(DEFAULT_CAPTURE_DECODER_HEAP),
        ),
      },
    });
    const small = join(root, "small.har");
    await writeFile(small, capture(2));
    await client.ping();
    const control = await call("inspect_web_network_capture", {
      capture_path: small,
      format: "har",
    });
    expect(control.isError, JSON.stringify(control)).not.toBe(true);
    expect(control.structuredContent).toMatchObject({
      normalized_result: { total_records: 2 },
    });
    const controlText = JSON.stringify(control.structuredContent);
    expect(controlText).toContain(
      "The effective REA_CAPTURE_DECODER_OLD_GENERATION_MIB value is 192 MiB (source default; default 192 MiB, floor 8 MiB, maximum 16384 MiB).",
    );
    expect(controlText).toContain("source default");
    expect(controlText).toContain("floor 8 MiB");
    expect(controlText).toContain("maximum 16384 MiB");
    expect(controlText).toContain(
      "Set REA_CAPTURE_DECODER_OLD_GENERATION_MIB in the environment that starts REA",
    );
    await truncate(path, WEB_NETWORK_CAPTURE_LIMITS.inputBytes + 1);
    const oversized = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
    });
    expect(parseMcpToolError(oversized)).toMatchObject({
      error: { code: "invalid_request" },
    });
  },
  60_000,
);
