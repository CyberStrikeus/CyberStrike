import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [mode, path, initial, final, trigger, ready, done, exitCode] =
  process.argv.slice(2);

if (mode === "leader") {
  writeFileSync(path, initial);
  spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "descendant",
      path,
      initial,
      final,
      trigger,
      ready,
      done,
    ],
    { stdio: "ignore" },
  );
  const timer = setInterval(() => {
    if (!existsSync(ready)) return;
    clearInterval(timer);
    process.stdout.write("stage diagnostic", () =>
      process.exit(Number(exitCode)),
    );
  }, 5);
} else {
  writeFileSync(ready, String(process.pid));
  const timer = setInterval(() => {
    if (!existsSync(trigger)) return;
    writeFileSync(path, final);
    writeFileSync(done, "changed");
    clearInterval(timer);
  }, 5);
  setInterval(() => undefined, 1000);
}
