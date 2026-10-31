import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  runOwnedVerifierTerminal,
  type VerifierTerminalOptions,
  type VerifierTerminalResult,
} from "../../../scripts/lib/owned-verifier-terminal.mjs";
import { createPackageVerifierCommands } from "../../../scripts/lib/verify-package-commands.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import type { VerifierCleanupOwner } from "../../../scripts/lib/verifier-command-owner.mjs";
import {
  cleanupOwnedProcessGroup,
  type PersistentOwnedProcessGroup,
  type ProcessCleanupFailure,
} from "../../../src/process/ProcessOwnership.js";
import { systemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { liveProcesses } from "../../../src/process/ProcessOwnershipProcessTree.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";

type Outcome<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly cause: unknown };

const observed = <Value>(promise: Promise<Value>): Promise<Outcome<Value>> =>
  promise.then(
    (value) => ({ ok: true, value }),
    (cause: unknown) => ({ ok: false, cause }),
  );

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

const waitForBoundary = (
  boundary: Promise<void>,
  running: Promise<Outcome<unknown>>,
) => awaitAcknowledgement(boundary, running, "terminal lifecycle", 5_000);

const terminalFixture = async () => {
  const parent = await createTestTempDirectory("rea-verifier-terminal-");
  const path = join(parent, "workspace");
  await mkdir(path);
  const pids = new Set<number>();
  const censuses: number[][] = [];
  const rootsAtRemoval: boolean[] = [];
  let rootCloses = 0;
  const commands = await createPackageVerifierCommands({
    workspace: {
      path,
      async close() {
        rootCloses += 1;
        rootsAtRemoval.push(existsSync(path));
        censuses.push(
          liveProcesses(await systemProcessOwnershipHost.listProcesses())
            .filter(({ pid }) => pids.has(pid))
            .map(({ pid }) => pid),
        );
        await rm(path, { recursive: true, force: true });
      },
    },
  });
  const adopted: VerifierCleanupOwner[] = [];
  const options: Omit<VerifierTerminalOptions, "args"> = {
    commands: {
      adopt(owner, resource) {
        adopted.push(owner);
        commands.adopt(owner, resource);
      },
    },
    command: process.execPath,
    cwd: path,
    environment: {
      TERM: "xterm-256color",
      REA_TERMINAL_SELECTED: "caller-selected",
    },
    timeoutMs: 2_000,
  };
  const cleanup: typeof cleanupOwnedProcessGroup = async (ownership, host) => {
    pids.add(ownership.leaderPid);
    return cleanupOwnedProcessGroup(ownership, host);
  };
  return {
    path,
    parent,
    commands,
    adopted,
    options,
    cleanup,
    pids,
    censuses,
    rootsAtRemoval,
    rootCloses: () => rootCloses,
  };
};

const expectReleased = (
  fixture: Awaited<ReturnType<typeof terminalFixture>>,
) => {
  expect(existsSync(fixture.path)).toBe(false);
  expect(fixture.rootCloses()).toBe(1);
  expect(fixture.censuses).toEqual([[]]);
  expect(fixture.rootsAtRemoval).toEqual([true]);
};

const observeClose = (owner: VerifierCleanupOwner) => {
  const entered = deferred();
  const original = owner.close;
  const spy = vi.spyOn(owner, "close").mockImplementation(function (
    this: VerifierCleanupOwner,
  ) {
    const closing = original.call(this);
    entered.resolve();
    return closing;
  });
  return { entered: entered.promise, restore: () => spy.mockRestore() };
};

const posix = it.skipIf(process.platform === "win32");

posix(
  "merges real PTY streams and preserves selected argv, environment and the write capability",
  async () => {
    const fixture = await terminalFixture();
    const ambient = "REA_TERMINAL_AMBIENT_SENTINEL";
    const previous = process.env[ambient];
    process.env[ambient] = "ambient-only";
    const args = ["value with spaces", "--literal=$HOME", "quote'and\"double"];
    const source = `
process.stdin.setEncoding("utf8");
process.stdin.once("data", input => process.stdout.write("__REPLY__" + JSON.stringify(input.trim()) + "\\n", () => process.exit(0)));
process.stdout.write("__FACTS__" + JSON.stringify({ args: process.argv.slice(1), selected: process.env.REA_TERMINAL_SELECTED, ambient: process.env.${ambient} ?? null }) + "\\n");
process.stderr.write("__STDERR__\\n");
process.stdout.write("__PROMPT__\\n");
setTimeout(() => process.exit(91), 5000);
`;
    let wrote = false;
    let result: VerifierTerminalResult | undefined;
    try {
      result = await runOwnedVerifierTerminal(
        {
          ...fixture.options,
          args: ["-e", source, "--", ...args],
          onData(output, write) {
            if (!wrote && output.includes("__PROMPT__")) {
              wrote = true;
              write("authored reply\n");
            }
          },
        },
        { cleanupProcessGroup: fixture.cleanup },
      );
    } finally {
      if (previous === undefined) delete process.env[ambient];
      else process.env[ambient] = previous;
      await fixture.commands.close();
    }
    const facts = result?.output
      .split(/\r?\n/u)
      .find((line) => line.startsWith("__FACTS__"));

    expect(result?.exitCode).toBe(0);
    expect(wrote).toBe(true);
    expect(JSON.parse(facts?.slice("__FACTS__".length) ?? "null")).toEqual({
      args,
      selected: "caller-selected",
      ambient: null,
    });
    expect(result?.output).toContain("__STDERR__");
    expect(result?.output).toContain('__REPLY__"authored reply"');
    expect(fixture.adopted).toHaveLength(1);
    expectReleased(fixture);
  },
);

