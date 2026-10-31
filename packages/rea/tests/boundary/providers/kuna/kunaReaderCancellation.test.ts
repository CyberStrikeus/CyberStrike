import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { addAbortSignal, PassThrough } from "node:stream";

import { afterEach, expect, it as test, vi } from "vitest";

import { run, session } from "./kunaSessionFixture.js";

const held = vi.hoisted(() => ({
  path: "",
  streams: [] as PassThrough[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      if (String(args[0]) !== held.path)
        return actual.createReadStream(...args);
      const stream = new PassThrough();
      const options = args[1];
      if (typeof options === "object" && options?.signal != null)
        addAbortSignal(options.signal, stream);
      held.streams.push(stream);
      return stream;
    },
  };
});

afterEach(() => {
  held.path = "";
  for (const stream of held.streams) stream.destroy();
  held.streams = [];
});

const ready = async () => {
  const { cacheRoot, open } = await session("rea-kuna-reader-cancel-");
  const client = open();
  try {
    // Export warm-up is independent of the cancellation deadline below and
    // may take longer when the complete test process family has a CPU quota.
    await expect
      .poll(
        async () =>
          (await run(client, "procedure_pseudo_code", { procedure: "main" }))
            .rawResult,
        { timeout: 5000 },
      )
      .toMatchObject({ source: { kind: "project-export" } });
    const [key] = await readdir(join(cacheRoot, "projects"));
    held.path = join(
      cacheRoot,
      "projects",
      key ?? "",
      "project",
      "program.asm",
    );
    return { client, bytes: await readFile(held.path) };
  } catch (cause: unknown) {
    await client.close();
    throw cause;
  }
};

const it = test.skipIf(process.platform === "win32");

it.each([
  { operation: "procedure_assembly", parameters: { procedure: "main" } },
  { operation: "analyze_function", parameters: { procedure: "main" } },
  { operation: "address_name", parameters: { address: "0x3010" } },
] as const)(
  "cancels $operation without cancelling another index reader",
  async ({ operation, parameters }) => {
    const { client, bytes } = await ready();
    const controller = new AbortController();
    let finished = false;
    const cancelled = client
      .execute(operation, parameters, { signal: controller.signal })
      .then((value) => {
        finished = true;
        return value;
      });
    const other = run(client, "procedure_assembly", { procedure: "parse" });
    try {
      await expect.poll(() => held.streams.length).toBe(1);
      const reason = Object.freeze({ requested: "reader-stop", operation });
      controller.abort(reason);
      await expect.poll(() => finished, { timeout: 1000 }).toBe(true);
      const cancelledResult = await cancelled;
      expect(cancelledResult).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
      expect(cancelledResult.ok ? undefined : cancelledResult.error.cause).toBe(
        reason,
      );
      expect(held.streams[0]?.destroyed).toBe(false);
      expect((await run(client, "health")).result).toBeDefined();
      held.streams[0]?.end(bytes);
      expect((await other).result).toContain("parse:  ; 0x1040");
      expect(held.streams).toHaveLength(1);
    } finally {
      held.streams[0]?.end(bytes);
      await Promise.allSettled([cancelled, other]);
      expect(await client.close()).toEqual({ ok: true, value: null });
    }
  },
);

it("close aborts and drains the shared scan after its only caller cancels", async () => {
  const { client } = await ready();
  const controller = new AbortController();
  let result: unknown;
  const request = client
    .execute(
      "procedure_assembly",
      { procedure: "main" },
      { signal: controller.signal },
    )
    .then((value) => {
      result = value;
      return value;
    });
  let closing: ReturnType<typeof client.close> | undefined;
  try {
    await expect.poll(() => held.streams.length).toBe(1);
    controller.abort();
    await expect
      .poll(() => result, { timeout: 1000 })
      .toMatchObject({ ok: false });
    expect(held.streams[0]?.destroyed).toBe(false);
    let closed: unknown;
    closing = client.close().then((value) => {
      closed = value;
      return value;
    });
    await expect
      .poll(() => closed, { timeout: 1000 })
      .toEqual({ ok: true, value: null });
    expect(held.streams[0]?.destroyed).toBe(true);
    expect(held.streams[0]?.closed).toBe(true);
  } finally {
    held.streams[0]?.destroy();
    await request;
    await closing;
    await client.close();
  }
});
