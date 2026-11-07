import { expect, it as test } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";

import {
  fakeKunaCalls,
  fakeKunaExits,
  setFakeKunaBehavior,
} from "./fakeKuna.js";
import {
  FUNCTIONS,
  run,
  session,
  unprovenCleanupLauncher,
} from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

const decompilesOf = async (kuna: string) =>
  (await fakeKunaCalls(kuna)).filter(({ argv }) => argv[0] === "decompile");

it("shares one single-function run among concurrent requests for one entry", async () => {
  const { kuna, open } = await session("rea-kuna-single-shared-", {
    project: "hang",
    decompileDelayMs: 300,
  });
  const client = open();
  try {
    const answers = await Promise.all(
      ["main", "main", "0x1000"].map((procedure) =>
        run(client, "procedure_pseudo_code", { procedure }),
      ),
    );
    for (const answer of answers)
      expect(answer).toMatchObject({
        result: "int main(void) // single-function\n{\n  return 0;\n}",
        rawResult: { source: { kind: "single-function" } },
      });
    expect(await decompilesOf(kuna)).toHaveLength(1);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("keeps a shared run for the callers still waiting when one cancels", async () => {
  const { kuna, open } = await session("rea-kuna-single-cancel-", {
    project: "hang",
    decompileDelayMs: 500,
  });
  const client = open();
  const caller = new AbortController();
  try {
    const leaving = client.execute(
      "procedure_pseudo_code",
      { procedure: "main" },
      { signal: caller.signal },
    );
    const staying = run(client, "procedure_pseudo_code", { procedure: "main" });
    await expect.poll(() => decompilesOf(kuna)).toHaveLength(1);
    caller.abort();
    expect(await leaving).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect((await staying).rawResult).toMatchObject({
      source: { kind: "single-function" },
    });
    const [call] = await decompilesOf(kuna);
    expect((await fakeKunaExits(kuna)).has(call?.pid ?? 0)).toBe(true);
    expect(await decompilesOf(kuna)).toHaveLength(1);
  } finally {
    caller.abort();
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("admits no more concurrent single-function runs than its slots", async () => {
  const { kuna, open } = await session(
    "rea-kuna-single-slots-",
    { project: "hang", decompileDelayMs: 200 },
    {},
    undefined,
    1,
  );
  const client = open();
  try {
    await Promise.all(
      ["main", "parse"].map((procedure) =>
        run(client, "procedure_pseudo_code", { procedure }),
      ),
    );
    const [first, second] = [...(await decompilesOf(kuna))].sort(
      (left, right) => left.at - right.at,
    );
    const exits = await fakeKunaExits(kuna);
    if (first === undefined || second === undefined)
      throw new Error("Expected both single-function runs");
    const firstExit = exits.get(first.pid);
    expect(firstExit).toBeDefined();
    if (firstExit === undefined) throw new Error("Missing first process exit");
    // The second run starts only after the first one's process finished.
    expect(second.at).toBeGreaterThanOrEqual(firstExit);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("answers a queued request from the export once it finishes first", async () => {
  const { kuna, open } = await session(
    "rea-kuna-single-yield-",
    { delayMs: 400, decompile: "hang" },
    {},
    undefined,
    1,
  );
  const client = open();
  const holder = new AbortController();
  try {
    // This run holds the only slot until its caller leaves.
    const holding = client.execute(
      "procedure_pseudo_code",
      { procedure: "main" },
      { signal: holder.signal },
    );
    await expect.poll(() => decompilesOf(kuna)).toHaveLength(1);
    const queued = await run(client, "procedure_pseudo_code", {
      procedure: "parse",
    });
    expect(queued).toMatchObject({
      result: "int parse(void)\n{\n  return 1;\n}",
      rawResult: { source: { kind: "project-export" } },
    });
    expect(await decompilesOf(kuna)).toHaveLength(1);
    holder.abort();
    expect(await holding).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  } finally {
    holder.abort();
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("keeps the slot of a run whose stop is unproven until close proves it", async () => {
  const unproven = unprovenCleanupLauncher("decompile");
  const { kuna, open } = await session(
    "rea-kuna-single-retained-slot-",
    { project: "hang", decompile: "hang" },
    { REA_KUNA_TIMEOUT_MS: "300" },
    unproven.launcher,
    1,
  );
  const client = open();
  const waiter = new AbortController();
  try {
    expect(
      await client.execute("procedure_pseudo_code", { procedure: "main" }),
    ).toMatchObject({ ok: false, error: { cleanupIncomplete: true } });
    // The timed-out tree may still run, so the next run must not start.
    const queued = client.execute(
      "procedure_pseudo_code",
      { procedure: "parse" },
      { signal: waiter.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await decompilesOf(kuna)).toHaveLength(1);
    waiter.abort();
    expect(await queued).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect((await client.close()).ok).toBe(false);
    unproven.release();
    expect(await client.close()).toEqual({ ok: true, value: null });

    // The proven stop returns the slot to the provider.
    await setFakeKunaBehavior(kuna, { functions: FUNCTIONS, project: "hang" });
    const next = open();
    try {
      expect(
        (await run(next, "procedure_pseudo_code", { procedure: "parse" }))
          .rawResult,
      ).toMatchObject({ source: { kind: "single-function" } });
    } finally {
      expect(await next.close()).toEqual({ ok: true, value: null });
    }
  } finally {
    waiter.abort();
    unproven.release();
    await client.close();
  }
});

it("answers a repeated request from the completed run while the export builds", async () => {
  const { kuna, open } = await session("rea-kuna-single-kept-", {
    project: "hang",
  });
  const client = open();
  try {
    const first = await run(client, "procedure_pseudo_code", {
      procedure: "main",
    });
    // A repeat by name or by address reuses the text; no run re-analyzes.
    for (const procedure of ["main", "0x1000"])
      expect(
        await run(client, "procedure_pseudo_code", { procedure }),
      ).toMatchObject({
        result: first.result,
        rawResult: { source: { kind: "single-function" } },
      });
    expect(await decompilesOf(kuna)).toHaveLength(1);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("keeps answering repeats from the completed run after the export fails", async () => {
  const { kuna, open } = await session("rea-kuna-single-kept-failed-", {
    project: "exit-failure",
  });
  const client = open();
  try {
    expect(
      await client.execute("procedure_assembly", { procedure: "main" }),
    ).toMatchObject({ ok: false, error: { retryable: false } });
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const answer = await run(client, "procedure_pseudo_code", {
        procedure: "main",
      });
      expect(answer.rawResult).toMatchObject({
        source: { kind: "single-function" },
      });
      expect(answer.limitations).toContainEqual(
        expect.stringContaining("The project export failed"),
      );
    }
    expect(await decompilesOf(kuna)).toHaveLength(1);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("does not keep a failed run, so a repeat runs again", async () => {
  const { kuna, open } = await session(
    "rea-kuna-single-failed-not-kept-",
    { project: "hang", decompile: "hang" },
    { REA_KUNA_TIMEOUT_MS: "200" },
  );
  const client = open();
  try {
    for (let repeat = 0; repeat < 2; repeat += 1)
      expect(
        await client.execute("procedure_pseudo_code", { procedure: "main" }),
      ).toMatchObject({ ok: false });
    expect(await decompilesOf(kuna)).toHaveLength(2);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("drops the least recently used text beyond the session's 16 MiB budget", async () => {
  // Two 6 MiB texts fit the budget and a third does not. Reading main again
  // makes parse the least recently used, so keeping broken drops parse.
  const { kuna, open } = await session("rea-kuna-single-kept-budget-", {
    project: "hang",
    decompilePadding: 6 * 1024 * 1024,
  });
  const client = open();
  try {
    for (const procedure of [
      "main",
      "parse",
      "main",
      "broken",
      "main",
      "parse",
    ])
      await run(client, "procedure_pseudo_code", { procedure });
    expect((await decompilesOf(kuna)).map(({ argv }) => argv[2])).toEqual([
      "0x1000",
      "0x1040",
      "0x1080",
      "0x1040",
    ]);
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("names the setting that owns a single-function deadline", async () => {
  const { open } = await session(
    "rea-kuna-function-deadline-",
    { project: "hang", decompile: "hang" },
    { REA_KUNA_TIMEOUT_MS: "300" },
  );
  const client = open();
  try {
    const result = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    if (result.ok) throw new Error("the hanging run answered");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "provider_timeout",
      message:
        "kuna decompile did not finish within REA_KUNA_TIMEOUT_MS (300 ms).",
      remediation: {
        action: expect.stringMatching(
          /^Raise REA_KUNA_TIMEOUT_MS .* restart REA.*project export/u,
        ),
      },
      details: { timeout_ms: 300 },
    });
  } finally {
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});
