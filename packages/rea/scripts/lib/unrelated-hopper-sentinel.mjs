import { spawn } from "node:child_process";

/** Start a source-owned decoy whose process title exercises broad Hopper kills. */
export const startUnrelatedHopperSentinel = async () => {
  const environment = { ...process.env };
  delete environment.REA_PROCESS_RUN_ID;
  const child = spawn(
    process.execPath,
    ["-e", "process.title = 'Hopper'; setInterval(() => undefined, 1000)"],
    {
      detached: true,
      stdio: "ignore",
      env: environment,
    },
  );
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  const assertAlive = () => {
    const pid = child.pid;
    if (
      pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      throw new Error(
        "Unrelated Hopper sentinel was terminated by verification",
      );
    }
    try {
      process.kill(pid, 0);
    } catch {
      throw new Error(
        "Unrelated Hopper sentinel was terminated by verification",
      );
    }
  };

  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
  };

  const verifyAndClose = async () => {
    try {
      assertAlive();
      return true;
    } finally {
      await close();
    }
  };

  assertAlive();
  return { assertAlive, close, verifyAndClose };
};
