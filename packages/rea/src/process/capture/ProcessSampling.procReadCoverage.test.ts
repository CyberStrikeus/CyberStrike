import { afterAll, beforeAll, expect, it, onTestFinished, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  failures: new Map<string, string>(),
  abortErrors: new Set<string>(),
  reads: [] as string[],
  tasks: new Map<number, readonly string[]>(),
  children: new Map<string, string>(),
  holdPath: undefined as string | undefined,
  holdStarted: false,
  holdStartedResolve: undefined as (() => void) | undefined,
  abortObserved: false,
  abortObservedResolve: undefined as (() => void) | undefined,
  holdReaddirPath: undefined as string | undefined,
  readdirGate: undefined as Promise<void> | undefined,
  readdirStarted: false,
  readdirStartedResolve: undefined as (() => void) | undefined,
  readdirCount: 0,
  psFailure: undefined as string | undefined,
  psOutput: undefined as string | undefined,
  psReads: 0,
  statWaitPid: undefined as number | undefined,
  statWaitCount: 0,
  statWaitResolve: undefined as (() => void) | undefined,
  statReads: new Map<number, number>(),
  statMutations: new Map<
    number,
    {
      readonly read: number;
      readonly pid?: number;
      readonly parent?: number;
      readonly processGroupId?: number;
      readonly sessionId?: number;
      readonly start?: number;
    }
  >(),
  runId: "fixture-run-token",
  runIdFailure: undefined as string | undefined,
  runIdAvailability: undefined as "absent" | "unavailable" | undefined,
  runIdReads: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    readFile: async (...args: Parameters<typeof filesystem.readFile>) => {
      const [path, options] = args;
      const filename = String(path);
      if (!filename.startsWith("/proc/")) return filesystem.readFile(...args);
      fixture.reads.push(filename);
      const code = fixture.failures.get(filename);
      if (code !== undefined) throw Object.assign(new Error(code), { code });
      if (fixture.abortErrors.has(filename)) {
        const error = new Error("unexpected abort-shaped filesystem error");
        error.name = "AbortError";
        throw error;
      }
      if (filename === fixture.holdPath) {
        fixture.holdStarted = true;
        fixture.holdStartedResolve?.();
        const signal =
          typeof options === "object" && options !== null && "signal" in options
            ? options.signal
            : undefined;
        await new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) {
            const error = Object.assign(new Error("sampling cancelled"), {
              cause: signal.reason,
            });
            error.name = "AbortError";
            reject(error);
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              fixture.abortObserved = true;
              fixture.abortObservedResolve?.();
              const error = Object.assign(new Error("sampling cancelled"), {
                cause: signal?.reason,
              });
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }
      const statMatch = /^\/proc\/(\d+)\/stat$/u.exec(filename);
      let value: string | Buffer;
      if (statMatch !== null) {
        const pid = Number(statMatch[1]);
        const reads = (fixture.statReads.get(pid) ?? 0) + 1;
        fixture.statReads.set(pid, reads);
        if (pid === fixture.statWaitPid && reads >= fixture.statWaitCount)
          fixture.statWaitResolve?.();
        value = statLine(pid, reads);
      } else {
        const childMatch = /^\/proc\/(\d+)\/task\/(\d+)\/children$/u.exec(
          filename,
        );
        if (childMatch !== null)
          value =
            fixture.children.get(`${childMatch[1]}:${childMatch[2]}`) ?? "";
        else if (/^\/proc\/\d+\/cmdline$/u.test(filename))
          value = Buffer.from(`fixture-command-${filename.split("/")[2]}\0`);
        else throw new Error(`Unexpected proc fixture read: ${filename}`);
      }
      if (
        typeof options === "object" &&
        options !== null &&
        "encoding" in options &&
        options.encoding === "utf8"
      )
        return typeof value === "string" ? value : value.toString("utf8");
      return Buffer.isBuffer(value) ? value : Buffer.from(value);
    },
    readdir: async (...args: Parameters<typeof filesystem.readdir>) => {
      const [path] = args;
      const filename = String(path);
      if (!filename.startsWith("/proc/")) return filesystem.readdir(...args);
      fixture.reads.push(filename);
      if (filename === fixture.holdReaddirPath) {
        fixture.readdirStarted = true;
        fixture.readdirCount += 1;
        fixture.readdirStartedResolve?.();
        await fixture.readdirGate;
      }
      const code = fixture.failures.get(filename);
      if (code !== undefined) throw Object.assign(new Error(code), { code });
      if (fixture.abortErrors.has(filename)) {
        const error = new Error("unexpected abort-shaped filesystem error");
        error.name = "AbortError";
        throw error;
      }
      const taskMatch = /^\/proc\/(\d+)\/task$/u.exec(filename);
      if (taskMatch === null)
        throw new Error(`Unexpected proc fixture directory: ${filename}`);
      const pid = taskMatch[1];
      if (pid === undefined)
        throw new Error(`Missing task pid in fixture path: ${filename}`);
      return fixture.tasks.get(Number(pid)) ?? [pid];
    },
  };
});

