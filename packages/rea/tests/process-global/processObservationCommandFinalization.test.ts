import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";

import { createDarwinProcessRunTokenReader } from "../../src/process/DarwinProcessRunTokenReader.js";
import { createSystemProcessOwnershipHost } from "../../src/process/ProcessOwnershipObservation.js";
import { startProcessSampler } from "../../src/process/capture/ProcessSampling.js";

const waitForFile = async (path: string, timeoutMs = 4_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (cause) {
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "ENOENT"
      )
        throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${path}`);
};

const waitForCommandOrFailure = async (
  ready: Promise<void>,
  pending: Promise<unknown>,
): Promise<void> => {
  const outcome = await Promise.race([
    ready.then(() => ({ ready: true as const })),
    pending.then(
      () => ({ ready: false as const, cause: undefined }),
      (cause: unknown) => ({ ready: false as const, cause }),
    ),
  ]);
  if (!outcome.ready)
    throw new Error("The command completed before its ready marker", {
      cause: outcome.cause,
    });
};

it("rejects an early command failure even when its reason is undefined", async () => {
  const ready = new Promise<void>(() => {});
  await expect(
    waitForCommandOrFailure(ready, Promise.reject(undefined)),
  ).rejects.toBeInstanceOf(Error);
});

const delayedCommandSource = (
  readyPath: string,
  donePath: string,
  stdout = "123 1 123 123 501 S fixture-process",
): string =>
  [
    `const fs = require("node:fs");`,
    `process.on("SIGTERM", () => { setTimeout(() => { fs.writeFileSync(${JSON.stringify(donePath)}, "done"); process.exit(0); }, 150); });`,
    `fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
    `process.stdout.write(${JSON.stringify(`${stdout}\n`)});`,
    `setInterval(() => {}, 1000);`,
    "",
  ].join("\n");

const createDelayedCommand = async (directory: string) => {
  const readyPath = join(directory, "ready");
  const donePath = join(directory, "done");
  const executable = join(directory, "ps");
  const runtime = `#!${process.execPath}\n${delayedCommandSource(readyPath, donePath)}`;
  await writeFile(executable, runtime);
  await chmod(executable, 0o755);
  return { readyPath, donePath, executable };
};

