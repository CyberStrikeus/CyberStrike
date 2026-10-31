import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { assertCleanLinuxHopperRuntime } from "../../../scripts/lib/clean-linux-hopper-runtime.mjs";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  prepareRenamedNodeLauncher,
  retainedRuntimeNodeCode,
} from "../../fixtures/retainedRuntimeNode.js";

const execFileAsync = promisify(execFile);

it.runIf(process.platform === "linux").each([
  ["Xvfb", "Clean Linux runner retained a Hopper demo process"],
  ["Hopper", "Clean Linux runner retained a Hopper demo process"],
  ["python3", "Cannot identify a command-less Python process"],
  ["unrelated", undefined],
] as const)(
  "observes an unreaped %s without signaling or reaping it",
  async (name, refusal) => {
    const directory = await createTestTempDirectory("rea-runtime-zombie-");
    const procRoot = join(directory, "proc");
    await mkdir(procRoot);
    const executable = join(directory, name);
    await copyFile("/usr/bin/true", executable);
    await chmod(executable, 0o700);
    // WNOWAIT observes exit without reaping. The parent keeps the zombie until
    // the test closes its stdin, then waitpid performs the actual cleanup.
    const parent = execFileAsync(
      "/usr/bin/python3",
      [
        "-c",
        `
import os, sys
pid = os.fork()
if pid == 0:
    os.execl(sys.argv[1], sys.argv[1])
try:
    os.waitid(os.P_PID, pid, os.WEXITED | os.WNOWAIT)
    print(pid, flush=True)
    sys.stdin.buffer.read(1)
finally:
    os.waitpid(pid, 0)
`,
        executable,
      ],
      { timeout: 10_000 },
    );
    if (parent.child.stdout === null)
      throw new Error("Fixture parent has no readiness pipe");
    const lines = createInterface({ input: parent.child.stdout });
    const ready = new Promise<number>((resolve, reject) => {
      lines.once("line", (line) => {
        lines.close();
        resolve(Number(line.trim()));
      });
      parent.catch(reject);
    });
    let zombiePid: number | undefined;
    try {
      zombiePid = await ready;
      expect(Number.isSafeInteger(zombiePid)).toBe(true);
      const prefix = `/proc/${String(zombiePid)}`;
      const procEntry = join(procRoot, String(zombiePid));
      await mkdir(procEntry);
      for (const name of ["cmdline", "comm"])
        await symlink(`${prefix}/${name}`, join(procEntry, name));
      expect(await readFile(`${prefix}/cmdline`, "utf8")).toBe("");
      expect((await readFile(`${prefix}/comm`, "utf8")).trim()).toBe(name);
      const observation = assertCleanLinuxHopperRuntime([], procRoot);
      if (refusal === undefined)
        await expect(observation).resolves.toBeUndefined();
      else await expect(observation).rejects.toThrow(refusal);
      expect(await readFile(`${prefix}/stat`, "utf8")).toContain(
        `(${name}) Z `,
      );
    } finally {
      parent.child.stdin?.end("reap");
      await parent;
      if (zombiePid !== undefined)
        await expect(
          readFile(`/proc/${String(zombiePid)}/stat`, "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);

it.runIf(process.platform === "linux")(
  "does not treat runtime names in another process's arguments as a runtime",
  async () => {
    const directory = await createTestTempDirectory("rea-runtime-arguments-");
    const procRoot = join(directory, "proc");
    await mkdir(procRoot);
    const observer = new URL(
      "../../../scripts/lib/clean-linux-hopper-runtime.mjs",
      import.meta.url,
    ).href;
    const code = `
      import { mkdir, symlink } from "node:fs/promises";
      import { join } from "node:path";
      const { assertCleanLinuxHopperRuntime } = await import(${JSON.stringify(observer)});
      const entry = join(${JSON.stringify(procRoot)}, String(process.pid));
      await mkdir(entry);
      await symlink("/proc/" + process.pid + "/cmdline", join(entry, "cmdline"));
      await symlink("/proc/" + process.pid + "/comm", join(entry, "comm"));
      await assertCleanLinuxHopperRuntime([], ${JSON.stringify(procRoot)});
      console.log('clean');
    `;
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        code,
        procRoot,
        "Xvfb",
        "/opt/hopper/bin/Hopper",
        "hopper-demo-x11.py",
      ],
      { timeout: 10_000 },
    );
    expect(stdout.trim()).toBe("clean");
  },
);

it.runIf(process.platform === "linux")(
  "distinguishes an ordinary Node script with the helper's filename",
  async () => {
    const directory = await createTestTempDirectory("rea-runtime-arguments-");
    const procRoot = join(directory, "proc");
    await mkdir(procRoot);
    const script = join(directory, "hopper-demo-x11.py");
    const observer = new URL(
      "../../../scripts/lib/clean-linux-hopper-runtime.mjs",
      import.meta.url,
    ).href;
    const code = `
      import { mkdir, symlink } from "node:fs/promises";
      import { join } from "node:path";
      const entry = join(${JSON.stringify(procRoot)}, String(process.pid));
      await mkdir(entry);
      await symlink("/proc/" + process.pid + "/cmdline", join(entry, "cmdline"));
      await symlink("/proc/" + process.pid + "/comm", join(entry, "comm"));
      const { assertCleanLinuxHopperRuntime } = await import(${JSON.stringify(observer)});
      await assertCleanLinuxHopperRuntime([], ${JSON.stringify(procRoot)});
      console.log('clean');
    `;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", code, script],
      { timeout: 10_000 },
    );
    expect(stdout.trim()).toBe("clean");
  },
);

const launchReapedOrphan = (runId: string, parentCode: string) => {
  // The short-lived Node launcher still exits before observation. A retained
  // subreaper adopts its child and waits after owned cleanup, even when the
  // container's PID 1 does not reap. It is a sibling of the verifier below.
  const reaper = execFileAsync(
    "/usr/bin/python3",
    [
      "-c",
      `
import ctypes, json, os, subprocess, sys
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0: # PR_SET_CHILD_SUBREAPER
    raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER")
launcher = subprocess.run(sys.argv[1:], capture_output=True, text=True, check=True)
child = json.loads(launcher.stdout)
try:
    print(json.dumps(child), flush=True)
    sys.stdin.buffer.read(1)
finally:
    os.waitpid(child["pid"], 0)
`,
      process.execPath,
      "-e",
      parentCode,
    ],
    {
      env: { ...process.env, REA_PROCESS_RUN_ID: runId },
      timeout: 40_000,
    },
  );
  if (reaper.child.stdout === null)
    throw new Error("Fixture reaper has no readiness pipe");
  const lines = createInterface({ input: reaper.child.stdout });
  const ready = new Promise<{ pid: number; parentPid: number }>(
    (resolve, reject) => {
      lines.once("line", (line) => {
        lines.close();
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error);
        }
      });
      reaper.then(
        () => reject(new Error("Fixture reaper exited before readiness")),
        reject,
      );
    },
  );
  return { reaper, ready };
};

