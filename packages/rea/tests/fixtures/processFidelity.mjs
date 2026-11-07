import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const mode = process.argv[2];

if (mode === "interactive") {
  process.stdin.resume();
  let inputObserved = false;
  let resizeObserved = false;
  const reportResize = () => {
    const columns = String(process.stdout.columns);
    const rows = String(process.stdout.rows);
    process.stdout.write(`resize:${columns}x${rows}\n`);
    resizeObserved = columns === "100" && rows === "40";
    if (inputObserved && resizeObserved) process.exit(0);
  };
  process.stdout.write("prompt> ");
  process.on("SIGWINCH", reportResize);
  reportResize();
  process.stdin.on("data", (value) => {
    process.stdout.write(`input:${value.toString().trimEnd()} unicode:雪\n`);
    inputObserved = value.toString().trimEnd() === "answer";
    if (inputObserved && resizeObserved) process.exit(0);
  });
} else if (mode === "silent-interactive") {
  process.stdin.resume();
  process.stdin.on("data", (value) => {
    process.stdout.write(`input:${value.toString().trimEnd()}\n`);
    process.exit(0);
  });
} else if (mode === "partial") {
  process.stdout.write("partial-");
  setTimeout(() => {
    process.stdout.write("frame\n");
    process.exit(0);
  }, 25);
} else if (mode === "tree-child") {
  const grandchild = spawn(
    process.execPath,
    [process.argv[1], "tree-grandchild"],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  grandchild.on("message", (message) => {
    if (message !== "ready") return;
    process.send?.("ready");
    grandchild.disconnect();
  });
  setInterval(() => undefined, 1_000);
} else if (mode === "tree-grandchild") {
  process.send?.("ready");
  setInterval(() => undefined, 1_000);
} else if (mode === "tree") {
  const child = spawn(process.execPath, [process.argv[1], "tree-child"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child.on("message", (message) => {
    if (message !== "ready") return;
    process.stdout.write("tree-ready\n");
    child.disconnect();
    setTimeout(() => process.exit(0), 2_000);
  });
} else if (mode === "crash") {
  process.stderr.write("intentional-crash\n");
  process.exit(23);
} else if (mode === "hang") {
  setInterval(() => undefined, 1_000);
} else if (mode === "ready-hang") {
  await writeFile(process.argv[3], "ready");
  process.stdout.write("ready\n");
  setInterval(() => undefined, 1_000);
} else if (mode === "detached-cleanup") {
  const owned = spawn(process.execPath, [process.argv[1], "detached-child"], {
    detached: true,
    stdio: "ignore",
  });
  const unowned = spawn(process.execPath, [process.argv[1], "detached-child"], {
    detached: true,
    env: { ...process.env, REA_PROCESS_RUN_ID: "unowned-neighbor" },
    stdio: "ignore",
  });
  if (owned.pid === undefined || unowned.pid === undefined)
    throw new Error("detached fixture children did not receive PIDs");
  owned.unref();
  unowned.unref();
  await writeFile(
    process.argv[3],
    JSON.stringify({ ownedPid: owned.pid, unownedPid: unowned.pid }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.stdout.write("detached-ready\n");
} else if (mode === "detached-child") {
  setInterval(() => undefined, 1_000);
} else {
  process.stderr.write("unknown fixture mode\n");
  process.exit(2);
}