vi.mock("../ProcessOwnership.js", () => ({
  readProcessRunId: async () => {
    fixture.runIdReads += 1;
    if (
      fixture.runIdFailure !== undefined &&
      fixture.runIdAvailability !== undefined
    )
      throw new ProcessRunTokenReadError(
        100,
        fixture.runIdAvailability,
        fixture.runIdFailure,
      );
    if (fixture.runIdFailure !== undefined)
      throw Object.assign(new Error(fixture.runIdFailure), {
        code: fixture.runIdFailure,
      });
    return fixture.runId;
  },
}));

vi.mock("../ExecFileOutput.js", () => ({
  execFileOutput: async () => {
    fixture.psReads += 1;
    if (fixture.psFailure !== undefined)
      throw Object.assign(new Error(fixture.psFailure), {
        code: fixture.psFailure,
      });
    return { stdout: fixture.psOutput ?? psFixture() };
  },
}));

import { ProcessRunTokenReadError } from "../ProcessRunTokenObservations.js";
import { startProcessSampler } from "./ProcessSampling.js";
import { readLinuxProcessStat } from "./LinuxProcessSampling.js";
import type { ProcessSample } from "../../domain/process/processCapture.js";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
beforeAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "linux",
  });
});
afterAll(() => {
  if (platformDescriptor !== undefined)
    Object.defineProperty(process, "platform", platformDescriptor);
});

const processRows = [
  { pid: 100, parent: 1, start: 1100 },
  { pid: 200, parent: 100, start: 1200 },
  { pid: 300, parent: 200, start: 1300 },
  { pid: 400, parent: 100, start: 1400 },
] as const;

const statLine = (pid: number, read: number): string => {
  const row = processRows.find((candidate) => candidate.pid === pid);
  if (row === undefined) throw new Error(`Unknown fixture pid ${String(pid)}`);
  const mutation = fixture.statMutations.get(pid);
  const fields = [
    "S",
    String(
      mutation?.read === read ? (mutation.parent ?? row.parent) : row.parent,
    ),
    String(mutation?.read === read ? (mutation.processGroupId ?? 100) : 100),
    String(mutation?.read === read ? (mutation.sessionId ?? 100) : 100),
  ];
  while (fields.length < 19) fields.push("0");
  fields.push(
    String(mutation?.read === read ? (mutation.start ?? row.start) : row.start),
  );
  const reportedPid = mutation?.read === read ? (mutation.pid ?? pid) : pid;
  return `${String(reportedPid)} (fixture-${String(pid)}) ${fields.join(" ")}`;
};

const psFixture = (): string =>
  processRows
    .map(
      ({ pid, parent }) =>
        `${String(pid)} ${String(parent)} 100 100 fixture-command-${String(pid)}`,
    )
    .join("\n");

