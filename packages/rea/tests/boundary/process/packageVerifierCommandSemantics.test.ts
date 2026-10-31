import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it } from "vitest";
import { z } from "zod";

import { createPackageVerifierCommands } from "../../../scripts/lib/verify-package-commands.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { systemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { liveProcesses } from "../../../src/process/ProcessOwnershipProcessTree.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";

const observed = <Value>(promise: Promise<Value>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (cause: unknown) => ({ ok: false as const, cause }),
  );

const commandFixture = async (
  beforeWorkspaceClose?: (path: string) => void | Promise<void>,
) => {
  const parent = await createTestTempDirectory(
    "rea-package-command-semantics-",
  );
  const path = join(parent, "workspace");
  await mkdir(path);
  let closeCalls = 0;
  const workspace = {
    path,
    async close() {
      closeCalls += 1;
      await beforeWorkspaceClose?.(path);
      await rm(path, { recursive: true, force: true });
    },
  };
  const commands = await createPackageVerifierCommands({ workspace });
  return { parent, workspace, commands, closeCalls: () => closeCalls };
};

it("admits complete stdout and stderr independently of their combined size", async () => {
  const fixture = await commandFixture();
  let output;
  try {
    output = await fixture.commands.exec(
      process.execPath,
      [
        "-e",
        'process.stdout.write("o".repeat(48)); process.stderr.write("e".repeat(48));',
      ],
      { maxBuffer: 64 },
    );
  } finally {
    await fixture.commands.close();
  }

  expect(output).toEqual({ stdout: "o".repeat(48), stderr: "e".repeat(48) });
  expect(existsSync(fixture.workspace.path)).toBe(false);
  expect(fixture.closeCalls()).toBe(1);
});

it("enforces an explicit aggregate diagnostic budget across both streams", async () => {
  const fixture = await commandFixture();
  let outcome;
  try {
    outcome = await observed(
      fixture.commands.exec(
        process.execPath,
        [
          "-e",
          'process.stdout.write("o".repeat(48)); process.stderr.write("e".repeat(48));',
        ],
        { diagnosticBytes: 64 },
      ),
    );
  } finally {
    await fixture.commands.close();
  }

  expect(outcome).toEqual({
    ok: false,
    cause: expect.objectContaining({ reason: "output-limit" }),
  });
  expect(existsSync(fixture.workspace.path)).toBe(false);
  expect(fixture.closeCalls()).toBe(1);
});

it("rejects either overflowing stream even when the command exits with status one", async () => {
  const fixture = await commandFixture();
  const outcomes = [];
  try {
    for (const stream of ["stdout", "stderr"] as const)
      outcomes.push(
        await observed(
          fixture.commands.runWithStatus(process.execPath, [
            "-e",
            `process.${stream}.write("x".repeat(1024 * 1024 + 1)); process.exitCode = 1;`,
          ]),
        ),
      );
  } finally {
    await fixture.commands.close();
  }

  expect(outcomes).toEqual([
    { ok: false, cause: expect.objectContaining({ reason: "output-limit" }) },
    { ok: false, cause: expect.objectContaining({ reason: "output-limit" }) },
  ]);
  expect(existsSync(fixture.workspace.path)).toBe(false);
});

it("returns exact stdout for clean exit one and rejects exit two", async () => {
  const fixture = await commandFixture();
  let first;
  let second;
  try {
    first = await fixture.commands.runWithStatus(process.execPath, [
      "-e",
      'process.stdout.write("selected stdout\\n  "); process.stderr.write("exit one diagnostics"); process.exitCode = 1;',
    ]);
    second = await observed(
      fixture.commands.runWithStatus(process.execPath, [
        "-e",
        'process.stdout.write("exit two stdout"); process.stderr.write("exit two diagnostics"); process.exitCode = 2;',
      ]),
    );
  } finally {
    await fixture.commands.close();
  }

  expect(first).toEqual({ stdout: "selected stdout\n  ", status: 1 });
  expect(second).toEqual({
    ok: false,
    cause: expect.objectContaining({
      name: "VerifierCommandExitError",
      code: 2,
      snapshot: expect.objectContaining({
        stdout: expect.objectContaining({ text: "exit two stdout" }),
        stderr: expect.objectContaining({ text: "exit two diagnostics" }),
      }),
    }),
  });
});

it.skipIf(process.platform === "win32")(
  "rejects a signal exit instead of reporting status one",
  async () => {
    const fixture = await commandFixture();
    let outcome;
    try {
      outcome = await observed(
        fixture.commands.runWithStatus(process.execPath, [
          "-e",
          'process.kill(process.pid, "SIGTERM");',
        ]),
      );
    } finally {
      await fixture.commands.close();
    }

    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({
        reason: "process",
        snapshot: expect.objectContaining({ signal: "SIGTERM" }),
      }),
    });
  },
);

