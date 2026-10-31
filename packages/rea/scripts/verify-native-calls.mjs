import { requireMcpToolError } from "./lib/mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  artifactCli,
  artifactMcpResult,
  artifactMcpCall,
  withArtifactMcp,
} from "./lib/artifact-e2e.mjs";

const exec = promisify(execFile);

if (process.platform !== "darwin")
  throw new Error(
    "Native call observation verification requires macOS with Command Line Tools",
  );
for (const tool of ["clang", "lldb", "codesign", "nm"])
  try {
    await exec("/usr/bin/xcrun", ["--find", tool]);
  } catch (cause) {
    throw new Error(
      `Native call observation verification requires ${tool} from Command Line Tools (xcrun --find ${tool} failed)`,
      { cause },
    );
  }
const developerMode = await exec("/usr/sbin/DevToolsSecurity", ["-status"]);

const SOURCE = fileURLToPath(
  new URL("../tests/conformance/native/calls.m", import.meta.url),
);
const GREET = "-[ReaCallGreeter greet:times:]";
const INPUT = {
  breakpoints: [
    {
      kind: "objc-method",
      class_name: "ReaCallGreeter",
      selector: "greet:times:",
      method_type: "instance",
    },
    { kind: "function", name: "rea_call_add" },
  ],
  environment: { REA_CALLS_MARKER: "observed" },
  // Entry stops and Objective-C runtime reads slow the real target on busy hosts.
  duration_ms: 30_000,
  argument_registers: 4,
  backtrace_frames: 1,
};
const CLI_TIMEOUT_MS = 180_000;

/** Pointer-free facts that two runs of the same scenario must share. */
const stable = (result) =>
  result.events.map((event) => ({
    breakpoint_index: event.breakpoint_index,
    symbol: event.symbol,
    file_address: event.file_address,
    selector: event.selector,
    receiver_class: event.receiver_class,
    counter:
      event.symbol === GREET
        ? event.registers[3].value
        : event.registers[0].value,
  }));

const symbolAddress = async (binary, symbol) => {
  const { stdout } = await exec("/usr/bin/xcrun", ["nm", "-n", binary]);
  const line = stdout.split("\n").find((entry) => entry.endsWith(` ${symbol}`));
  assert.ok(line, `nm lists ${symbol}`);
  return `0x${BigInt(`0x${line.split(" ")[0]}`).toString(16)}`;
};