posix(
  "cancels an acknowledged active terminal and joins it before workspace removal",
  async () => {
    const fixture = await terminalFixture();
    const ready = deferred();
    const source =
      'process.stdout.write("__PID__" + process.pid + "\\n"); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 10000);';
    const running = observed(
      runOwnedVerifierTerminal(
        {
          ...fixture.options,
          args: ["-e", source],
          onData(output) {
            const match = /__PID__(\d+)\r?\n/u.exec(output);
            if (match !== null) {
              fixture.pids.add(Number(match[1]));
              ready.resolve();
            }
          },
        },
        { cleanupProcessGroup: fixture.cleanup },
      ),
    );
    let outcome: Outcome<VerifierTerminalResult> | undefined;
    try {
      await waitForBoundary(ready.promise, running);
      await fixture.commands.close();
      outcome = await running;
    } finally {
      await fixture.commands.close();
      await running;
    }

    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({ reason: "cancelled" }),
    });
    expect(fixture.pids.size).toBe(1);
    expect(fixture.adopted).toHaveLength(1);
    expectReleased(fixture);
  },
);

const heldSource =
  'process.stdout.write("callback-ready"); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 10000);';

posix.each(["timeout", "output_limit", "undefined_callback"] as const)(
  "retains the exact terminal cleanup owner and primary %s failure through a denied release",
  async (mode) => {
    const fixture = await terminalFixture();
    let deny = true;
    const ownerships: PersistentOwnedProcessGroup[] = [];
    const denials: ProcessCleanupFailure[] = [];
    const cleanup: typeof cleanupOwnedProcessGroup = async (ownership) => {
      if (ownership.sweepTokenOwnedProcesses !== true)
        throw new Error("Expected persistent token-swept terminal ownership");
      ownerships.push(ownership);
      fixture.pids.add(ownership.leaderPid);
      if (!deny) return fixture.cleanup(ownership);
      const denial: ProcessCleanupFailure = {
        cleaned: false,
        reason: "controlled cleanup verification denial",
        unverified: [
          {
            pid: ownership.leaderPid,
            diagnostic: "authored cleanup remains unverified",
          },
        ],
      };
      denials.push(denial);
      return denial;
    };
    let terminal: Outcome<VerifierTerminalResult> | undefined;
    let rootClose: Outcome<void> | undefined;
    let retained;
    try {
      terminal = await observed(
        runOwnedVerifierTerminal(
          {
            ...fixture.options,
            timeoutMs: mode === "timeout" ? 250 : 2_000,
            maxOutputBytes: mode === "output_limit" ? 5 : 1024,
            args: [
              "-e",
              mode === "output_limit"
                ? 'process.stdout.write("é🙂Z"); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 10000);'
                : heldSource,
            ],
            ...(mode === "undefined_callback"
              ? {
                  onData() {
                    throw undefined;
                  },
                }
              : {}),
          },
          { cleanupProcessGroup: cleanup },
        ),
      );
      rootClose = await observed(fixture.commands.close());
      retained = {
        root: existsSync(fixture.path),
        rootCloses: fixture.rootCloses(),
      };
    } finally {
      deny = false;
      await fixture.commands.close();
    }
    const failure = terminal?.ok === false ? terminal.cause : undefined;
    const aggregate = z.object({ errors: z.array(z.unknown()) }).parse(failure);
    const cleanupFailure = z
      .object({
        cleanupOwner: z.unknown(),
        cause: z.unknown(),
        output: z.string(),
      })
      .parse(aggregate.errors[1]);
    const rootFailure = rootClose?.ok === false ? rootClose.cause : undefined;

    if (mode === "undefined_callback") {
      expect(aggregate.errors[0]).toBeUndefined();
      expect(failure).toHaveProperty("cause", undefined);
    } else {
      expect(aggregate.errors[0]).toMatchObject({ reason: mode });
      if (mode === "output_limit") {
        expect(aggregate.errors[0]).toMatchObject({ output: "é" });
        expect(cleanupFailure.output).toBe("é");
      }
    }
    expect(aggregate.errors).toHaveLength(2);
    expect(fixture.adopted).toHaveLength(1);
    expect(cleanupFailure.cleanupOwner).toBe(fixture.adopted[0]);
    expect(cleanupFailure.cause).toBe(denials[0]);
    expect(cleanupFailure.cause).toMatchObject({
      cleaned: false,
      unverified: [{ diagnostic: "authored cleanup remains unverified" }],
    });
    expect(
      z.object({ cleanupOwner: z.unknown() }).parse(rootFailure).cleanupOwner,
    ).toBe(fixture.commands);
    expect(retained).toEqual({ root: true, rootCloses: 0 });
    expect(ownerships).toHaveLength(3);
    for (const ownership of ownerships) expect(ownership).toBe(ownerships[0]);
    expectReleased(fixture);
  },
);

