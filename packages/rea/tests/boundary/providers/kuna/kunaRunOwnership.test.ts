import { setImmediate } from "node:timers/promises";

import { expect, it as test, vi } from "vitest";

import { inspectKunaInstallationOwned as inspectKunaInstallation } from "./kunaResourceScope.js";
import { KunaRunSlots } from "../../../../src/kuna/KunaRunSlots.js";
import { KunaTargetCommands } from "../../../../src/kuna/KunaTargetCommands.js";
import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";
import { fakeKunaCalls } from "./fakeKuna.js";
import { run, session, unprovenCleanupLauncher } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");
const barrier = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

it.each(["procedure_callees", "xrefs"] as const)(
  "shares foreground admission between a decompile and %s",
  async (operation) => {
    const started = barrier();
    const proceed = barrier();
    const grants: { owner: KunaRunSlots }[] = [];
    const acquire = KunaRunSlots.prototype.acquire;
    const spy = vi
      .spyOn(KunaRunSlots.prototype, "acquire")
      .mockImplementation(function (this: KunaRunSlots, signal) {
        grants.push({ owner: this });
        return acquire.call(this, signal);
      });
    const { open, kuna } = await session(
      "rea-kuna-shared-run-budget-",
      { project: "hang" },
      {},
      async (options) => {
        if (options.arguments[0] === "decompile") {
          started.release();
          await proceed.promise;
        }
        return spawnOwnedProviderProcess(options);
      },
      1,
    );
    const client = open();
    const text = run(client, "procedure_pseudo_code", { procedure: "main" });
    let reference: ReturnType<typeof run> | undefined;
    try {
      await started.promise;
      const budget = grants[0]?.owner;
      expect(budget).toBeDefined();
      reference = run(
        client,
        operation,
        operation === "xrefs" ? { address: "0x3000" } : { procedure: "0x1000" },
      );
      // Observe the actual shared-slot request rather than using a sleep to
      // guess whether the reference query reached its admission boundary.
      await expect
        .poll(() => grants.filter(({ owner }) => owner === budget).length)
        .toBe(2);
      expect(
        (await fakeKunaCalls(kuna)).some(
          ({ argv }) => argv[0] === "decompile-graph" || argv[0] === "xrefs",
        ),
      ).toBe(false);
      proceed.release();
      expect((await text).result).toContain("single-function");
      expect((await reference).result).toEqual([
        operation === "xrefs" ? "0x1004" : "0x1040",
      ]);
    } finally {
      proceed.release();
      await Promise.allSettled([text, reference]);
      await client.close();
      spy.mockRestore();
    }
  },
);

it("keeps an admission lease until retained native cleanup is proven", async () => {
  const unproven = unprovenCleanupLauncher("functions");
  const { target, kuna, cacheRoot } = await session(
    "rea-kuna-retained-run-slot-",
    { inventory: "hang" },
  );
  const installed = await inspectKunaInstallation({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: cacheRoot,
  });
  if (!installed.ok) throw new Error(installed.error.reason);
  const caller = new AbortController();
  const queued = new AbortController();
  const slots = new KunaRunSlots(1);
  const lease = await slots.acquire(caller.signal);
  expect(lease).toBeDefined();
  const commands = new KunaTargetCommands(target, {
    signal: caller.signal,
    launcher: unproven.launcher,
  });
  const work = commands.run({
    installation: installed.value,
    operation: "lease-probe",
    arguments: (input) => ["functions", input, "--json"],
    deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
    outputBytes: 16384,
    signal: caller.signal,
    releaseRun: lease!,
  });
  let admitted: (() => void) | undefined;
  let next: ReturnType<typeof slots.acquire> | undefined;
  try {
    await expect
      .poll(async () =>
        (await fakeKunaCalls(kuna)).some(({ argv }) => argv[0] === "functions"),
      )
      .toBe(true);
    caller.abort();
    expect(await work).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    next = slots.acquire(queued.signal).then((release) => {
      admitted = release;
      return release;
    });
    await setImmediate();
    expect(admitted).toBeUndefined();
    expect(await commands.close()).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    await setImmediate();
    expect(admitted).toBeUndefined();
    unproven.release();
    expect(await commands.close()).toEqual({ ok: true, value: null });
    await expect.poll(() => typeof admitted).toBe("function");
  } finally {
    caller.abort();
    queued.abort();
    unproven.release();
    await work;
    await commands.close();
    (await next)?.();
  }
});