const expectOwnedCommandToFinishOnAbort = async (
  run: (signal: AbortSignal, directory: string) => Promise<unknown>,
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "rea-process-command-"));
  const command = await createDelayedCommand(directory);
  const controller = new AbortController();
  const reason = new Error("cancel owned process command");
  let pending: Promise<unknown> | undefined;
  onTestFinished(async () => {
    try {
      controller.abort(reason);
      await pending?.catch(() => {});
      if (
        await readFile(command.readyPath).then(
          () => true,
          () => false,
        )
      )
        await waitForFile(command.donePath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  pending = run(controller.signal, directory);
  void pending.catch(() => {});
  await waitForCommandOrFailure(waitForFile(command.readyPath), pending);
  controller.abort(reason);
  const failure = await pending.then(
    () => undefined,
    (cause: unknown) => cause,
  );

  if (!(failure instanceof Error))
    throw new Error("The cancelled process command did not return an error");
  expect(failure.cause).toBe(reason);
  await expect(readFile(command.donePath, "utf8")).resolves.toBe("done");
};

const createFakeDarwinReader = async (
  directory: string,
  command: Awaited<ReturnType<typeof createDelayedCommand>>,
) => {
  const compiler = join(directory, "swiftc");
  const generatedRuntime = `#!${process.execPath}\n${delayedCommandSource(command.readyPath, command.donePath)}`;
  const compilerSource = [
    `const fs = require("node:fs");`,
    `const args = process.argv.slice(2);`,
    `const outputIndex = args.indexOf("-o");`,
    `const output = args[outputIndex + 1];`,
    `fs.writeFileSync(output, ${JSON.stringify(generatedRuntime)});`,
    `fs.chmodSync(output, 0o755);`,
  ].join("\n");
  await writeFile(compiler, `#!${process.execPath}\n${compilerSource}\n`);
  await chmod(compiler, 0o755);
  const reader = createDarwinProcessRunTokenReader({
    compiler: { kind: "swiftc", executable: compiler, sdkRoot: directory },
    compileTimeoutMs: 2_000,
    moduleCachePath: join(directory, "module-cache"),
  });
  return reader;
};

const processEntry = {
  pid: 123,
  parentPid: 1,
  processGroupId: 123,
  uid: 501,
  state: "S",
  command: "fixture-process",
} as const;

it.skipIf(process.platform === "win32")(
  "waits for the owned ps command to exit when sampling stops",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-process-sampler-"));
    const readyPath = join(directory, "ready");
    const donePath = join(directory, "done");
    const psPath = join(directory, "ps");
    const originalPath = process.env.PATH;
    const platformDescriptor = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    if (platformDescriptor === undefined)
      throw new Error("process.platform descriptor is unavailable");

    let stopSampler: (() => Promise<unknown>) | undefined;
    let restoreProcessGlobals = (): void => {};
    onTestFinished(async () => {
      try {
        await stopSampler?.();
        if (
          await readFile(readyPath).then(
            () => true,
            () => false,
          )
        )
          await waitForFile(donePath);
      } finally {
        restoreProcessGlobals();
        await rm(directory, { recursive: true, force: true });
      }
    });

    await writeFile(
      psPath,
      `#!${process.execPath}\n${delayedCommandSource(readyPath, donePath, "100 1 100 100 fixture-ps-root")}`,
    );
    await chmod(psPath, 0o755);

    process.env.PATH = `${directory}${originalPath === undefined ? "" : `:${originalPath}`}`;
    Object.defineProperty(process, "platform", {
      ...platformDescriptor,
      value: "darwin",
    });
    restoreProcessGlobals = () => {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      Object.defineProperty(process, "platform", platformDescriptor);
    };

    stopSampler = startProcessSampler({
      rootPid: 100,
      runId: "fixture-run-token",
      started: 0,
      limit: 20,
      samples: [],
    });
    await waitForFile(readyPath);

    await stopSampler();

    await expect(readFile(donePath, "utf8")).resolves.toBe("done");
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["darwin-list", "freebsd-environment"] as const)(
  "waits for the %s ownership command to exit after cancellation",
  async (kind) => {
    await expectOwnedCommandToFinishOnAbort(async (signal, directory) => {
      const platform = kind === "darwin-list" ? "darwin" : "freebsd";
      const host = createSystemProcessOwnershipHost(platform, {
        PATH: directory,
      });
      return kind === "darwin-list"
        ? host.listProcesses(signal)
        : host.environment(123, signal);
    });
  },
);

const expectDarwinReaderCommandToFinishOnAbort = async (
  operation: "read" | "identities",
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), `rea-darwin-${operation}-`));
  const command = await createDelayedCommand(directory);
  const reader = await createFakeDarwinReader(directory, command);
  const controller = new AbortController();
  const reason = new Error(`cancel ${operation}`);
  let pending: Promise<unknown> | undefined;
  onTestFinished(async () => {
    try {
      controller.abort(reason);
      await pending?.catch(() => {});
      if (
        await readFile(command.readyPath).then(
          () => true,
          () => false,
        )
      )
        await waitForFile(command.donePath);
      await reader.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  pending =
    operation === "read"
      ? reader.read([processEntry], controller.signal)
      : reader.identities([processEntry], controller.signal);
  void pending.catch(() => {});
  await waitForCommandOrFailure(waitForFile(command.readyPath), pending);
  controller.abort(reason);
  const failure = await pending.then(
    () => undefined,
    (cause: unknown) => cause,
  );

  if (!(failure instanceof Error))
    throw new Error(
      `The cancelled ${operation} command did not return an error`,
    );
  expect(failure.cause).toBe(reason);
  await expect(readFile(command.donePath, "utf8")).resolves.toBe("done");
};

it.skipIf(process.platform === "win32").each(["read", "identities"] as const)(
  "waits for the compiled Darwin %s command to exit after cancellation",
  async (operation) => {
    await expectDarwinReaderCommandToFinishOnAbort(operation);
  },
);
