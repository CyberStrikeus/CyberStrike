import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Writes a periodic report, then behaves by mode:
// - "cooperative": stays alive; SIGTERM prints a line, writes a final report
//   and exits cleanly.
// - "ignoring": stays alive and swallows SIGTERM and SIGINT, so only SIGKILL
//   ends the process.
// - "delayed-ignoring": installs those handlers after a slow startup.
// - "exits": exits on its own at once.
// - "descendant": cooperates while leaving a SIGTERM-ignoring child for owned cleanup.
// An optional third argument is the exit code a cooperative finalizer uses.
const [mode, directory, finalExitCode = "0"] = process.argv.slice(2);

// Make the cancellation case exercise startup beyond its old 300 ms capture
// window deterministically, rather than relying on a busy CI runner.
if (mode === "delayed-ignoring") await delay(500);

writeFileSync(join(directory, "pid.txt"), String(process.pid));
writeFileSync(
  join(directory, "periodic.json"),
  JSON.stringify({ phase: "periodic" }),
);

if (mode === "exits") process.exit(0);

if (mode === "descendant") {
  const childDirectory = join(directory, "descendant");
  mkdirSync(childDirectory);
  spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "ignoring", childDirectory],
    { detached: true, stdio: "ignore" },
  );
}

if (mode === "ignoring" || mode === "delayed-ignoring") {
  process.on("SIGTERM", () => {
    writeFileSync(join(directory, "sigterm-received"), "received");
  });
  process.on("SIGINT", () => undefined);
} else {
  process.on("SIGTERM", () => {
    writeFileSync(join(directory, "sigterm-received"), "received");
    process.stdout.write("finalized\n");
    writeFileSync(
      join(directory, "final.json"),
      JSON.stringify({ phase: "final" }),
    );
    process.exit(Number(finalExitCode));
  });
}

setInterval(() => undefined, 1_000);
