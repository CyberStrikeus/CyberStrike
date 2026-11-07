import { existsSync } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { createVerifierCommands } from "../../../scripts/lib/verify-commands.mjs";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { systemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { liveProcesses } from "../../../src/process/ProcessOwnershipProcessTree.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const observed = <Value>(promise: Promise<Value>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (cause: unknown) => ({ ok: false as const, cause }),
  );

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

it("rejects unsupported stdin before acquiring a launcher", async () => {
  const directory = await createTestTempDirectory("rea-verifier-stdin-");
  const forbidden = join(directory, "forbidden launch");
  let acquisitions = 0;
  const commands = await createVerifierCommands({
    launcher(input) {
      acquisitions += 1;
      return spawnOwnedProviderProcess(input);
    },
  });
  let outcome;
  try {
    outcome = await observed(
      commands.exec(
        process.execPath,
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(forbidden)}, "unexpected launch");`,
        ],
        {
          cwd: directory,
          // @ts-expect-error An untyped caller supplied an unsupported stdin mode.
          stdin: "ignore",
        },
      ),
    );
  } finally {
    await commands.close();
  }

  expect(outcome).toEqual({ ok: false, cause: expect.any(TypeError) });
  expect(acquisitions).toBe(0);
  expect(commands.cleanupResources).toEqual([]);
  expect(existsSync(forbidden)).toBe(false);
  expect(existsSync(directory)).toBe(true);
});

it.skipIf(process.platform === "win32")(
  "delivers EOF through a physical stdin pipe while preserving caller inputs and artifact bytes",
  async () => {
    const directory = await createTestTempDirectory("rea-verifier-command-");
    const artifact = join(directory, "retained evidence.bin");
    const bytes = Buffer.from([0, 255, 10, 13, 65]);
    const arguments_ = [
      artifact,
      "value with spaces",
      "--literal=$HOME",
      "quote'and\"double",
    ];
    const sentinel = "REA_VERIFIER_AMBIENT_SENTINEL";
    const previous = process.env[sentinel];
    const source = `
const fs = require("node:fs");
const input = fs.fstatSync(0);
let received = 0;
process.stdin.on("data", data => { received += data.length; });
process.stdin.on("end", () => {
  fs.writeFileSync(process.argv[1], Buffer.from([0, 255, 10, 13, 65]));
  process.stderr.write("closed input diagnostics\\n");
  process.stdout.write(JSON.stringify({
    args: process.argv.slice(1), cwd: process.cwd(), received, eof: true,
    pipe: input.isFIFO() || input.isSocket(), character: input.isCharacterDevice(),
    regular: input.isFile(), selected: process.env.REA_VERIFIER_SELECTED,
    ambient: process.env.${sentinel} ?? null, omitted: process.env.REA_VERIFIER_OMITTED ?? null
  }));
});
process.stdin.resume();
`;
    const commands = await createVerifierCommands();
    let output;
    process.env[sentinel] = "ambient-only";
    try {
      output = await commands.exec(
        process.execPath,
        ["-e", source, "--", ...arguments_],
        {
          cwd: directory,
          env: {
            REA_VERIFIER_SELECTED: "caller-selected",
            REA_VERIFIER_OMITTED: undefined,
          },
          stdin: "closed-pipe",
          timeout: 2_000,
        },
      );
    } finally {
      if (previous === undefined) delete process.env[sentinel];
      else process.env[sentinel] = previous;
      await commands.close();
    }

    expect(JSON.parse(output!.stdout)).toEqual({
      args: arguments_,
      cwd: directory,
      received: 0,
      eof: true,
      pipe: true,
      character: false,
      regular: false,
      selected: "caller-selected",
      ambient: null,
      omitted: null,
    });
    expect(output?.stderr).toBe("closed input diagnostics\n");
    expect(commands.cleanupResources).toEqual([]);
    expect(existsSync(directory)).toBe(true);
    expect(Buffer.compare(await readFile(artifact), bytes)).toBe(0);
  },
);

it("reports a numeric nonzero exit with its complete output snapshot after cleanup", async () => {
  const directory = await createTestTempDirectory("rea-verifier-exit-");
  const artifact = join(directory, "existing evidence.bin");
  const bytes = Buffer.from([255, 0, 128, 10]);
  await writeFile(artifact, bytes);
  const commands = await createVerifierCommands();
  const stdout = "stdout α\n  ";
  const stderr = "stderr β\n";
  const arguments_ = [
    "-e",
    `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = 7;`,
  ];
  let outcome;
  try {
    outcome = await observed(
      commands.exec(process.execPath, arguments_, { cwd: directory }),
    );
  } finally {
    await commands.close();
  }

  expect(outcome).toEqual({
    ok: false,
    cause: expect.objectContaining({
      name: "VerifierCommandExitError",
      command: process.execPath,
      arguments_: arguments_,
      code: 7,
      snapshot: expect.objectContaining({
        exitCode: 7,
        signal: null,
        stdout: expect.objectContaining({
          text: stdout,
          bytes: Buffer.byteLength(stdout),
          observedBytes: Buffer.byteLength(stdout),
        }),
        stderr: expect.objectContaining({
          text: stderr,
          bytes: Buffer.byteLength(stderr),
          observedBytes: Buffer.byteLength(stderr),
        }),
      }),
    }),
  });
  expect(commands.cleanupResources).toEqual([]);
  expect(existsSync(directory)).toBe(true);
  expect(Buffer.compare(await readFile(artifact), bytes)).toBe(0);
});

it("retries only the failed exact file capability after a peer releases, retaining both evidence files", async () => {
  const directory = await createTestTempDirectory("rea-verifier-retained-");
  const artifact = join(directory, "retained evidence.bin");
  const peerArtifact = join(directory, "released peer evidence.bin");
  const bytes = Buffer.from([0, 255, 65]);
  await writeFile(artifact, bytes);
  await writeFile(peerArtifact, bytes);
  const handle = await open(artifact, "r");
  const peerHandle = await open(peerArtifact, "r");
  const commands = await createVerifierCommands();
  const denied = new Error("authored file capability release denial");
  const releases: object[] = [];
  let peerReleases = 0;
  let deny = true;
  let released = false;
  const capability = {
    get cleanupResources() {
      return released ? [] : [artifact];
    },
    async close() {
      releases.push(this);
      if (deny) throw denied;
      await handle.close();
      released = true;
    },
  };
  commands.adopt(capability, artifact);
  commands.adopt(capability, artifact);
  commands.adopt(
    {
      async close() {
        peerReleases += 1;
        await peerHandle.close();
      },
    },
    peerArtifact,
  );
  let first;
  let retained;
  try {
    first = await observed(commands.close());
    retained = {
      resources: [...commands.cleanupResources],
      size: (await handle.stat()).size,
      peerDescriptor: peerHandle.fd,
      peerReleases,
      directory: existsSync(directory),
    };
  } finally {
    deny = false;
    await commands.close();
  }
  const failure = first?.ok === false ? first.cause : undefined;
  const cause = z
    .object({ cause: z.object({ errors: z.array(z.unknown()) }) })
    .parse(failure).cause;

  expect(cause.errors).toHaveLength(1);
  expect(cause.errors[0]).toBe(denied);
  expect(retained).toEqual({
    resources: [artifact],
    size: bytes.length,
    peerDescriptor: -1,
    peerReleases: 1,
    directory: true,
  });
  expect(releases).toHaveLength(2);
  for (const owner of releases) expect(owner).toBe(capability);
  expect(handle.fd).toBe(-1);
  expect(peerReleases).toBe(1);
  expect(peerHandle.fd).toBe(-1);
  expect(commands.cleanupResources).toEqual([]);
  expect(existsSync(directory)).toBe(true);
  expect(Buffer.compare(await readFile(artifact), bytes)).toBe(0);
  expect(Buffer.compare(await readFile(peerArtifact), bytes)).toBe(0);
});

it("refuses new owners and commands after successful close while leaving new resources with their caller", async () => {
  const directory = await createTestTempDirectory("rea-verifier-admission-");
  const artifact = join(directory, "caller evidence.bin");
  const forbidden = join(directory, "forbidden launch");
  await writeFile(artifact, "caller-owned evidence");
  const commands = await createVerifierCommands();
  await commands.close();
  const handle = await open(artifact, "r");
  let releases = 0;
  const capability = {
    async close() {
      releases += 1;
      await handle.close();
    },
  };
  let rejection: unknown;
  let retained;
  let execution;
  try {
    try {
      commands.adopt(capability, artifact);
    } catch (cause: unknown) {
      rejection = cause;
    }
    retained = { size: (await handle.stat()).size, releases };
    execution = await observed(
      commands.exec(
        process.execPath,
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(forbidden)}, "unexpected launch");`,
        ],
        { cwd: directory },
      ),
    );
  } finally {
    await capability.close();
    await commands.close();
  }

  expect(rejection).toBeInstanceOf(Error);
  expect(retained).toEqual({
    size: Buffer.byteLength("caller-owned evidence"),
    releases: 0,
  });
  expect(execution).toEqual({
    ok: false,
    cause: expect.objectContaining({
      message: "Verifier command owner is closed",
    }),
  });
  expect(releases).toBe(1);
  expect(handle.fd).toBe(-1);
  expect(commands.cleanupResources).toEqual([]);
  expect(existsSync(forbidden)).toBe(false);
  expect(existsSync(directory)).toBe(true);
  expect(await readFile(artifact, "utf8")).toBe("caller-owned evidence");
});

