import assert from "node:assert/strict";
import { readdir, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import { runOwnedCommand } from "../../../dist/process/OwnedCommand.js";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import {
  assertHistoricalPidAccess,
  historicalPidTraceContract,
} from "./trace-policy.mjs";
import { collectOwnershipTraceFacts } from "./trace-ownership.mjs";

/** Check attempted syscalls, including failed attempts, on a recorded PID that collides with an owned live sentinel. */
export async function verifyCoreInspectionTrace({
  root,
  environment,
  entrypoint,
  core,
  sentinel,
  runId,
  historicalPid = sentinel.pid,
}) {
  const gdb = await realpath(environment.REA_PWNDBG_GDB);
  const python = await realpath(environment.REA_PWNTOOLS_PYTHON);
  const plugin = resolve(environment.REA_PWNDBG_GDBINIT, "..");
  const helperPaths = (name) =>
    new Set([
      join(environment.REA_PWNDBG_VENV_PATH, "bin", name),
      ...(environment.PATH ?? "")
        .split(":")
        .filter(isAbsolute)
        .map((directory) => join(directory, name)),
    ]);
  const psPaths = helperPaths("ps");
  const iconvPaths = helperPaths("iconv");
  const gitPaths = helperPaths("git");
  const observations = [];
  for (const mode of ["cli", "mcp"]) {
    sentinel.assertAlive();
    const traceName = `inspection-${historicalPid}-${mode}.trace.`;
    const prefix = join(root, traceName.slice(0, -1));
    const invocation =
      mode === "cli"
        ? [
            entrypoint,
            "inspect-recorded-crash",
            core,
            "--debugger-context",
            "--json",
          ]
        : [
            fileURLToPath(new URL("./trace-client.mjs", import.meta.url)),
            entrypoint,
            core,
            String(historicalPid),
          ];
    const result = await runOwnedCommand(
      {
        command: environment.REA_VERIFY_STRACE_COMMAND,
        arguments: [
          "-ff",
          "-qq",
          "-yy",
          "-s",
          "8192",
          "-e",
          `trace=%process,%signal,%network,%file,ptrace,process_vm_readv,process_vm_writev,${historicalPidTraceContract.pid_syscalls.join(",")}`,
          "-o",
          prefix,
          process.execPath,
          ...invocation,
        ],
        cwd: root,
        hostEnvironment: environment,
        expectedCommand: null,
        runId,
      },
      { timeoutMs: 90_000, diagnosticBytes: 1024 * 1024 },
    );
    if (mode === "cli") {
      const report = parseEvidence(
        JSON.parse(result.stdout.text),
      ).normalized_result;
      assert.ok(
        report.threads.some(
          (thread) => thread.historical_pid === historicalPid,
        ),
        "CLI must decode the selected historical-PID control before its trace qualifies",
      );
    }
    const executions = [];
    const ownershipReads = [];
    let gdbObserved = false;
    const traces = [];
    for (const file of await readdir(root)) {
      if (!file.startsWith(traceName)) continue;
      const pid = Number(file.slice(traceName.length));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      const text = await readFile(join(root, file), "utf8");
      // Retain only execution/thread evidence across files, not all raw traces.
      const inventory = text
        .split("\n")
        .filter((line) =>
          /^(?:execve|clone|fork|vfork|<\.\.\. (?:clone|fork|vfork))/u.test(
            line,
          ),
        )
        .join("\n");
      traces.push({ pid, text: inventory, file });
    }
    const ownershipFacts = collectOwnershipTraceFacts({
      traces,
      nodeExecutable: process.execPath,
      psExecutables: psPaths,
    });
    for (const trace of traces) {
      const { file } = trace;
      const text = await readFile(join(root, file), "utf8");
      // Keep the source executable present: GDB 16 otherwise silently hides a
      // core-only violation when its automatic executable lookup finds nothing.
      const recordedExecutable = JSON.stringify(join(root, "fixture-program"));
      assert.ok(
        !text.split("\n").some((line) => line.includes(recordedExecutable)),
        `Inspection attempted access to the recorded executable: ${file}`,
      );
      ownershipReads.push(
        ...assertHistoricalPidAccess({
          trace: { pid: trace.pid, text },
          historicalPid,
          ownershipThreads: ownershipFacts.ownershipThreads,
          liveCollision: historicalPid === sentinel.pid,
          psInventory: ownershipFacts.psProcesses.has(trace.pid),
        }),
      );
      assert.ok(
        !/\bptrace\(/u.test(text),
        `Inspection attempted ptrace: ${file}`,
      );
      assert.ok(
        !/\bprocess_vm_(?:readv|writev)\(/u.test(text),
        `Inspection attempted process memory access: ${file}`,
      );
      assert.ok(
        !/\b(?:socket|connect|sendto|sendmsg)\([^\n]*(?:AF_INET|AF_INET6)/u.test(
          text,
        ),
        `Inspection attempted an Internet socket: ${file}`,
      );
    }
    for (const execution of ownershipFacts.executions) {
      const { line } = execution;
      const executable = await realpath(execution.path).catch(
        () => execution.path,
      );
      const ownership = execution.ownershipInventory;
      const iconv =
        iconvPaths.has(execution.path) && line.includes('["iconv", "-l"]');
      const version =
        gitPaths.has(execution.path) &&
        line.includes(
          "[" +
            [
              "git",
              "--git-dir",
              join(plugin, ".git"),
              "rev-parse",
              "--short",
              "HEAD",
            ]
              .map((argument) => JSON.stringify(argument))
              .join(", ") +
            "]",
        );
      assert.ok(
        [process.execPath, python, gdb].includes(executable) ||
          ownership ||
          iconv ||
          version,
        `Unexpected attempted host execution: ${line}`,
      );
      if (executable === gdb) gdbObserved = true;
      executions.push(executable);
    }
    assert.ok(gdbObserved, "Trace must include the actual core-only GDB stage");
    assert.ok(executions.includes(python));
    sentinel.assertAlive();
    observations.push({
      mode,
      executions,
      historical_pid: historicalPid,
      sentinel: "still-alive",
      ownership_process_table_reads: ownershipReads,
    });
  }
  return observations;
}