const checkScenario = async (binary) => {
  const result = await artifactCli(
    "observe-native-calls",
    binary,
    [JSON.stringify(INPUT)],
    { timeoutMs: CLI_TIMEOUT_MS },
  );
  assert.equal(result.process.outcome, "exited");
  assert.equal(result.process.exit_status, 0);
  assert.equal(result.process.terminated, true);
  assert.match(result.process.stdout.text, /^world x0 40\n/u);
  assert.match(result.process.stdout.text, /marker observed\n$/u);
  assert.equal(result.process.stdout.complete, true);
  assert.equal(result.process.stderr.complete, true);
  assert.deepEqual(result.coverage, {
    status: "complete",
    event_limit_reached: false,
    resource_limit_reached: false,
    unresolved_breakpoints: [],
  });
  const greet = result.events.filter(({ symbol }) => symbol === GREET);
  const add = result.events.filter(({ symbol }) => symbol === "rea_call_add");
  assert.equal(greet.length, 3, JSON.stringify(result));
  assert.equal(add.length, 3, JSON.stringify(result));
  for (const [index, event] of greet.entries()) {
    assert.equal(event.receiver_class, "ReaCallGreeter");
    assert.equal(event.selector, "greet:times:");
    assert.equal(event.registers[3].value, `0x${index}`);
    assert.equal(event.backtrace[0].symbol, "main");
    assert.equal(event.module, basename(binary));
  }
  for (const [index, event] of add.entries()) {
    assert.equal(event.registers[0].value, `0x${index}`);
    assert.equal(event.registers[1].value, "0x28");
  }
  // Breakpoints stop at the symbol itself, which Apple's nm reports.
  assert.equal(
    add[0].file_address,
    await symbolAddress(binary, "_rea_call_add"),
  );
  assert.equal(greet[0].file_address, await symbolAddress(binary, GREET));
  return result;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const checkBounds = async (binary) => {
  const flooded = await artifactCli(
    "observe-native-calls",
    binary,
    [
      JSON.stringify({
        breakpoints: [{ kind: "function", name: "rea_never_called" }],
        arguments: ["--flood"],
        duration_ms: 30_000,
      }),
    ],
    { timeoutMs: CLI_TIMEOUT_MS },
  );
  assert.equal(flooded.process.outcome, "exited");
  assert.equal(flooded.process.stdout.bytes, 2 * 1024 * 1024);
  assert.equal(flooded.process.stderr.bytes, 2 * 1024 * 1024);
  assert.equal(flooded.process.stdout.text.length, 1024 * 1024);
  assert.equal(flooded.process.stderr.text.length, 1024 * 1024);
  assert.equal(flooded.process.stdout.text, "O".repeat(1024 * 1024));
  assert.equal(flooded.process.stderr.text, "E".repeat(1024 * 1024));
  assert.equal(flooded.process.stdout.truncated, true);
  assert.equal(flooded.process.stderr.truncated, true);
  assert.equal(flooded.process.stdout.complete, true);
  assert.equal(flooded.process.stderr.complete, true);

  const limited = await artifactCli(
    "observe-native-calls",
    binary,
    [
      JSON.stringify({
        breakpoints: [{ kind: "function", name: "rea_call_add" }],
        max_events: 2,
        duration_ms: 30_000,
      }),
    ],
    { timeoutMs: CLI_TIMEOUT_MS },
  );
  assert.equal(limited.process.outcome, "event-limit");
  assert.equal(limited.events.length, 2);
  assert.equal(limited.process.terminated, true);
  assert.equal(alive(limited.process.pid), false);
  const elapsed = await artifactCli(
    "observe-native-calls",
    binary,
    [
      JSON.stringify({
        breakpoints: [{ kind: "function", name: "rea_call_add" }],
        arguments: ["--wait"],
        duration_ms: 1_500,
      }),
    ],
    { timeoutMs: CLI_TIMEOUT_MS },
  );
  assert.equal(elapsed.process.outcome, "duration-elapsed");
  assert.equal(elapsed.events.length, 0);
  assert.equal(alive(elapsed.process.pid), false);
};

const cliFailure = async (binary) => {
  let output;
  try {
    const completed = await exec(
      process.execPath,
      [
        fileURLToPath(new URL("rea.mjs", import.meta.url)),
        "observe-native-calls",
        binary,
        JSON.stringify(INPUT),
        "--json",
      ],
      {
        env: { ...process.env, REA_LOG_LEVEL: "silent" },
        timeout: CLI_TIMEOUT_MS,
      },
    );
    output = completed.stdout;
  } catch (cause) {
    return JSON.parse(cause.stdout);
  }
  throw new Error(`observe-native-calls unexpectedly succeeded: ${output}`);
};

/** Hardened runtime blocks the debugger unless get-task-allow is granted. */
const checkHardenedRuntime = async (directory, binary) => {
  const blocked = join(directory, "hardened");
  await exec("/bin/cp", [binary, blocked]);
  await exec("/usr/bin/xcrun", [
    "codesign",
    "-f",
    "-s",
    "-",
    "-o",
    "runtime",
    blocked,
  ]);
  const denied = await cliFailure(blocked);
  assert.equal(denied.code, "capability_unavailable");
  assert.match(denied.details.reason, /^debugger-attach-denied: /u);
  await withArtifactMcp(blocked, async (client) => {
    const deniedMcp = await artifactMcpCall(
      client,
      {
        name: "observe_native_calls",
        arguments: INPUT,
      },
      { timeout: CLI_TIMEOUT_MS },
    );
    assert.equal(deniedMcp.isError, true, JSON.stringify(deniedMcp));
    assert.equal(requireMcpToolError(deniedMcp).code, denied.code);
    assert.match(
      requireMcpToolError(deniedMcp).details.reason,
      /^debugger-attach-denied: /u,
    );
    assert.ok(requireMcpToolError(deniedMcp).details.partial_observation);
  });
  const allowed = join(directory, "debuggable");
  const entitlements = join(directory, "get-task-allow.plist");
  await writeFile(
    entitlements,
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>',
  );
  await exec("/bin/cp", [binary, allowed]);
  await exec("/usr/bin/xcrun", [
    "codesign",
    "-f",
    "-s",
    "-",
    "-o",
    "runtime",
    "--entitlements",
    entitlements,
    allowed,
  ]);
  const traced = await checkScenario(allowed);
  assert.equal(traced.process.exit_status, 0);
};

const directory = await mkdtemp(join(tmpdir(), "rea-native-calls-"));
try {
  const binary = join(directory, "ReaCalls");
  await exec("/usr/bin/xcrun", [
    "clang",
    "-fobjc-arc",
    "-framework",
    "Foundation",
    SOURCE,
    "-o",
    binary,
  ]);
  const viaCli = await checkScenario(binary);
  await withArtifactMcp(binary, async (client) => {
    const viaMcp = await artifactMcpResult(
      client,
      "observe_native_calls",
      INPUT,
    );
    assert.equal(
      viaMcp.process.outcome,
      "exited",
      JSON.stringify(viaMcp.coverage),
    );
    assert.deepEqual(stable(viaMcp), stable(viaCli));
    assert.equal(viaMcp.process.stdout.text, viaCli.process.stdout.text);

    // Two caller selections may resolve to one address. Each must retain its
    // own hit; consuming only the first stop-reason ID loses the second.
    const overlapping = {
      breakpoints: [
        { kind: "function", name: "rea_call_add" },
        { kind: "function", name: "rea_call_add", module: basename(binary) },
      ],
      duration_ms: 30_000,
      argument_registers: 2,
    };
    const paired = await artifactMcpResult(
      client,
      "observe_native_calls",
      overlapping,
    );
    assert.equal(paired.process.outcome, "exited");
    assert.equal(paired.events.length, 6);
    for (const index of [0, 1]) {
      const hits = paired.events.filter(
        (event) => event.breakpoint_index === index,
      );
      assert.deepEqual(
        hits.map((event) => event.registers[0].value),
        ["0x0", "0x1", "0x2"],
      );
      assert.ok(hits.every((event) => event.symbol === "rea_call_add"));
    }
    const capped = await artifactMcpResult(client, "observe_native_calls", {
      ...overlapping,
      max_events: 2,
    });
    assert.equal(capped.process.outcome, "event-limit");
    assert.equal(capped.events.length, 2);
    assert.equal(capped.process.terminated, true);
  });
  await checkBounds(binary);
  await checkHardenedRuntime(directory, binary);
  console.log(
    JSON.stringify({
      ok: true,
      developer_mode: developerMode.stdout.trim(),
      mocked: false,
      cli: true,
      stdio_mcp: true,
      debugger: viaCli.debugger.version,
      events: viaCli.events.length,
      outcomes: ["exited", "event-limit", "duration-elapsed"],
      hardened_runtime: {
        without_get_task_allow: "denied",
        with_get_task_allow: "traced",
      },
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