posix(
  "selects cancellation while completed-child cleanup is pending and joins that same attempt",
  async () => {
    const fixture = await terminalFixture();
    const cleanupEntered = deferred();
    const allowCleanup = deferred();
    let attempts = 0;
    const running = observed(
      runOwnedVerifierTerminal(
        {
          ...fixture.options,
          args: ["-e", 'process.stdout.write("completed child\\n");'],
        },
        {
          cleanupProcessGroup: async (ownership) => {
            attempts += 1;
            cleanupEntered.resolve();
            await allowCleanup.promise;
            return fixture.cleanup(ownership);
          },
        },
      ),
    );
    let closeObservation: ReturnType<typeof observeClose> | undefined;
    let closing: Promise<Outcome<void>> | undefined;
    let outcome: Outcome<VerifierTerminalResult> | undefined;
    await withVerifierCleanup(async () => {
      await waitForBoundary(cleanupEntered.promise, running);
      const owner = fixture.adopted[0];
      if (owner === undefined) throw new Error("Terminal was not adopted");
      closeObservation = observeClose(owner);
      closing = observed(fixture.commands.close());
      await waitForBoundary(closeObservation.entered, closing);
      allowCleanup.resolve();
      expect(await closing).toEqual({ ok: true, value: undefined });
      outcome = await running;
    }, [
      () => allowCleanup.resolve(),
      () => fixture.commands.close(),
      async () => {
        await running;
      },
      () => closeObservation?.restore(),
    ]);

    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({ reason: "cancelled" }),
    });
    expect(attempts).toBe(1);
    expect(fixture.adopted).toHaveLength(1);
    expectReleased(fixture);
  },
);

posix(
  "joins a delayed native-module load without spawning after cancellation",
  async () => {
    const fixture = await terminalFixture();
    const loadEntered = deferred();
    const allowLoad = deferred();
    let spawns = 0;
    let cleanups = 0;
    const running = observed(
      runOwnedVerifierTerminal(
        {
          ...fixture.options,
          args: ["-e", 'process.stdout.write("must not spawn");'],
        },
        {
          loadPty: async () => {
            const pty = await import("@lydell/node-pty");
            loadEntered.resolve();
            await allowLoad.promise;
            return {
              ...pty,
              spawn(...args: Parameters<typeof pty.spawn>) {
                spawns += 1;
                return pty.spawn(...args);
              },
            };
          },
          cleanupProcessGroup: async (ownership) => {
            cleanups += 1;
            return fixture.cleanup(ownership);
          },
        },
      ),
    );
    let closeObservation: ReturnType<typeof observeClose> | undefined;
    let closing: Promise<Outcome<void>> | undefined;
    let outcome: Outcome<VerifierTerminalResult> | undefined;
    await withVerifierCleanup(async () => {
      await waitForBoundary(loadEntered.promise, running);
      const owner = fixture.adopted[0];
      if (owner === undefined) throw new Error("Terminal was not adopted");
      closeObservation = observeClose(owner);
      closing = observed(fixture.commands.close());
      await waitForBoundary(closeObservation.entered, closing);
      allowLoad.resolve();
      expect(await closing).toEqual({ ok: true, value: undefined });
      outcome = await running;
    }, [
      () => allowLoad.resolve(),
      () => fixture.commands.close(),
      async () => {
        await running;
      },
      () => closeObservation?.restore(),
    ]);

    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({ reason: "cancelled" }),
    });
    expect(spawns).toBe(0);
    expect(cleanups).toBe(0);
    expect(fixture.adopted).toHaveLength(1);
    expectReleased(fixture);
  },
);