const setUpFixture = (): void => {
  fixture.failures.clear();
  fixture.abortErrors.clear();
  fixture.reads.length = 0;
  fixture.tasks.clear();
  fixture.children.clear();
  fixture.holdPath = undefined;
  fixture.holdStarted = false;
  fixture.holdStartedResolve = undefined;
  fixture.abortObserved = false;
  fixture.abortObservedResolve = undefined;
  fixture.holdReaddirPath = undefined;
  fixture.readdirGate = undefined;
  fixture.readdirStarted = false;
  fixture.readdirStartedResolve = undefined;
  fixture.readdirCount = 0;
  fixture.psFailure = undefined;
  fixture.psOutput = undefined;
  fixture.psReads = 0;
  fixture.statWaitPid = undefined;
  fixture.statWaitCount = 0;
  fixture.statWaitResolve = undefined;
  fixture.statReads.clear();
  fixture.statMutations.clear();
  fixture.runIdFailure = undefined;
  fixture.runIdAvailability = undefined;
  fixture.runIdReads = 0;
  for (const pid of [100, 200, 300, 400]) fixture.tasks.set(pid, [String(pid)]);
  fixture.children.set("100:100", "200 400");
  fixture.children.set("200:200", "300");
};

const start = () => {
  const samples: ProcessSample[] = [];
  const stop = startProcessSampler({
    rootPid: 100,
    runId: fixture.runId,
    started: 0,
    limit: 20,
    samples,
  });
  onTestFinished(async () => {
    await stop();
  });
  return { samples, stop };
};

