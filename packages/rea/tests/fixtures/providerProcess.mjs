import { spawn } from "node:child_process";

const [mode, value = "0"] = process.argv.slice(2);
let keepAliveTimer;
let detachedChild;

const keepAlive = () => {
  keepAliveTimer = setInterval(() => undefined, 1_000);
};

const stopDetachedFixture = (signal) => {
  if (keepAliveTimer !== undefined) clearInterval(keepAliveTimer);
  if (detachedChild?.exitCode === null) detachedChild.kill(signal);
  process.exitCode = signal === "SIGINT" ? 130 : 143;
};

const write = (stream, data) =>
  new Promise((resolve, reject) => {
    stream.write(data, (cause) => {
      if (cause) reject(cause);
      else resolve();
    });
  });

switch (mode) {
  case "late-stderr": {
    // Keep stderr open after leader exit. FD3 is the test's explicit release barrier.
    const writer = spawn(
      process.execPath,
      [
        "-e",
        "const deadline=setTimeout(()=>process.exit(64),5000); require('node:fs').readFile(3,error=>{clearTimeout(deadline);if(error)process.exitCode=65;else process.stderr.write('final-tail');});",
      ],
      { stdio: ["ignore", "ignore", process.stderr, 3] },
    );
    await new Promise((resolve, reject) => {
      writer.once("spawn", resolve);
      writer.once("error", reject);
    });
    writer.unref();
    break;
  }
  case "burst": {
    const bytes = Number(value);
    await Promise.all([
      write(process.stdout, "o".repeat(bytes)),
      write(process.stderr, "e".repeat(bytes)),
    ]);
    process.exitCode = 23;
    break;
  }
  case "invalid-utf8":
    await write(process.stdout, Buffer.from([0x61, 0xff, 0x62]));
    await write(process.stderr, Buffer.from([0x63, 0xfe, 0x64]));
    break;
  case "valid-multibyte":
    await write(process.stdout, Buffer.from([0xe2, 0x82, 0xac]));
    break;
  case "exit":
    process.exitCode = Number(value);
    break;
  case "graceful":
    process.on("SIGTERM", () => process.exit(0));
    await write(process.stdout, "ready\n");
    keepAlive();
    break;
  case "stubborn":
    process.on("SIGTERM", () => undefined);
    await write(process.stdout, "ready\n");
    keepAlive();
    break;
  case "detached-child": {
    detachedChild = spawn(
      process.execPath,
      [
        "-e",
        "setInterval(() => undefined, 1000); setTimeout(() => process.exit(0), 10000)",
      ],
      { detached: true, stdio: "ignore" },
    );
    await new Promise((resolve, reject) => {
      detachedChild.once("spawn", resolve);
      detachedChild.once("error", reject);
    });
    process.once("SIGINT", () => stopDetachedFixture("SIGINT"));
    process.once("SIGTERM", () => stopDetachedFixture("SIGTERM"));
    await write(process.stdout, `ready:${detachedChild.pid}\n`);
    detachedChild.unref();
    keepAlive();
    break;
  }
  default:
    process.stderr.write(`unknown provider-process fixture mode: ${mode}\n`);
    process.exitCode = 64;
}