const observeFromSeparateVerifier = async (
  runId: string,
  launcherPaths: string[],
  procRoot: string,
) => {
  const observer = new URL(
    "../../../scripts/lib/clean-linux-hopper-runtime.mjs",
    import.meta.url,
  ).href;
  const verifierRun = new URL(
    "../../../scripts/lib/verifier-run.mjs",
    import.meta.url,
  ).href;
  const { stdout: observed } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
const { assertCleanLinuxHopperRuntime } = await import(${JSON.stringify(observer)});
const { completeVerifierRun } = await import(${JSON.stringify(verifierRun)});
const { process_lineage } = await completeVerifierRun({
  run_id: ${JSON.stringify(runId)}, verifier_pid: process.pid, parent_pid: process.ppid,
});
let refusal;
try { await assertCleanLinuxHopperRuntime(${JSON.stringify(launcherPaths)}, ${JSON.stringify(procRoot)}); }
catch (error) { refusal = error.message; }
console.log(JSON.stringify({ process_lineage, refusal }));
`,
    ],
    { timeout: 10_000 },
  );
  return JSON.parse(observed) as {
    process_lineage: {
      status: string;
      descendants: { pid: number }[];
    };
    refusal?: string;
  };
};

it.runIf(process.platform === "linux").each([
  ["Xvfb-named Node", null, true],
  ["Python helper", [], true],
  ["Python helper with -u", ["-u"], true],
  [
    "Python helper with combined/value options",
    ["-Bu", "-W", "ignore", "-X", "dev", "--check-hash-based-pycs", "always"],
    true,
  ],
  ["Python helper after --", ["--"], true],
  [
    "Python -c script argument",
    ["-c", "import time; print('ready', flush=True); time.sleep(30)"],
    false,
  ],
  ["Python -m script argument", ["-m", "unrelated"], false],
  ["alternate launcher", null, true],
] as const)(
  "classifies a reparented %s without signaling it",
  async (mode, pythonOptions, retained) => {
    const runId = randomUUID();
    const directory = await createTestTempDirectory("rea-clean-runtime-test-");
    const procRoot = join(directory, "proc");
    await mkdir(procRoot);
    const launcher = join(directory, "Hopper");
    const alternate = join(directory, "Hopper-alternate");
    const helper = join(directory, "hopper-demo-x11.py");
    const alternateMode = mode === "alternate launcher";
    const pythonMode = pythonOptions !== null;
    const childCode = retainedRuntimeNodeCode(
      alternateMode ? undefined : "Xvfb",
    );
    if (alternateMode) await prepareRenamedNodeLauncher(launcher, alternate);
    if (pythonMode) {
      await writeFile(
        helper,
        "import time\nprint('ready', flush=True)\ntime.sleep(30)\n",
      );
      await copyFile(helper, join(directory, "unrelated.py"));
    }
    // The fixture must be the cause of a refusal; a retained host runtime
    // would otherwise mask a broken classification or executable-identity check.
    await assertCleanLinuxHopperRuntime(
      alternateMode ? [launcher] : [],
      procRoot,
    );
    const command = alternateMode
      ? alternate
      : pythonMode
        ? "/usr/bin/python3"
        : process.execPath;
    const arguments_ = pythonMode
      ? [...pythonOptions, helper]
      : ["-e", childCode];
    const stdio = pythonMode
      ? ["ignore", "pipe", "ignore"]
      : ["ignore", "ignore", "ignore", "ipc"];
    const parentCode = `
      const { spawn } = require('node:child_process');
      const child = spawn(${JSON.stringify(command)}, ${JSON.stringify(arguments_)}, {
        detached: true, stdio: ${JSON.stringify(stdio)}, cwd: ${JSON.stringify(directory)}
      });
      child.once('error', () => process.exit(1));
      const ready = () => {
        process.stdout.write(JSON.stringify({ pid: child.pid, parentPid: process.pid }));
        if (child.connected) child.disconnect();
        child.stdout?.destroy();
        child.unref();
      };
      ${pythonMode ? "require('node:readline').createInterface({ input: child.stdout }).once('line', ready);" : "child.once('message', ready);"}
    `;
    const { reaper, ready } = launchReapedOrphan(runId, parentCode);
    let orphanPid: number | undefined;
    try {
      const { pid, parentPid } = await ready;
      orphanPid = pid;
      const procEntry = join(procRoot, String(pid));
      await mkdir(procEntry);
      for (const name of ["cmdline", "comm", "exe"])
        await symlink(`/proc/${String(pid)}/${name}`, join(procEntry, name));
      const { stdout: coordinates } = await execFileAsync("ps", [
        "-p",
        String(pid),
        "-o",
        "ppid=,pgid=",
      ]);
      const [currentParent, group] = coordinates
        .trim()
        .split(/\s+/u)
        .map(Number);
      expect(currentParent).not.toBe(parentPid);
      expect(currentParent).toBe(reaper.child.pid);
      expect(group).toBe(pid);

      if (alternateMode) {
        const commandLine = await readFile(
          `/proc/${String(pid)}/cmdline`,
          "utf8",
        );
        expect(commandLine.split("\0")[0]).toBe(alternate);
        await unlink(alternate);
      }
      if (pythonMode) {
        const commandLine = await readFile(
          `/proc/${String(pid)}/cmdline`,
          "utf8",
        );
        expect(
          commandLine.split("\0").slice(0, pythonOptions.length + 2),
        ).toEqual([command, ...pythonOptions, helper]);
      }
      const { process_lineage: lineage, refusal } =
        await observeFromSeparateVerifier(
          runId,
          alternateMode ? [launcher] : [],
          procRoot,
        );
      expect(lineage.status).toBe("verified");
      expect(lineage.descendants.some((p) => p.pid === pid)).toBe(false);
      if (retained)
        expect(refusal).toBe(
          "Clean Linux runner retained a Hopper demo process",
        );
      else expect(refusal).toBeUndefined();
      // Observation must not terminate the fixture, even though it resembles Xvfb.
      const { stdout: alive } = await execFileAsync("ps", [
        "-p",
        String(pid),
        "-o",
        "stat=",
      ]);
      expect(alive.trim()).not.toMatch(/^Z/u);
    } finally {
      try {
        if (orphanPid !== undefined) {
          const cleanup = await cleanupOwnedProcessGroup({
            runId,
            leaderPid: orphanPid,
            processGroupId: orphanPid,
          });
          expect(cleanup.cleaned, JSON.stringify(cleanup)).toBe(true);
        }
      } finally {
        reaper.child.stdin?.end("reap");
        await reaper;
        if (orphanPid !== undefined)
          await expect(
            readFile(`/proc/${String(orphanPid)}/stat`, "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" });
      }
    }
  },
);
