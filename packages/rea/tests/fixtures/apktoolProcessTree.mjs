import { spawn } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

const keepAlive = () => setInterval(() => {}, 1_000);

export const run = ({ mode, markerPath }) => {
  const operation = process.argv[2];
  if (mode === "decode" && operation === "--version") {
    process.stdout.write("2.9.3\n");
    return;
  }
  if (
    (mode !== "probe" && mode !== "decode") ||
    operation !== (mode === "probe" ? "--version" : "d")
  )
    throw new Error(`Unexpected Apktool fixture invocation: ${operation}`);
  const runId = process.env.REA_PROCESS_RUN_ID;
  if (typeof runId !== "string" || runId.length === 0)
    throw new Error("Apktool fixture has no owned process run token");
  if (mode === "decode") process.on("SIGTERM", () => {});
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "child", mode],
    {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  const timer = keepAlive();
  const publish = (ready) => {
    if (child.pid === undefined) throw new Error("Fixture child has no PID");
    const temporary = `${markerPath}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        rootPid: process.pid,
        childPid: child.pid,
        runId,
        ready,
      }),
    );
    renameSync(temporary, markerPath);
  };
  child.once("spawn", () => publish(false));
  child.on("message", (message) => {
    if (message === "ready") publish(true);
  });
  child.once("error", (cause) => {
    clearInterval(timer);
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
  });
};

if (process.argv[2] === "child") {
  if (process.argv[3] === "decode") process.on("SIGTERM", () => {});
  keepAlive();
  process.send("ready");
}