it.skipIf(process.platform === "win32")(
  "keeps a selected physical stdin pipe open until the command deadline",
  async () => {
    const directory = await createTestTempDirectory("rea-verifier-open-stdin-");
    const source = `
import { fstatSync } from "node:fs";
const input = fstatSync(0);
process.stdout.write(JSON.stringify({
  pipe: input.isFIFO() || input.isSocket(),
  character: input.isCharacterDevice(),
  regular: input.isFile()
}) + "\\n");
for await (const _chunk of process.stdin) {}
process.stdout.write("unexpected stdin EOF\\n");
`;
    const expectedOutput =
      JSON.stringify({ pipe: true, character: false, regular: false }) + "\n";
    const commands = await createVerifierCommands();
    let outcome;
    try {
      outcome = await observed(
        commands.exec(process.execPath, ["--input-type=module", "-e", source], {
          cwd: directory,
          stdin: "pipe",
          timeout: 1_500,
        }),
      );
    } finally {
      await commands.close();
    }

    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({
        reason: "timeout",
        cleanupFailure: null,
        snapshot: expect.objectContaining({
          stdout: expect.objectContaining({
            text: expectedOutput,
            bytes: Buffer.byteLength(expectedOutput),
            observedBytes: Buffer.byteLength(expectedOutput),
          }),
          stderr: expect.objectContaining({ text: "" }),
        }),
      }),
    });
    expect(commands.cleanupResources).toEqual([]);
    expect(existsSync(directory)).toBe(true);
  },
  10_000,
);

