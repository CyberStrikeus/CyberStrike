if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("READY\n");
let pending = "";
process.stdin.on("data", (data) => {
  pending += data.toString();
  if (!/[\r\n]/u.test(pending)) return;
  process.stdin.pause();
  const value = pending.replace(/[\r\n]+$/u, "");
  process.stdout.write(`echo:${value}\n`);
  const middle = Math.floor(value.length / 2);
  process.stdout.write(`split:${value.slice(0, middle)}`);
  setTimeout(() => {
    process.stdout.write(`${value.slice(middle)}\n`);
    process.stdout.write(
      `style:${value.slice(0, middle)}\u001b[31m${value.slice(middle)}\u001b[0m\nPUBLIC_TAIL\n`,
    );
    if (process.argv.includes("--linger")) setInterval(() => {}, 1000);
    else setTimeout(() => process.exit(0), 30);
  }, 120);
});
