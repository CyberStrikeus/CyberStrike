import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "child") {
  setTimeout(() => {}, 1_000);
} else {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "child"],
    {
      stdio: "inherit",
    },
  );
  child.on("error", (cause) => {
    throw cause;
  });
  if (child.pid === undefined) throw new Error("Child did not launch");
  writeFileSync(
    process.argv[2],
    JSON.stringify({ root_pid: process.pid, child_pid: child.pid }),
  );
  process.stdout.write(
    `root pid ${process.pid}\nchild pid ${child.pid}\ncount 9007199254740991\n`,
  );
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
