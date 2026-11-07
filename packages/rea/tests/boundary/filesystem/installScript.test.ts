import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { spawn as spawnPty } from "@lydell/node-pty";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execFileAsync = promisify(execFile);

// install.sh:fail_node_version emits this recovery block verbatim. The fake
// `uname` in createFixture reports `x86_64` / `Linux`, so the host labels
// resolve to `linux/x64`.
const UNSUPPORTED_NODE_RECOVERY_LINUX_X64 =
  "REA installation failed: Node.js 20.0.0 is unsupported.\n" +
  "\n" +
  "REA requires Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), or 26.12.1+. Install one via:\n" +
  "  nvm:  nvm install 24 && nvm use 24      (https://github.com/nvm-sh/nvm)\n" +
  "  fnm:  fnm install 24 && fnm use 24      (https://github.com/Schniz/fnm)\n" +
  "  Direct download for linux/x64:\n" +
  "    https://nodejs.org/dist/latest-v24.x/  (grab the linux-x64 tarball)\n" +
  "Then rerun this installer.\n";

describe("installer Node.js admission", { timeout: 20_000 }, () => {
  it.each(["22.23.4", "24.22.1", "26.12.1", "26.13.0", "24.22.1+build.5"])(
    "accepts supported Node %s without installing or replacing it",
    async (version) => {
      const fixture = await createFixture();
      const result = await runInstaller(
        fixture,
        ["--version", "0.3.0", "--dry-run"],
        {
          FAKE_NODE_VERSION: version,
        },
      );
      expect(result.stdout).toContain(`Runtime: Node.js ${version}`);
    },
  );

  it.each([
    "22.19.0",
    "22.23.3",
    "24.11.0",
    "24.22.0",
    "23.0.0",
    "26.0.0",
    "26.12.0",
    "26.12.1-rc.1",
  ])("rejects unsupported Node %s before invoking npm", async (version) => {
    const fixture = await createFixture();
    await expect(
      runInstaller(fixture, ["--version", "0.3.0"], {
        FAKE_NODE_VERSION: version,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(`Node.js ${version} is unsupported`),
    });
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("curl installer scenarios", { timeout: 20_000 }, () => {
  it("installs only a pinned REA CLI with closed stdin", async () => {
    const fixture = await createFixture();
    const result = await runInstaller(fixture, ["--version", "0.3.0"]);
    expect(result.stdout).toContain("REA 0.3.0 is installed");
    expect(result.stdout).toContain("Run ");
    expect(await readFile(fixture.npmLog, "utf8")).toContain(
      "install --global --prefix",
    );
    expect(await readFile(fixture.reaLog, "utf8")).toBe("--version\n");
    expect(await readdir(fixture.temporary)).toEqual([]);
  });

  it("resolves and validates the latest REA release tag", async () => {
    const fixture = await createFixture();
    const result = await runInstaller(fixture);
    expect(result.stdout).toContain("Version: 0.3.0");
  });

  it("prints a dry run without invoking npm", async () => {
    const fixture = await createFixture();
    const result = await runInstaller(fixture, [
      "--version",
      "0.3.0",
      "--dry-run",
    ]);
    expect(result.stdout).toContain("no changes made");
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // Keep each distinct failure route while checking its reason and recovery.
  it.each([
    [
      "unsupported Node",
      ["--version", "0.3.0"],
      { FAKE_NODE_VERSION: "20.0.0" },
      UNSUPPORTED_NODE_RECOVERY_LINUX_X64,
    ],
    [
      "unreadable Node version",
      ["--version", "0.3.0"],
      { FAKE_NODE_VERSION: "invalid" },
      "REA installation failed: the active Node.js version could not be read. Check that node works and is on PATH, then retry.\n",
    ],
    [
      "release lookup",
      [],
      { FAKE_CURL_FAIL: "1" },
      "REA installation failed: the latest REA release could not be resolved. Check network access or pass --version VERSION, then retry.\n",
    ],
    [
      "release response",
      [],
      { FAKE_CURL_BODY: "not-json" },
      "REA installation failed: the release response was invalid. Retry later or pass --version VERSION.\n",
    ],
    [
      "release tag",
      [],
      { FAKE_CURL_BODY: '{"tag_name":"unrelated-1.0.0"}' },
      "REA installation failed: the latest release tag was invalid. Retry later or pass --version VERSION.\n",
    ],
    [
      "npm failure",
      ["--version", "0.3.0"],
      { FAKE_NPM_FAIL: "1" },
      "REA installation failed: npm could not install REA. Check registry access and npm permissions, then retry.\n",
    ],
    [
      "npm prefix",
      ["--version", "0.3.0"],
      { FAKE_PLATFORM: "Darwin", FAKE_NPM_PREFIX_FAIL: "1" },
      "REA installation failed: the npm global prefix could not be read. Repair the npm configuration, then retry.\n",
    ],
    [
      "missing installed command",
      ["--version", "0.3.0"],
      { FAKE_NPM_SKIP_BINARY: "1" },
      "REA installation failed: npm completed without installing the rea command. Check the npm global bin directory and PATH, then retry.\n",
    ],
    [
      "unreadable installed version",
      ["--version", "0.3.0"],
      { FAKE_REA_VERSION_FAIL: "1" },
      "REA installation failed: the installed REA version could not be read. Reinstall the requested version, then retry.\n",
    ],
    [
      "version mismatch",
      ["--version", "0.3.0"],
      { FAKE_REA_VERSION: "9.9.9" },
      "REA installation failed: installed version 9.9.9 does not match 0.3.0. Reinstall the requested version, then retry.\n",
    ],
  ] as const)(
    "fails closed with actionable recovery for %s",
    async (_name, args, overrides, message) => {
      const fixture = await createFixture();
      const failure = await runInstaller(fixture, args, overrides).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(Error);
      const stderr = String((failure as { stderr?: unknown }).stderr ?? "");
      expect(stderr).toBe(message);
      expect(await readdir(fixture.temporary)).toEqual([]);
    },
  );

  it("reports exact recovery when curl is missing", async () => {
    const fixture = await createFixture();
    await rm(join(fixture.bin, "curl"));
    await expect(
      runInstaller(fixture, ["--version", "0.3.0"], {
        PATH: fixture.bin,
      }),
    ).rejects.toMatchObject({
      stderr:
        "REA installation failed: curl is required. Install curl, then rerun this installer.\n",
    });
  });
});

describe("installer reported version", { timeout: 20_000 }, () => {
  it("rejects an empty version from a successful installed command", async () => {
    const fixture = await createFixture();
    await expect(
      runInstaller(fixture, ["--version", "0.3.0"], { FAKE_REA_VERSION: "" }),
    ).rejects.toMatchObject({
      stderr:
        "REA installation failed: the installed REA version could not be read. Reinstall the requested version, then retry.\n",
    });
  });
});

describe("installer TTY fallback", { timeout: 20_000 }, () => {
  it("skips automatic setup when stderr is redirected", async () => {
    const fixture = await createFixture();
    const script = join(process.cwd(), "install.sh");
    const wrapper = `
      const { spawnSync } = require("node:child_process");
      const { openSync, closeSync } = require("node:fs");
      const stderr = openSync(process.argv[2], "w");
      const child = spawnSync("/bin/bash", [process.argv[1], ...process.argv.slice(3)], {
        stdio: ["inherit", "inherit", stderr],
        env: process.env,
      });
      closeSync(stderr);
      process.exit(child.status ?? 1);
    `;
    let output = "";
    const terminal = spawnPty(
      process.execPath,
      ["-e", wrapper, script, fixture.installerStderrLog, "--version", "0.3.0"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...installerEnvironment(fixture),
          TERM: "xterm-256color",
        },
        name: "xterm-256color",
        cols: 120,
        rows: 40,
      },
    );
    let timedOut = false;
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        timedOut = true;
        terminal.kill();
      }, 10_000);
      terminal.onData((data) => {
        output += data;
      });
      terminal.onExit(({ exitCode: code }) => {
        clearTimeout(timeout);
        if (timedOut)
          reject(new Error(`Installer PTY timed out after output: ${output}`));
        else resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(output).toContain(
      `Run ${join(fixture.home, ".local/bin/rea")} setup to configure Hopper and agents.`,
    );
    expect(await readFile(fixture.reaLog, "utf8")).toBe("--version\n");
    expect(await readFile(fixture.installerStderrLog, "utf8")).toBe("");
  });
});

describe("truncated installer download", { timeout: 20_000 }, () => {
  it("runs nothing from a download truncated after the npm install line", async () => {
    const fixture = await createFixture();
    const source = await readFile(join(process.cwd(), "install.sh"), "utf8");
    const installLine = source.indexOf('npm "${install_args[@]}" ||');
    expect(installLine).toBeGreaterThan(0);
    const truncated = join(fixture.home, "..", "install-truncated.sh");
    await writeFile(
      truncated,
      source.slice(0, source.indexOf("\n", installLine) + 1),
    );
    const failure: unknown = await runInstaller(
      fixture,
      ["--version", "0.3.0", "--no-setup"],
      {},
      truncated,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(getProcessOutput(failure, "stdout")).toBe("");
    expect(getProcessOutput(failure, "stderr")).toContain("syntax error");
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe(
  "installer download truncated at any byte",
  {
    timeout: 180_000,
  },
  () => {
    // Every prefix of the script, from the empty download to the full file, as
    // `curl ... | bash -s -- --dry-run` would see it. Covers the preamble (a
    // cut right after `set` would print every shell variable), the body, and
    // the final invocation (a cut right after `main` would drop the flags).
    it("runs nothing and prints nothing until the closing brace arrives", async () => {
      const source = await readFile(join(process.cwd(), "install.sh"));
      expect(source.subarray(0, 14).toString()).toBe("#!/bin/bash\n{\n");
      const groupOpen = source.indexOf("\n{\n") + 2;
      const groupEnd = source.lastIndexOf("\n}\n") + 2;
      expect(groupEnd).toBe(source.length - 1);
      expect(source.subarray(groupOpen, groupEnd).toString()).toContain(
        "set -euo pipefail",
      );
      const fixture = await createFixture();
      const offsets = Array.from(
        { length: source.length + 1 },
        (_, offset) => offset,
      );
      const failures: string[] = [];
      const check = async (offset: number): Promise<void> => {
        const result = await runPipedInstaller(
          fixture,
          source.subarray(0, offset),
          ["--dry-run"],
          { SECRET_TOKEN: "inherited-secret" },
        );
        const context = `truncated at byte ${offset} after ${JSON.stringify(
          source.subarray(Math.max(0, offset - 24), offset).toString(),
        )}`;
        if (offset >= groupEnd) {
          if (result.code !== 0 || !result.stdout.includes("no changes made"))
            failures.push(`${context}: complete script did not dry-run`);
          return;
        }
        if (result.stdout !== "")
          failures.push(`${context}: stdout ${JSON.stringify(result.stdout)}`);
        if (offset >= groupOpen) {
          if (result.code === 0) failures.push(`${context}: exit code 0`);
          if (!/syntax error|unexpected EOF/u.test(result.stderr))
            failures.push(
              `${context}: stderr ${JSON.stringify(result.stderr)}`,
            );
        } else if (result.code !== 0 || result.stderr !== "")
          failures.push(`${context}: preamble did not exit quietly`);
      };
      for (let index = 0; index < offsets.length; index += 16)
        await Promise.all(offsets.slice(index, index + 16).map(check));
      expect(failures).toEqual([]);
      await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(fixture.reaLog, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  },
);

describe("Linux user-prefix installer", { timeout: 20_000 }, () => {
  it("prints the executed arguments as a reusable command with shell metacharacters", async () => {
    const fixture = await createFixture();
    const home = join(fixture.home, "home with 'quotes' $cash; [glob]");
    const argvLog = join(fixture.home, "npm-argv.log");
    const overrides = { HOME: home, FAKE_NPM_ARGV_LOG: argvLog };
    const plan = await runInstaller(
      fixture,
      ["--version", "0.3.0", "--dry-run"],
      overrides,
    );
    await expect(readFile(argvLog)).rejects.toMatchObject({ code: "ENOENT" });
    const command = /^  Command: (.+)$/mu.exec(plan.stdout)?.[1];
    expect(command).toBeDefined();
    const printed = await execFileAsync("/bin/bash", [
      "-c",
      `npm() { printf '%s\\0' "$@"; }\n${command}`,
    ]);
    const installed = await runInstaller(
      fixture,
      ["--version", "0.3.0"],
      overrides,
    );
    expect(installed.stdout).toContain(`  Command: ${command}\n`);
    expect(printed.stdout.split("\0")).toEqual([
      "install",
      "--global",
      "--prefix",
      join(home, ".local"),
      "rea-agents@0.3.0",
      "",
    ]);
    expect((await readFile(argvLog)).toString()).toBe(printed.stdout);
  });
});

describe("native macOS installer", { timeout: 20_000 }, () => {
  it("installs on Darwin with an empty prefix argument array", async () => {
    const fixture = await createFixture();
    const result = await runInstaller(fixture, ["--version", "0.3.0"], {
      FAKE_PLATFORM: "Darwin",
      FAKE_NPM_PREFIX: join(fixture.home, "npm global prefix"),
    });
    expect(result.stdout).toContain(
      "  Command: npm install --global rea-agents@0.3.0\n",
    );
    expect(result.stdout).toContain("REA 0.3.0 is installed");
    expect(await readFile(fixture.npmLog, "utf8")).toBe(
      "prefix --global\ninstall --global rea-agents@0.3.0\n",
    );
    expect(await readFile(fixture.reaLog, "utf8")).toBe("--version\n");
    expect(await readdir(fixture.temporary)).toEqual([]);
  });
});

describe("installer semantic version parsing", { timeout: 20_000 }, () => {
  it("rejects an explicitly empty version instead of selecting latest", async () => {
    const fixture = await createFixture();
    await expect(
      runInstaller(fixture, ["--version", "", "--dry-run"]),
    ).rejects.toMatchObject({
      stdout: "",
      stderr:
        "REA installation failed: version must be an exact semantic version.\n",
    });
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    "1.2.3-01",
    "1.2.3-$(printf unexpected)",
    '1.2.3-"; printf unexpected; #',
  ])(
    "rejects malformed semantic versions before invoking npm: %s",
    async (version) => {
      const fixture = await createFixture();
      await expect(
        runInstaller(fixture, ["--version", version, "--dry-run"]),
      ).rejects.toMatchObject({
        stdout: "",
        stderr:
          "REA installation failed: version must be an exact semantic version.\n",
      });
      await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("rejects valid build metadata before printing a plan or invoking npm", async () => {
    const fixture = await createFixture();
    const failure = await runInstaller(fixture, [
      "--version",
      "1.2.3+build.01",
      "--dry-run",
    ]).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    const stderr = getProcessOutput(failure, "stderr");
    expect(stderr).toBe(
      "REA installation failed: npm cannot install an exact version with build metadata. Pass a version without build metadata, then retry.\n",
    );
    expect(getProcessOutput(failure, "stdout")).not.toContain(
      "REA install plan",
    );
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("accepts a valid prerelease version without build metadata", async () => {
    const fixture = await createFixture();
    const result = await runInstaller(fixture, [
      "--version",
      "1.2.3-alpha.0",
      "--dry-run",
    ]);
    expect(result.stdout).toContain("Version: 1.2.3-alpha.0");
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects build metadata in the latest release tag before printing a plan", async () => {
    const fixture = await createFixture();
    const failure = await runInstaller(fixture, [], {
      FAKE_CURL_BODY: '{"tag_name":"rea-agents-1.2.3+build.01"}',
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(getProcessOutput(failure, "stderr")).toBe(
      "REA installation failed: npm cannot install an exact version with build metadata. Pass a version without build metadata, then retry.\n",
    );
    expect(getProcessOutput(failure, "stdout")).not.toContain(
      "REA install plan",
    );
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects an invalid semantic version from the latest release tag", async () => {
    const fixture = await createFixture();
    await expect(
      runInstaller(fixture, [], {
        FAKE_CURL_BODY: '{"tag_name":"rea-agents-1.2.3-01"}',
      }),
    ).rejects.toMatchObject({
      stderr:
        "REA installation failed: the latest release tag was invalid. Retry later or pass --version VERSION.\n",
    });
    await expect(readFile(fixture.npmLog, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

interface InstallerFixture {
  readonly home: string;
  readonly bin: string;
  readonly temporary: string;
  readonly npmLog: string;
  readonly reaLog: string;
  readonly installerStderrLog: string;
}

const getProcessOutput = (
  failure: unknown,
  stream: "stdout" | "stderr",
): string => {
  if (!(failure instanceof Error)) return "";
  if (stream === "stdout" && "stdout" in failure) {
    return typeof failure.stdout === "string" ? failure.stdout : "";
  }
  if (stream === "stderr" && "stderr" in failure) {
    return typeof failure.stderr === "string" ? failure.stderr : "";
  }
  return "";
};

const createFixture = async (): Promise<InstallerFixture> => {
  const root = await createTestTempDirectory("rea-install-test-");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const temporary = join(root, "tmp");
  const npmLog = join(root, "npm.log");
  const reaLog = join(root, "rea.log");
  const installerStderrLog = join(root, "installer.stderr.log");
  await Promise.all([mkdir(home), mkdir(bin), mkdir(temporary)]);
  await Promise.all([
    executable(
      join(bin, "uname"),
      '#!/bin/sh\n[ "$1" = "-m" ] && echo x86_64 || printf \'%s\\n\' "${FAKE_PLATFORM:-Linux}"\n',
    ),
    executable(
      join(bin, "node"),
      `#!/bin/sh
if [ "$1" = "-p" ]; then printf '%s\n' "\${FAKE_NODE_VERSION:-24.22.1}"; else exec ${shellQuote(process.execPath)} "$@"; fi
`,
    ),
    executable(
      join(bin, "npm"),
      `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_NPM_LOG"
if [ -n "\${FAKE_NPM_ARGV_LOG:-}" ]; then printf '%s\\0' "$@" > "$FAKE_NPM_ARGV_LOG"; fi
[ "$1" = "prefix" ] && { [ "\${FAKE_NPM_PREFIX_FAIL:-}" = "1" ] && exit 1; printf '%s\n' "$FAKE_NPM_PREFIX"; exit 0; }
[ "\${FAKE_NPM_FAIL:-}" = "1" ] && exit 1
prefix="$HOME/.local"
[ "\${FAKE_PLATFORM:-Linux}" = "Darwin" ] && prefix="$FAKE_NPM_PREFIX"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then shift; prefix="$1"; fi
  shift
done
[ "\${FAKE_NPM_SKIP_BINARY:-}" = "1" ] && exit 0
mkdir -p "$prefix/bin"
cp "$FAKE_REA_SOURCE" "$prefix/bin/rea"
chmod +x "$prefix/bin/rea"
`,
    ),
    executable(
      join(bin, "curl"),
      `#!/bin/sh
[ "\${FAKE_CURL_FAIL:-}" = "1" ] && exit 1
if [ -n "\${FAKE_CURL_BODY:-}" ]; then printf '%s' "$FAKE_CURL_BODY"; else printf '%s' '{"tag_name":"rea-agents-0.3.0"}'; fi
`,
    ),
    executable(
      join(bin, "rea-source"),
      `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_REA_LOG"
[ "\${FAKE_REA_VERSION_FAIL:-}" = "1" ] && exit 1
[ "$1" = "--version" ] && printf '%s\n' "\${FAKE_REA_VERSION-0.3.0}"
exit 0
`,
    ),
    ...["chmod", "cp", "mkdir", "tr"].map((command) =>
      symlink(`/usr/bin/${command}`, join(bin, command)),
    ),
  ]);
  return { home, bin, temporary, npmLog, reaLog, installerStderrLog };
};

const executable = async (path: string, source: string): Promise<void> => {
  await writeFile(path, source);
  await chmod(path, 0o755);
};

/** Fixture-owned installer environment shared by the exec, pipe and PTY runs. */
const installerEnvironment = (
  fixture: InstallerFixture,
): Record<string, string> => ({
  HOME: fixture.home,
  TMPDIR: fixture.temporary,
  PATH: `${fixture.bin}:/usr/bin:/bin`,
  FAKE_NPM_LOG: fixture.npmLog,
  FAKE_REA_LOG: fixture.reaLog,
  FAKE_REA_SOURCE: join(fixture.bin, "rea-source"),
  FAKE_NPM_PREFIX: join(fixture.home, ".npm-global"),
});

const runInstaller = async (
  fixture: InstallerFixture,
  args: readonly string[] = [],
  overrides: Readonly<Record<string, string>> = {},
  script = join(process.cwd(), "install.sh"),
): Promise<{ readonly stdout: string; readonly stderr: string }> =>
  execFileAsync("/bin/bash", [script, ...args], {
    env: {
      ...process.env,
      ...installerEnvironment(fixture),
      ...overrides,
    },
  });

/**
 * Run the installer as `curl ... | bash -s -- ARGS` does: source on stdin.
 * The environment is minimal and does not inherit the test runner's.
 */
const runPipedInstaller = async (
  fixture: InstallerFixture,
  source: Uint8Array,
  args: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> =>
  new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-s", "--", ...args], {
      env: {
        ...installerEnvironment(fixture),
        ...overrides,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(source);
  });

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;
