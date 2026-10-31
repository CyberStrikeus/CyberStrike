import { runOwnedVerifierTerminal } from "./owned-verifier-terminal.mjs";
import {
  captureVerifierFileSnapshot,
  assertVerifierFilesUnchanged,
} from "./verifier-file-snapshots.mjs";

export const terminalModesRestored = (termios) => {
  if (typeof termios !== "string") return false;
  const modes = new Set(termios.trim().split(/\s+/u));
  return modes.has("icanon") && modes.has("echo");
};

export async function verifyInteractiveSetup({
  commands,
  command,
  environment,
  root,
  unchangedPaths,
}) {
  const unchanged = await captureVerifierFileSnapshot(commands, unchangedPaths);
  let cancelled = false;
  const wrapper = `
      const { spawnSync } = require("node:child_process");
      const child = spawnSync(process.argv[1], ["setup"], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
      const terminal = process.platform === "win32"
        ? spawnSync("cmd.exe", ["/c", "mode", "CON"], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] })
        : spawnSync("stty", ["-a"], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
      process.stdout.write("\\n__REA_SETUP_EXIT__" + JSON.stringify({ status: child.status, termios: terminal.stdout, error: child.error?.message }));
      process.exit(child.status ?? 1);
    `;
  let result;
  try {
    result = await runOwnedVerifierTerminal({
      commands,
      command: process.execPath,
      args: ["-e", wrapper, command],
      cwd: root,
      environment: { ...environment, NO_COLOR: "1", TERM: "xterm-256color" },
      timeoutMs: 20_000,
      onData(output, write) {
        if (!cancelled && output.includes("Which agents should use REA?")) {
          cancelled = true;
          write("\u0003");
        }
      },
    });
  } catch (cause) {
    if (cause?._tag === "VerifierTerminalFailure" && cause.reason === "timeout")
      throw new Error(
        `packaged setup wizard timed out after output: ${cause.output}`,
        { cause },
      );
    throw cause;
  }
  const { output, exitCode } = result;
  const marker = output.lastIndexOf("__REA_SETUP_EXIT__");
  let childResult;
  try {
    childResult =
      marker < 0 ? undefined : JSON.parse(output.slice(marker + 18).trim());
  } catch {
    childResult = undefined;
  }
  if (
    !cancelled ||
    exitCode !== 0 ||
    childResult?.status !== 0 ||
    !output.includes("\u001b[?25h") ||
    !terminalModesRestored(childResult?.termios) ||
    !output.includes("No changes were made.")
  )
    throw new Error(
      `packaged rea-agents setup did not cancel with a restored terminal and exit 0: ${output}`,
    );
  await assertVerifierFilesUnchanged(
    commands,
    unchanged,
    "Interactive cancellation",
  );
}

export async function verifyRedirectedStdoutSetup({
  commands,
  command,
  environment,
  root,
  unchangedPaths,
}) {
  const unchanged = await captureVerifierFileSnapshot(commands, unchangedPaths);
  const wrapper = `
      const { spawnSync } = require("node:child_process");
      const child = spawnSync(process.argv[1], ["setup"], { encoding: "utf8", env: process.env, stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32" });
      process.stdout.write("\\n__REA_REDIRECTED_SETUP__" + JSON.stringify({ status: child.status, stdout: child.stdout, error: child.error?.message, stdinTTY: process.stdin.isTTY, stderrTTY: process.stderr.isTTY, stdoutRedirected: true }));
      process.exit(child.status ?? 1);
    `;
  let result;
  try {
    result = await runOwnedVerifierTerminal({
      commands,
      command: process.execPath,
      args: ["-e", wrapper, command],
      cwd: root,
      environment: { ...environment, NO_COLOR: "1", TERM: "xterm-256color" },
      timeoutMs: 15_000,
    });
  } catch (cause) {
    if (cause?._tag === "VerifierTerminalFailure" && cause.reason === "timeout")
      throw new Error(
        `packaged setup started an interactive prompt with redirected stdout: ${cause.output}`,
        { cause },
      );
    throw cause;
  }
  const { output, exitCode } = result;
  const marker = output.lastIndexOf("__REA_REDIRECTED_SETUP__");
  let childResult;
  try {
    childResult =
      marker < 0 ? undefined : JSON.parse(output.slice(marker + 24).trim());
  } catch {
    childResult = undefined;
  }
  const allOutput = `${output}\n${childResult?.stdout ?? ""}`;
  if (
    (exitCode !== 0 && exitCode !== 1) ||
    childResult?.status !== exitCode ||
    childResult?.stdinTTY !== true ||
    childResult?.stderrTTY !== true ||
    childResult?.stdoutRedirected !== true ||
    childResult?.stdout?.includes("Which agents should use REA?") ||
    allOutput.includes("Which agents should use REA?") ||
    /\u001b\[[0-9;?]*[ -/]*[@-~]/u.test(allOutput)
  )
    throw new Error(
      `packaged setup did not remain plain and non-interactive with redirected stdout: ${output}`,
    );
  await assertVerifierFilesUnchanged(
    commands,
    unchanged,
    "Redirected-stdout setup",
  );
}