const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() >= deadline)
      throw new Error("proc fixture condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

it("rejects a mismatched stat PID at sampling admission", async () => {
  setUpFixture();
  fixture.statMutations.set(100, { read: 1, pid: 200 });
  const wrongPid = await readLinuxProcessStat(
    100,
    new AbortController().signal,
  );
  expect(wrongPid.value).toBeUndefined();
  expect(wrongPid.diagnostics).toMatchObject({
    count: 1,
    first: "/proc/100/stat: malformed process identity",
  });
});

it.each([0, -1])(
  "does not classify native unavailable relations (%s) as malformed identity",
  async (relation) => {
    setUpFixture();
    fixture.statMutations.set(100, {
      read: 1,
      processGroupId: relation,
      sessionId: relation,
    });
    const observed = await readLinuxProcessStat(
      100,
      new AbortController().signal,
    );
    expect(observed.value).toBeUndefined();
    expect(observed.diagnostics).toMatchObject({ count: 0, first: null });
  },
);

const flushImmediateProcPass = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const deferred = (): { readonly promise: Promise<void>; resolve(): void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const expectPartialFailure = async (
  path: string,
  code: string,
  expectedPids: readonly number[],
): Promise<void> => {
  setUpFixture();
  fixture.failures.set(path, code);
  const { samples, stop } = start();
  await waitFor(() => fixture.reads.includes(path));
  await flushImmediateProcPass();
  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toEqual(
    expect.arrayContaining([...expectedPids]),
  );
  expect(result.partial).toBe(true);
  expect(result.coverage.sampling_failures).toBeGreaterThan(0);
  expect(result.coverage.first_sampling_failure).toMatch(code);
  expect(result.coverage.first_sampling_failure).toContain(path);
};

it.each([
  ["/proc/200/stat", "EACCES", [100, 400]],
  ["/proc/200/stat", "EIO", [100, 400]],
  ["/proc/200/cmdline", "EPERM", [100, 200, 300, 400]],
  ["/proc/100/task", "EIO", [100]],
  ["/proc/100/task/100/children", "EACCES", [100, 200, 300, 400]],
  ["/proc/200/task/200/children", "EPERM", [100, 200, 400]],
] as const)(
  "retains readable process rows and reports %s %s as partial",
  async (path, code, expectedPids) => {
    await expectPartialFailure(path, code, expectedPids);
  },
);

it("retains only fully bracketed rows when stop interrupts a held child read", async () => {
  const childReadStarted = deferred();
  const siblingBracketed = deferred();
  setUpFixture();
  fixture.holdPath = "/proc/200/cmdline";
  fixture.holdStartedResolve = childReadStarted.resolve;
  fixture.statWaitPid = 400;
  fixture.statWaitCount = 2;
  fixture.statWaitResolve = siblingBracketed.resolve;
  const { samples, stop } = start();
  await Promise.all([childReadStarted.promise, siblingBracketed.promise]);
  await Promise.resolve();
  await Promise.resolve();
  expect(fixture.statReads.get(400)).toBe(2);

  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toEqual(
    expect.arrayContaining([100, 400]),
  );
  expect(samples.some(({ pid }) => pid === 200 || pid === 300)).toBe(false);
  expect(result.partial).toBe(true);
  expect(result.coverage.sampling_failures).toBe(1);
  expect(result.coverage.first_sampling_failure).toMatch(/interrupted/iu);
});

it("retains only the stable procfs root if it changes during ps fallback discovery", async () => {
  setUpFixture();
  fixture.failures.set("/proc/100/task/100/children", "EACCES");
  fixture.statMutations.set(100, { read: 5, start: 9999 });
  fixture.psOutput = [
    "100 1 100 100 ps-root-command",
    "200 100 100 100 discovery-only-child-command",
    "300 200 100 100 discovery-only-grandchild-command",
    "400 100 100 100 discovery-only-sibling-command",
  ].join("\n");
  const { samples, stop } = start();
  await waitFor(() => fixture.psReads > 0);
  await waitFor(
    () =>
      fixture.statReads.get(100) === 5 &&
      samples.some((sample) => sample.pid === 100),
  );
  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toEqual([100]);
  expect(samples[0]?.command).toBe("fixture-command-100");
  expect(result.partial).toBe(true);
  expect(result.coverage.sampling_failures).toBeGreaterThan(0);
});

it("rejects a ps child edge when procfs reports a different parent", async () => {
  setUpFixture();
  fixture.failures.set("/proc/100/task/100/children", "EACCES");
  fixture.statMutations.set(200, { read: 1, parent: 201 });
  fixture.psOutput = [
    "100 1 100 100 ps-root-command",
    "200 100 100 100 discovery-only-child-command",
    "300 200 100 100 discovery-only-grandchild-command",
    "400 100 100 100 discovery-only-sibling-command",
  ].join("\n");
  const { samples, stop } = start();
  await waitFor(
    () =>
      samples.some((sample) => sample.pid === 100) &&
      samples.some((sample) => sample.pid === 400),
  );
  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toEqual([100, 400]);
  expect(samples.map(({ command }) => command)).toEqual([
    "fixture-command-100",
    "fixture-command-400",
  ]);
  expect(result.partial).toBe(true);
});

it("retains children from readable threads while reporting another thread's EIO", async () => {
  setUpFixture();
  fixture.tasks.set(100, ["100", "101"]);
  fixture.children.set("100:101", "");
  fixture.failures.set("/proc/100/task/101/children", "EIO");
  const { samples, stop } = start();
  await waitFor(() => fixture.reads.includes("/proc/100/task/101/children"));
  await flushImmediateProcPass();
  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toEqual(
    expect.arrayContaining([100, 200, 300, 400]),
  );
  expect(result.partial).toBe(true);
  expect(result.coverage.first_sampling_failure).toContain("EIO");
  expect(result.coverage.first_sampling_failure).toContain(
    "/proc/100/task/101/children",
  );
});

it.each(["ENOENT", "ESRCH"] as const)(
  "treats %s as an expected process disappearance rather than a sampling failure",
  async (code) => {
    setUpFixture();
    fixture.failures.set("/proc/200/stat", code);
    const { samples, stop } = start();
    await waitFor(() => samples.some((row) => row.pid === 400));
    const result = await stop();
    expect(samples.map(({ pid }) => pid)).toEqual(
      expect.arrayContaining([100, 400]),
    );
    expect(result.partial).toBe(false);
    expect(result.coverage.sampling_failures).toBe(0);
    expect(result.coverage.first_sampling_failure).toBeNull();
  },
);

it.each(["EACCES", "EIO"] as const)(
  "records root run-token inspection failure %s as incomplete sampling",
  async (code) => {
    setUpFixture();
    fixture.runIdFailure = code;
    const { samples, stop } = start();
    await waitFor(() => fixture.runIdReads > 0);
    await flushImmediateProcPass();
    const result = await stop();
    expect(samples).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.coverage.sampling_failures).toBeGreaterThan(0);
    expect(result.coverage.first_sampling_failure).toContain(code);
    expect(result.coverage.first_sampling_failure).toContain("100");
  },
);

it("does not swallow an unrelated filesystem AbortError as sampler cancellation", async () => {
  setUpFixture();
  fixture.abortErrors.add("/proc/200/stat");
  const { samples, stop } = start();
  await waitFor(() => fixture.reads.includes("/proc/200/stat"));
  await flushImmediateProcPass();
  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toEqual(
    expect.arrayContaining([100, 400]),
  );
  expect(result.partial).toBe(true);
  expect(result.coverage.sampling_failures).toBeGreaterThan(0);
  expect(result.coverage.first_sampling_failure).toContain("AbortError");
  expect(result.coverage.first_sampling_failure).toContain("/proc/200/stat");
});

it("does not report sampler shutdown cancellation as a proc-read failure", async () => {
  setUpFixture();
  fixture.holdPath = "/proc/100/task/100/children";
  const { stop } = start();
  await waitFor(() => fixture.holdStarted);
  const result = await stop();
  expect(result.partial).toBe(true);
  expect(result.coverage.sampling_failures).toBe(1);
  expect(result.coverage.first_sampling_failure).toMatch(/interrupted/iu);
});

it("awaits issued proc reads through stop, retaining a late I/O failure but excluding the matching abort", async () => {
  vi.useFakeTimers();
  const readdirGate = deferred();
  const readdirStarted = deferred();
  const commandStarted = deferred();
  const commandAborted = deferred();
  const releaseReaddir = readdirGate.resolve;
  let stopSampling: ReturnType<typeof start>["stop"] | undefined;
  try {
    setUpFixture();
    fixture.holdReaddirPath = "/proc/100/task";
    fixture.readdirGate = readdirGate.promise;
    fixture.readdirStartedResolve = readdirStarted.resolve;
    fixture.holdPath = "/proc/100/cmdline";
    fixture.holdStartedResolve = commandStarted.resolve;
    fixture.abortObservedResolve = commandAborted.resolve;
    const { stop } = start();
    stopSampling = stop;
    await Promise.all([readdirStarted.promise, commandStarted.promise]);

    await vi.advanceTimersByTimeAsync(150);
    expect(fixture.readdirCount).toBe(1);
    expect(fixture.runIdReads).toBe(1);

    let stopSettled = false;
    const stopping = stop().then((result) => {
      stopSettled = true;
      return result;
    });
    await commandAborted.promise;
    expect(stopSettled).toBe(false);
    fixture.failures.set("/proc/100/task", "EIO");
    releaseReaddir();
    const result = await stopping;
    expect(fixture.readdirCount).toBe(1);
    expect(result.partial).toBe(true);
    expect(result.coverage.sampling_failures).toBe(2);
    expect(result.coverage.first_sampling_failure).toContain("EIO");
    expect(result.coverage.first_sampling_failure).toContain("/proc/100/task");
    expect(result.coverage.first_sampling_failure).toMatch(/interrupted/iu);
    expect(result.coverage.first_sampling_failure).not.toContain("AbortError");
  } finally {
    releaseReaddir();
    await stopSampling?.();
    vi.useRealTimers();
  }
});

it("retains a stable root row when child enumeration and its ps fallback both fail", async () => {
  setUpFixture();
  fixture.tasks.set(100, ["100", "101"]);
  fixture.failures.set("/proc/100/task/100/children", "EACCES");
  fixture.failures.set("/proc/100/task/101/children", "EIO");
  fixture.psFailure = "EIO";
  const { samples, stop } = start();
  await waitFor(() => fixture.reads.includes("/proc/100/task/101/children"));
  await flushImmediateProcPass();
  const result = await stop();
  expect(samples.map(({ pid }) => pid)).toContain(100);
  expect(result.partial).toBe(true);
  expect(result.coverage.sampling_failures).toBeGreaterThanOrEqual(3);
  expect(result.coverage.first_sampling_failure).toContain(
    "/proc/100/task/100/children",
  );
});

it.each([
  { description: "PID", mutation: { read: 2, pid: 101 } },
  { description: "start time", mutation: { read: 2, start: 9999 } },
  { description: "parent", mutation: { read: 2, parent: 2 } },
] as const)(
  "does not attribute a root whose initialized identity changes by $description",
  async ({ mutation }) => {
    setUpFixture();
    fixture.statMutations.set(100, mutation);
    const { samples, stop } = start();
    await waitFor(() => fixture.runIdReads > 0);
    await flushImmediateProcPass();
    await stop();
    expect(samples).toEqual([]);
  },
);

it.each([0, -1])(
  "keeps completed samples without false failures when root relations disappear (%s)",
  async (relation) => {
    setUpFixture();
    fixture.children.set("100:100", "");
    // Reads 1/2 establish PTY readiness; 3/4 bracket the retained root sample.
    // The next pass sees a valid kernel record whose relations are unavailable.
    fixture.statMutations.set(100, {
      read: 5,
      processGroupId: relation,
      sessionId: relation,
    });
    const { samples, stop } = start();
    await waitFor(() => (fixture.statReads.get(100) ?? 0) >= 5);
    await flushImmediateProcPass();
    const result = await stop();
    expect(samples.map(({ pid }) => pid)).toEqual([100]);
    expect(result.coverage).toMatchObject({
      sampling_failures: 0,
      first_sampling_failure: null,
    });
    expect(result.partial).toBe(false);
  },
);

it("marks a completed clean pass as neither partial nor interrupted", async () => {
  setUpFixture();
  const { samples, stop } = start();
  await waitFor(() =>
    [100, 200, 300, 400].every((pid) =>
      samples.some((sample) => sample.pid === pid),
    ),
  );
  const result = await stop();
  expect(result.partial).toBe(false);
  expect(result.coverage.sampling_failures).toBe(0);
  expect(result.coverage.first_sampling_failure).toBeNull();
});

it.each(["absent", "unavailable"] as const)(
  "classifies native token availability during Darwin sampler initialization: %s",
  async (availability) => {
    setUpFixture();
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    fixture.runIdAvailability = availability;
    fixture.runIdFailure =
      availability === "absent"
        ? "process_not_in_snapshot"
        : "permission_denied";
    try {
      const { samples, stop } = start();
      await waitFor(() => fixture.runIdReads > 0);
      await flushImmediateProcPass();
      const result = await stop();
      expect(samples).toEqual([]);
      expect(result.partial).toBe(availability !== "absent");
      if (availability === "absent") {
        expect(result.coverage.sampling_failures).toBe(0);
        expect(result.coverage.first_sampling_failure).toBeNull();
      } else {
        expect(result.coverage.sampling_failures).toBeGreaterThan(0);
        expect(result.coverage.first_sampling_failure).toContain(
          "permission_denied",
        );
      }
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: "linux",
      });
    }
  },
);
