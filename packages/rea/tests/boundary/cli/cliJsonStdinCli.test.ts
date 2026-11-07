import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect } from "vitest";

import { nativeJsonParseRequiredBytes } from "../../../src/application/JsonInputFile.js";
import { JSON_BYTE_ORDER_MARK_MESSAGE } from "../../../src/application/Utf8JsonInput.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { waitForExit } from "../../support/process/processFixture.js";

const probe = pathToFileURL(
  resolve("tests/fixtures/cliJsonStdinProbe.mjs"),
).href;

cliTest.for([
  [Buffer.from("\uFEFF{}"), JSON_BYTE_ORDER_MARK_MESSAGE],
  [Buffer.from([0xf0, 0x28, 0x8c, 0xbc]), "JSON input is not valid UTF-8"],
  [Buffer.from('{"secret-value":'), undefined],
] as const)(
  "projects piped JSON failures through the public CLI (%j)",
  async ([input, message], { cli }) => {
    const result = await cli.run({
      arguments: ["compare-wasm-interfaces", "-", "--json"],
      input,
    });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      input_path: "-",
      input_reason: "invalid-json",
      ...(message === undefined ? {} : { details: { issues: [{ message }] } }),
    });
    expect(result.stdout).not.toContain("secret-value");
  },
);

cliTest.for([false, true])(
  "admits piped JSON against real heap headroom (snapshot: %s)",
  async (snapshot, { processes }) => {
    const child = processes.spawn(
      process.execPath,
      [
        resolve("scripts/rea.mjs"),
        ...(snapshot
          ? ["environment-serve", "-", "--evidence", "{}"]
          : ["compare-wasm-interfaces", "-"]),
        "--json",
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=256 --import=${probe}`,
          REA_LOG_LEVEL: "silent",
        },
      },
    );
    let stdout = "",
      stderr = "";
    let writeFailure: unknown;
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    // Admission can close the reader before the producer finishes its write.
    child.stdin.on("error", (cause) => {
      writeFailure = cause;
    });
    const closed = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
    });
    await expect
      .poll(() => /REA_TEST_STDIN_READ (\d+)/u.test(stderr), {
        timeout: 10_000,
      })
      .toBe(true);
    const heapSizeLimit = Number(
      /REA_TEST_STDIN_READ (\d+)/u.exec(stderr)?.[1],
    );
    // Exceed the child's whole heap, independently of startup allocations or
    // when V8 last collected. Reuse the production owner's expansion estimate.
    let lower = 0,
      upper = heapSizeLimit;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (
        nativeJsonParseRequiredBytes(middle * 3 + 4, snapshot) > heapSizeLimit
      )
        upper = middle;
      else lower = middle + 1;
    }
    const input = `[${"[],".repeat(lower)}[]]`;
    expect(Buffer.byteLength(input)).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(
      nativeJsonParseRequiredBytes(Buffer.byteLength(input), snapshot),
    ).toBeGreaterThan(heapSizeLimit);
    child.stdin.end(input);
    expect(await waitForExit(child, 10_000), stderr).toBe(true);
    await closed;
    if (writeFailure !== undefined)
      expect(writeFailure).toMatchObject({ code: "EPIPE" });
    const result = {
      exitCode: child.exitCode,
      stderr,
      json: JSON.parse(stdout) as unknown,
    };
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "resource_constraint",
      input_path: "-",
      input_reason: "too-large",
      details: {
        resource: "memory",
        reported_limits: {
          input_path: "-",
          required_heap_bytes: expect.any(Number),
          available_heap_bytes: expect.any(Number),
        },
      },
    });
    const limits = (
      result.json as {
        details: {
          reported_limits: {
            input_bytes: number;
            required_heap_bytes: number;
            available_heap_bytes: number;
          };
        };
      }
    ).details.reported_limits;
    expect(limits.input_bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(limits.required_heap_bytes).toBe(
      nativeJsonParseRequiredBytes(limits.input_bytes, snapshot),
    );
    expect(limits.required_heap_bytes).toBeGreaterThan(
      limits.available_heap_bytes,
    );
  },
);

cliTest.skipIf(process.platform === "win32").for(
  [
    "capture-browser-scenario",
    "capture-electron-scenario",
    "compare-wasm-interfaces",
  ].flatMap((command) =>
    (
      [
        ["SIGINT", 130],
        ["SIGTERM", 143],
      ] as const
    ).map(([signal, exitCode]) => ({ command, signal, exitCode })),
  ),
)(
  "$command cancels an idle stdin reader on $signal",
  async ({ command, signal, exitCode }, { processes }) => {
    const child = processes.spawn(
      process.execPath,
      [resolve("scripts/rea.mjs"), command, "-", "--json"],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${probe}`,
          REA_LOG_LEVEL: "silent",
        },
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const closed = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
    });
    await expect
      .poll(() => stderr.includes("REA_TEST_STDIN_READ"), { timeout: 10_000 })
      .toBe(true);
    // Keep the pipe open: EOF must not be what releases the pending read.
    child.kill(signal);
    expect(await waitForExit(child, 5_000), stderr).toBe(true);
    await closed;
    expect(child.exitCode, stderr).toBe(exitCode);
    expect(JSON.parse(stdout)).toMatchObject({ code: "cancelled" });
  },
);
