import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it as test, vi } from "vitest";

import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";
import { run, session } from "./kunaSessionFixture.js";

const reading = vi.hoisted(() => ({
  asm: "",
  held: false,
  gate: undefined as Promise<void> | undefined,
  onSpanClosed: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) !== reading.asm || reading.held) return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "close")
            return async () => {
              await target.close();
              reading.onSpanClosed?.();
            };
          if (key === "read")
            return async (...readArgs: unknown[]) => {
              const result: unknown = await Reflect.apply(
                target.read,
                target,
                readArgs,
              );
              reading.held = true;
              await reading.gate;
              return result;
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

afterEach(() => {
  reading.asm = "";
  reading.held = false;
  reading.gate = undefined;
  reading.onSpanClosed = undefined;
});

const barrier = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

test.skipIf(process.platform === "win32")(
  "retries the whole dossier when another read loses its project",
  async () => {
    const assembly = barrier();
    const rebuild = barrier();
    const closed = barrier();
    let exports = 0;
    const { cacheRoot, open } = await session(
      "rea-kuna-reader-eviction-",
      {},
      {},
      async (options) => {
        if (options.arguments[0] === "decompile-project" && ++exports === 2)
          await rebuild.promise;
        return spawnOwnedProviderProcess(options);
      },
    );
    const client = open();
    let dossier: ReturnType<typeof run> | undefined;
    try {
      await run(client, "procedure_assembly", { procedure: "main" });
      const [key] = await readdir(join(cacheRoot, "projects"));
      const project = join(cacheRoot, "projects", key ?? "");
      reading.asm = join(project, "project", "program.asm");
      reading.gate = assembly.promise;
      reading.onSpanClosed = closed.release;
      dossier = run(client, "analyze_function", { procedure: "main" });
      await expect.poll(() => reading.held).toBe(true);
      await rename(project, join(cacheRoot, "trash", "evicted-elsewhere"));

      const fallback = await run(client, "procedure_pseudo_code", {
        procedure: "parse",
      });
      expect(fallback.rawResult).toMatchObject({
        source: { kind: "single-function" },
      });
      await expect.poll(() => exports).toBe(2);
      assembly.release();
      // Release the rebuild after the evicted span relinquishes its descriptor.
      // Detection may happen through descriptor state or the missing path.
      await Promise.race([dossier, closed.promise]);
      rebuild.release();
      const result = await dossier;
      expect(result.rawResult).toMatchObject({
        source: {
          kind: "project-export",
          files: [{ facet: "pseudocode" }, { facet: "assembly" }],
        },
      });
      expect(result.result).toMatchObject({
        pseudocode: "int main(void)\n{\n  return 0;\n}",
        assembly: ["main:  ; 0x1000", "  00001000: c3     RET"],
      });
    } finally {
      assembly.release();
      rebuild.release();
      await dossier?.catch(() => undefined);
      expect(await client.close()).toEqual({ ok: true, value: null });
    }
  },
);