it("uses the exact selected environment and npm entry without rewriting arguments", async () => {
  const fixture = await commandFixture();
  const entry = join(fixture.parent, "selected npm entry.mjs");
  const sentinel = "REA_PACKAGE_COMMAND_AMBIENT_SENTINEL";
  const previous = process.env[sentinel];
  const source = `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), selected: process.env.REA_PACKAGE_COMMAND_SELECTED, ambient: process.env.${sentinel} ?? null }));`;
  await writeFile(entry, source);
  const arguments_ = [
    "pack",
    "value with spaces",
    "--literal=$HOME",
    "quote'and\"double",
  ];
  const environment = {
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
    REA_PACKAGE_COMMAND_SELECTED: "caller-selected",
    npm_execpath: entry,
  };
  let direct;
  let npm;
  process.env[sentinel] = "ambient-only";
  try {
    direct = await fixture.commands.exec(process.execPath, ["-e", source], {
      cwd: fixture.workspace.path,
      env: environment,
    });
    npm = await fixture.commands.execNpm(arguments_, {
      cwd: fixture.workspace.path,
      env: environment,
    });
  } finally {
    if (previous === undefined) delete process.env[sentinel];
    else process.env[sentinel] = previous;
    await fixture.commands.close();
  }

  expect(JSON.parse(direct!.stdout)).toEqual({
    args: [],
    cwd: fixture.workspace.path,
    selected: "caller-selected",
    ambient: null,
  });
  expect(JSON.parse(npm!.stdout)).toEqual({
    args: arguments_,
    cwd: fixture.workspace.path,
    selected: "caller-selected",
    ambient: null,
  });
  expect(direct?.stderr).toBe("");
  expect(npm?.stderr).toBe("");
});

it("allows delayed commands with omitted and explicit zero timeouts", async () => {
  const fixture = await commandFixture();
  const outputs = [];
  try {
    for (const options of [{}, { timeout: 0 }])
      outputs.push(
        await fixture.commands.exec(
          process.execPath,
          ["-e", 'setTimeout(() => process.stdout.write("delayed\\n"), 75);'],
          options,
        ),
      );
  } finally {
    await fixture.commands.close();
  }

  expect(outputs).toEqual([
    { stdout: "delayed\n", stderr: "" },
    { stdout: "delayed\n", stderr: "" },
  ]);
});

const waitForMarker = async (path: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline)
      throw new Error("Authored command did not become ready");
    await delay(10);
  }
};

it.skipIf(process.platform === "win32")(
  "shares concurrent close and joins the active command before removing its workspace",
  async () => {
    let acknowledgedPid: number | undefined;
    let liveAtWorkspaceClose: readonly number[] | undefined;
    let rootExistsAtCensus = false;
    const fixture = await commandFixture(async (path) => {
      rootExistsAtCensus = existsSync(path);
      liveAtWorkspaceClose = liveProcesses(
        await systemProcessOwnershipHost.listProcesses(),
      )
        .filter(({ pid }) => pid === acknowledgedPid)
        .map(({ pid }) => pid);
    });
    const ready = join(fixture.parent, "ready");
    const source = `
require("node:fs").writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid }));
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 10000);
`;
    const running = observed(
      fixture.commands.exec(process.execPath, ["-e", source]),
    );
    let sameClose = false;
    let outcome;
    try {
      await waitForMarker(ready);
      ({ pid: acknowledgedPid } = z
        .object({ pid: z.number().int().positive() })
        .parse(JSON.parse(await readFile(ready, "utf8"))));
      const first = fixture.commands.close();
      const second = fixture.commands.close();
      sameClose = first === second;
      await Promise.all([first, second]);
      outcome = await running;
    } finally {
      await fixture.commands.close();
      await running;
    }
    expect(sameClose).toBe(true);
    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({ reason: "cancelled" }),
    });
    expect(acknowledgedPid).toBeGreaterThan(0);
    expect(liveAtWorkspaceClose).toEqual([]);
    expect(rootExistsAtCensus).toBe(true);
    expect(existsSync(fixture.workspace.path)).toBe(false);
    expect(fixture.closeCalls()).toBe(1);
  },
);