it.skipIf(process.platform === "win32")(
  "retains a late acquired child's exact cleanup after cancelled close fails and retries it",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-verifier-late-owned-launch-",
    );
    const artifact = join(directory, "retained evidence.bin");
    const bytes = Buffer.from([0, 255, 65]);
    await writeFile(artifact, bytes);
    const entered = deferred();
    const cancelled = deferred();
    const release = deferred();
    const controller = new AbortController();
    const reason = { request: "cancel before owned launch delivery" };
    const denial = "authored exact process cleanup denial";
    let deny = true;
    let acquired:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    const cleanupCalls: Array<
      Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
    > = [];
    const commands = await createVerifierCommands({
      launcher: async (input) => {
        const owned = await spawnOwnedProviderProcess({
          ...input,
          stdin: "pipe",
        });
        acquired = owned;
        await waitForProviderProcessReady(owned.process);
        input.signal?.addEventListener("abort", cancelled.resolve, {
          once: true,
        });
        if (input.signal?.aborted) cancelled.resolve();
        entered.resolve();
        await release.promise;
        return {
          ...owned,
          cleanup: async () => {
            cleanupCalls.push(owned);
            if (deny) return { cleaned: false, reason: denial };
            return owned.cleanup === undefined
              ? cleanupOwnedProcessGroup(owned.ownership)
              : owned.cleanup();
          },
        };
      },
    });
    const running = observed(
      commands.exec(
        process.execPath,
        [
          "-e",
          'process.stdout.write("ready\\n"); process.stderr.write("late child diagnostic\\n"); process.stdin.resume();',
        ],
        { cwd: directory, signal: controller.signal },
      ),
    );
    try {
      await Promise.race([
        entered.promise,
        running.then(() => {
          throw new Error("Command settled before owned launch delivery");
        }),
      ]);
      const owned = acquired;
      if (owned === undefined)
        throw new Error("Expected the exact acquired process owner");
      controller.abort(reason);
      const closing = commands.close();
      expect(commands.close()).toBe(closing);
      let closeSettled = false;
      const closeOutcome = observed(closing).then((outcome) => {
        closeSettled = true;
        return outcome;
      });
      await cancelled.promise;
      expect(closeSettled).toBe(false);
      release.resolve();
      const [execution, close] = await Promise.all([running, closeOutcome]);
      expect(execution.ok).toBe(false);
      if (execution.ok) throw new Error("Expected cancelled execution");
      const failure = z
        .object({
          reason: z.literal("cancelled"),
          cancellation: z.object({ reason: z.unknown() }),
          cleanupFailure: z.literal(denial),
          cleanupOwner: z.object({
            launch: z.object({ process: z.unknown(), ownership: z.unknown() }),
          }),
          resources: z.array(z.string()),
          snapshot: z.object({
            stderr: z.object({ text: z.literal("late child diagnostic\n") }),
          }),
        })
        .parse(execution.cause);
      expect(failure.cancellation.reason).toBe(reason);
      expect(failure.cleanupOwner.launch.process).toBe(owned.process);
      expect(failure.cleanupOwner.launch.ownership).toBe(owned.ownership);
      if (close.ok) throw new Error("Expected retained command cleanup");
      const retryFailure = z
        .object({
          cause: z.object({
            errors: z.array(z.object({ cause: z.unknown() })),
          }),
        })
        .parse(close.cause);
      expect(retryFailure.cause.errors).toHaveLength(1);
      expect(retryFailure.cause.errors[0]?.cause).toBe(execution.cause);
      expect(commands.cleanupResources).toEqual(failure.resources);
      expect(cleanupCalls).toHaveLength(2);
      expect(
        liveProcesses(await systemProcessOwnershipHost.listProcesses()).some(
          ({ pid }) => pid === owned.process.pid,
        ),
      ).toBe(true);

      deny = false;
      await commands.close();
      expect(cleanupCalls).toHaveLength(3);
      for (const owner of cleanupCalls) expect(owner).toBe(owned);
      expect(commands.cleanupResources).toEqual([]);
      expect(
        liveProcesses(await systemProcessOwnershipHost.listProcesses()).some(
          ({ pid }) => pid === owned.process.pid,
        ),
      ).toBe(false);
      expect(existsSync(directory)).toBe(true);
      expect(Buffer.compare(await readFile(artifact), bytes)).toBe(0);
    } finally {
      deny = false;
      release.resolve();
      try {
        await commands.close();
      } finally {
        await running;
        if (
          acquired !== undefined &&
          acquired.process.exitCode === null &&
          acquired.process.signalCode === null
        ) {
          const stopped = await (acquired.cleanup === undefined
            ? cleanupOwnedProcessGroup(acquired.ownership)
            : acquired.cleanup());
          if (!stopped.cleaned) throw new Error(stopped.reason);
        }
      }
    }
  },
  15_000,
);

