import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { beforeEach, expect, it, vi } from "vitest";

const parsing = vi.hoisted(() => {
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  };
  return { gate, entered: gate(), release: gate() };
});

vi.mock("../../src/native/pe/PeResourceParser.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/native/pe/PeResourceParser.js")
    >();
  return {
    ...original,
    parsePeResources: async (
      ...arguments_: Parameters<typeof original.parsePeResources>
    ) => {
      parsing.entered.resolve();
      await parsing.release.promise;
      return original.parsePeResources(...arguments_);
    },
  };
});

import { inspectPeResourcesInputSchema } from "../../src/domain/native/peResources.js";
import { PeResourcesProvider } from "../../src/native/pe/PeResourcesProvider.js";
import { peResourceFixture } from "../../src/native/pe/PeResources.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

beforeEach(() => {
  parsing.entered = parsing.gate();
  parsing.release = parsing.gate();
});

it.each(["completion", "cancellation"])(
  "waits for admitted PE parsing through %s before closing",
  async (outcome) => {
    const root = await createTestTempDirectory("rea-pe-parsing-lifetime-");
    const path = join(root, "image.exe");
    await writeFile(path, peResourceFixture().bytes);
    const provider = new PeResourcesProvider();
    const controller = new AbortController();
    const reason = new Error("cancelled during admitted parsing");
    const inspection = provider.inspect(
      inspectPeResourcesInputSchema.parse({ path }),
      { signal: controller.signal },
    );
    await parsing.entered.promise;
    let closed = false;
    const closing = provider.close().then(() => {
      closed = true;
    });
    try {
      if (outcome === "cancellation") controller.abort(reason);
      await setImmediate();
      expect(
        closed,
        "close reported release while parsing was still admitted",
      ).toBe(false);
      parsing.release.resolve();
      const result = await inspection;
      if (outcome === "cancellation") {
        expect(result).toMatchObject({
          ok: false,
          error: { _tag: "AnalysisCancelledError" },
        });
        expect(result.ok ? undefined : result.error.cause).toBe(reason);
      } else
        expect(result).toMatchObject({
          ok: true,
          value: { coverage: { status: "complete" } },
        });
      await closing;
      expect(closed).toBe(true);
      expect(
        (await provider.inspect(inspectPeResourcesInputSchema.parse({ path })))
          .ok,
      ).toBe(false);
    } finally {
      parsing.release.resolve();
      await inspection;
      await closing;
    }
  },
);
