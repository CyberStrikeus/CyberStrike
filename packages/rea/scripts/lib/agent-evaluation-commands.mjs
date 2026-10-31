import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { PassThrough, Writable } from "node:stream";

import {
  OwnedCommandFailure,
  prepareOwnedCommand,
  runOwnedCommand,
} from "../../dist/process/OwnedCommand.js";
import { ArtifactResourceScope } from "../../dist/artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../../dist/artifacts/AnalysisCleanupLease.js";
import { retainOwnedCommandCleanup } from "../../dist/providers/OwnedCommandCleanup.js";

/** Keep command ownership through failure and join cleanup before removing a run. */
export function createAgentEvaluationCommands({
  codex,
  evaluationRoot,
  evaluationEnvironment,
  optionalModel,
  timeoutMs,
  repositoryRoot,
}) {
  const resources = new ArtifactResourceScope();
  const resourceOwner = {
    retain(owner, resource) {
      resources.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      });
    },
    run: (work) => resources.run(work),
  };
  const diagnosticBytes = 32_768;

  async function execute(
    command,
    arguments_,
    cwd,
    env,
    limits,
    timeoutMessage,
  ) {
    return resourceOwner.run(async () => {
      try {
        // Fresh Darwin helper compilation has its own bounded deadline.
        await prepareOwnedCommand();
        return await runOwnedCommand(
          {
            command,
            arguments: arguments_,
            // CLI shims may execute through a shebang interpreter. Ownership
            // still uses the launch generation and token, not an argv prefix.
            expectedCommand: null,
            cwd,
            hostEnvironment: env,
            runId: randomUUID(),
            sweepTokenOwnedProcesses: true,
          },
          { diagnosticBytes, acceptNonZeroExit: true, ...limits },
        );
      } catch (cause) {
        retainOwnedCommandCleanup(
          cause,
          resourceOwner,
          "agent-evaluation",
          command,
        );
        if (cause instanceof OwnedCommandFailure && cause.reason === "timeout")
          throw new Error(timeoutMessage, { cause });
        throw cause;
      }
    });
  }

  return {
    async runCodex(prompt, approvedTools) {
      const arguments_ = [
        "--no-daemon",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "--color",
        "never",
        "-C",
        evaluationRoot,
        "-c",
        'approval_policy="never"',
        ...approvedTools.flatMap((name) => [
          "-c",
          `mcp_servers.rea.tools.${name}.approval_mode="approve"`,
        ]),
        ...(optionalModel === undefined ? [] : ["--model", optionalModel]),
        prompt,
      ];
      const events = [];
      const nonJson = [];
      let nonJsonBytes = 0;
      const stdout = new PassThrough();
      const lines = createInterface({ input: stdout });
      const linesClosed = new Promise((resolve) =>
        lines.once("close", resolve),
      );
      let lineError;
      lines.on("error", (cause) => {
        // The owned pipeline reports stream failure or cancellation. Join this
        // consumer too, without turning its forwarded error into a process crash.
        lineError = cause;
        lines.close();
      });
      lines.on("line", (line) => {
        try {
          events.push(JSON.parse(line));
        } catch {
          if (nonJsonBytes >= diagnosticBytes) return;
          const bytes = Buffer.from(
            `non-json stdout: ${line.slice(0, diagnosticBytes - nonJsonBytes)}`,
          );
          const retained = bytes.subarray(0, diagnosticBytes - nonJsonBytes);
          if (retained.length > 0) nonJson.push(retained);
          nonJsonBytes += retained.length;
        }
      });
      try {
        const result = await execute(
          codex,
          arguments_,
          evaluationRoot,
          evaluationEnvironment,
          { timeoutMs, stdout },
          `Codex evaluation timed out after ${String(timeoutMs)}ms`,
        );
        await linesClosed;
        if (lineError !== undefined) throw lineError;
        return {
          events,
          exitCode: result.exitCode ?? 1,
          stderr: Buffer.concat([...nonJson, Buffer.from(result.stderr.text)])
            .subarray(0, diagnosticBytes)
            .toString("utf8"),
        };
      } finally {
        stdout.destroy();
        lines.close();
        await linesClosed;
      }
    },

    async runProcess(command, arguments_, cwd, timeout, env = process.env) {
      const result = await execute(
        command,
        arguments_,
        cwd,
        env,
        {
          timeoutMs: timeout,
          stdout: new Writable({ write: (_chunk, _encoding, done) => done() }),
        },
        `${command} timed out`,
      );
      if (result.exitCode !== 0)
        throw new Error(
          `${command} failed with ${String(result.exitCode)}: ${result.stderr.text}`,
        );
    },

    async readCommandVersion(command) {
      const result = await execute(
        command,
        ["--version"],
        repositoryRoot,
        process.env,
        { timeoutMs: 10_000, diagnosticBytes: 8192 },
        `${command} --version timed out`,
      );
      if (result.exitCode !== 0)
        throw new Error(
          `${command} --version failed with ${String(result.exitCode)}: ${result.stderr.text}`,
        );
      const version = result.stdout.text.trim();
      if (version.length === 0)
        throw new Error(`${command} --version returned empty output`);
      return version;
    },

    close: () => resources.close(),
  };
}