it.skipIf(process.platform === "win32")(
  "joins a delayed real launcher on close without spawning or removing caller evidence",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-verifier-late-launch-",
    );
    const artifact = join(directory, "retained evidence");
    const forbidden = join(directory, "forbidden launch");
    await writeFile(artifact, "retained before launch");
    const entered = deferred();
    const cancelled = deferred();
    const release = deferred();
    const commands = await createVerifierCommands({
      launcher: async (input) => {
        input.signal?.addEventListener("abort", cancelled.resolve, {
          once: true,
        });
        if (input.signal?.aborted) cancelled.resolve();
        entered.resolve();
        await release.promise;
        return spawnOwnedProviderProcess(input);
      },
    });
    const running = observed(
      commands.exec(
        process.execPath,
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(forbidden)}, "unexpected launch");`,
        ],
        { cwd: directory, timeout: 2_000 },
      ),
    );
    let outcome;
    let sameClose = false;
    let closeSettled = false;
    let settledBeforeLaunchRelease = false;
    try {
      await Promise.race([
        entered.promise,
        running.then(() => {
          throw new Error("Command settled before the authored launch gate");
        }),
      ]);
      const first = commands.close();
      const second = commands.close();
      sameClose = first === second;
      void first.then(
        () => {
          closeSettled = true;
        },
        () => {
          closeSettled = true;
        },
      );
      await cancelled.promise;
      settledBeforeLaunchRelease = closeSettled;
      release.resolve();
      await Promise.all([first, second]);
      outcome = await running;
    } finally {
      release.resolve();
      await commands.close();
      await running;
    }

    expect(sameClose).toBe(true);
    expect(settledBeforeLaunchRelease).toBe(false);
    expect(outcome).toEqual({
      ok: false,
      cause: expect.objectContaining({ reason: "cancelled", snapshot: null }),
    });
    expect(commands.cleanupResources).toEqual([]);
    expect(existsSync(forbidden)).toBe(false);
    expect(existsSync(directory)).toBe(true);
    expect(await readFile(artifact, "utf8")).toBe("retained before launch");
  },
);