it("retains the same adopted capability and workspace after failed close, then releases each once", async () => {
  const events: string[] = [];
  const fixture = await commandFixture(() => {
    events.push("workspace");
  });
  const child = join(fixture.workspace.path, "adopted");
  const forbidden = join(fixture.parent, "forbidden-command");
  await mkdir(child);
  const owners: object[] = [];
  let attempts = 0;
  const capability = {
    async close() {
      owners.push(this);
      attempts += 1;
      if (attempts === 1) {
        events.push("adopted-failed");
        throw new Error("retry this exact adopted directory capability");
      }
      await rm(child, { recursive: true, force: true });
      events.push("adopted-released");
    },
  };
  fixture.commands.adopt(capability, child);
  fixture.commands.adopt(capability, child);
  let failure: unknown;
  let retained;
  let blockedBefore;
  let blockedAfter;
  try {
    const closed = await observed(fixture.commands.close());
    if (!closed.ok) failure = closed.cause;
    retained = {
      root: existsSync(fixture.workspace.path),
      child: existsSync(child),
      rootCloseCalls: fixture.closeCalls(),
    };
    const arguments_ = [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(forbidden)}, "unexpected launch");`,
    ];
    blockedBefore = await observed(
      fixture.commands.exec(process.execPath, arguments_, {
        cwd: fixture.parent,
      }),
    );
    await fixture.commands.close();
    blockedAfter = await observed(
      fixture.commands.exec(process.execPath, arguments_, {
        cwd: fixture.parent,
      }),
    );
  } finally {
    await fixture.commands.close();
  }

  expect(failure).toMatchObject({
    name: "PackageVerifierCleanupFailure",
    path: fixture.workspace.path,
  });
  if (
    !(failure instanceof Error) ||
    !("cleanupOwner" in failure) ||
    !("workspace" in failure)
  )
    throw new Error("Expected retained package cleanup authority");
  expect(failure.cleanupOwner).toBe(fixture.commands);
  expect(failure.workspace).toBe(fixture.workspace);
  expect(retained).toEqual({ root: true, child: true, rootCloseCalls: 0 });
  expect(owners).toHaveLength(2);
  expect(owners[0]).toBe(capability);
  expect(owners[1]).toBe(capability);
  expect(events).toEqual(["adopted-failed", "adopted-released", "workspace"]);
  expect(fixture.closeCalls()).toBe(1);
  expect(existsSync(fixture.workspace.path)).toBe(false);
  expect(existsSync(forbidden)).toBe(false);
  for (const outcome of [blockedBefore, blockedAfter])
    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({
        message: "Verifier command owner is closed",
      }),
    });
});

it("rejects a new cleanup owner once workspace release has started", async () => {
  let markReleaseStarted!: () => void;
  const releaseStarted = new Promise<void>((resolve) => {
    markReleaseStarted = resolve;
  });
  let unblockWorkspaceClose!: () => void;
  const allowRelease = new Promise<void>((resolve) => {
    unblockWorkspaceClose = resolve;
  });
  const events: string[] = [];
  const fixture = await commandFixture(async () => {
    events.push("workspace-release-started");
    markReleaseStarted();
    await allowRelease;
    events.push("workspace-close-unblocked");
  });
  // This resource belongs to the caller until adoption succeeds. Keep it
  // outside the verifier workspace so workspace removal cannot conceal a leak.
  const path = join(fixture.parent, "caller-owned-directory");
  await mkdir(path);
  const releases: object[] = [];
  const capability = {
    async close() {
      releases.push(this);
      await rm(path, { recursive: true, force: true });
      events.push("caller-owner-released");
    },
  };
  const closing = observed(fixture.commands.close());
  let rejection: unknown;
  let retained;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(releaseStarted, closing, "workspace release");
    try {
      fixture.commands.adopt(capability, path);
    } catch (cause: unknown) {
      rejection = cause;
    }
    retained = {
      workspace: existsSync(fixture.workspace.path),
      callerResource: existsSync(path),
      callerCloseCalls: releases.length,
    };
  }, [
    () => capability.close(),
    () => unblockWorkspaceClose(),
    async () => {
      const result = await closing;
      if (!result.ok) throw result.cause;
    },
    () => fixture.commands.close(),
  ]);

  expect(rejection).toBeInstanceOf(Error);
  expect(retained).toEqual({
    workspace: true,
    callerResource: true,
    callerCloseCalls: 0,
  });
  expect(releases).toHaveLength(1);
  expect(releases[0]).toBe(capability);
  expect(events).toEqual([
    "workspace-release-started",
    "caller-owner-released",
    "workspace-close-unblocked",
  ]);
  expect(existsSync(path)).toBe(false);
  expect(existsSync(fixture.workspace.path)).toBe(false);
  expect(fixture.closeCalls()).toBe(1);
});
