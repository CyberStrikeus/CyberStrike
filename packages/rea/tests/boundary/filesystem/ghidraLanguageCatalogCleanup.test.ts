import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import {
  ArtifactResourceRetryFailure,
  ArtifactResourceScope,
} from "../../../src/artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { readGhidraLanguageCatalog } from "../../../src/ghidra/GhidraLanguageCatalog.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

interface FileControl {
  closeFails: boolean;
  /** Hold close() until every synchronized handle has reached it. */
  synchronizedClose: boolean;
  invalidateOnFailure: boolean;
  readFails: boolean;
  invalidated: boolean;
  closeCalls: number;
  opens: number;
}

// Per-file failure controls, keyed by definition file name, and a barrier
// that releases synchronized closes only after all of them are pending.
const { controls, barrier } = vi.hoisted(() => {
  const state = { expected: 0, arrived: 0, release: () => {} };
  const gate = new Promise<void>((resolve) => {
    state.release = resolve;
  });
  return {
    controls: new Map<string, FileControl>(),
    barrier: {
      state,
      arrive: async () => {
        state.arrived += 1;
        if (state.arrived >= state.expected) state.release();
        await gate;
      },
    },
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const real = await actual.open(...args);
      const control = controls.get(basename(String(args[0])));
      if (control === undefined) return real;
      control.opens += 1;
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await real.close();
      };
      return {
        get fd() {
          return control.invalidated ? -1 : real.fd;
        },
        stat: (...statArgs: Parameters<typeof real.stat>) =>
          real.stat(...statArgs),
        read: (...readArgs: Parameters<typeof real.read>) =>
          control.readFails
            ? Promise.reject(new Error("definition read failed"))
            : real.read(...readArgs),
        close: async () => {
          control.closeCalls += 1;
          if (control.synchronizedClose && control.closeCalls === 1)
            await barrier.arrive();
          if (control.closeFails) {
            if (control.invalidateOnFailure) {
              await release();
              control.invalidated = true;
            }
            throw new Error(`definition close failed: ${String(args[0])}`);
          }
          await release();
        },
      };
    },
  };
});

const control = (name: string, overrides: Partial<FileControl> = {}) => {
  const value: FileControl = {
    closeFails: false,
    synchronizedClose: false,
    invalidateOnFailure: false,
    readFails: false,
    invalidated: false,
    closeCalls: 0,
    opens: 0,
    ...overrides,
  };
  controls.set(name, value);
  return value;
};

const installation = async (name: string): Promise<string> => {
  const root = await createTestTempDirectory("rea-ghidra-ldefs-cleanup-");
  const languages = join(root, "Ghidra/Processors", name, "data/languages");
  await mkdir(languages, { recursive: true });
  await writeFile(
    join(languages, `${name}.ldefs`),
    `<language_definitions><language id="${name}:LE:32:default"/></language_definitions>`,
  );
  return root;
};

const scopes: ArtifactResourceScope[] = [];
const scope = (): ArtifactResourceScope => {
  const value = new ArtifactResourceScope();
  scopes.push(value);
  return value;
};

// Let every retained owner close through its own scope, except an invalidated
// descriptor whose close can never be confirmed.
afterEach(async () => {
  for (const value of controls.values())
    if (!value.invalidateOnFailure) value.closeFails = false;
  await Promise.allSettled(scopes.map((value) => value.close()));
  scopes.length = 0;
  controls.clear();
});

it("retries the retained close in the caller scope before the next read", async () => {
  const resources = scope();
  const retained = control("flaky.ldefs", { closeFails: true });
  const failure = await readGhidraLanguageCatalog(
    await installation("flaky"),
    resources,
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(ArtifactReaderFailure);
  expect(failure).toMatchObject({
    cleanup: { resources: [expect.stringContaining("flaky.ldefs")] },
  });
  expect(resources.hasPending).toBe(true);
  retained.closeFails = false;
  expect(
    await readGhidraLanguageCatalog(await installation("x86"), resources),
  ).toEqual([{ id: "x86:LE:32:default", compilerSpecIds: [] }]);
  expect(retained.closeCalls).toBe(2);
  expect(resources.hasPending).toBe(false);
});

it("refuses new reads without opening definitions while the retry still fails", async () => {
  const resources = scope();
  const retained = control("stuck.ldefs", { closeFails: true });
  await expect(
    readGhidraLanguageCatalog(await installation("stuck"), resources),
  ).rejects.toBeInstanceOf(ArtifactReaderFailure);
  const next = control("next.ldefs");
  const refused = await readGhidraLanguageCatalog(
    await installation("next"),
    resources,
  ).catch((cause: unknown) => cause);
  expect(refused).toBeInstanceOf(ArtifactResourceRetryFailure);
  expect(refused).toMatchObject({
    cleanup: { resources: [expect.stringContaining("stuck.ldefs")] },
  });
  expect(retained.closeCalls).toBe(2);
  expect(next.opens).toBe(0);
  expect(resources.hasPending).toBe(true);
});

it("keeps one scope's retained close out of another scope", async () => {
  control("isolated.ldefs", { closeFails: true });
  const failed = scope();
  await expect(
    readGhidraLanguageCatalog(await installation("isolated"), failed),
  ).rejects.toBeInstanceOf(ArtifactReaderFailure);
  expect(
    await readGhidraLanguageCatalog(await installation("x86"), scope()),
  ).toEqual([{ id: "x86:LE:32:default", compilerSpecIds: [] }]);
  expect(failed.hasPending).toBe(true);
});

it("attempts every retained close and reports the remaining failures together", async () => {
  const resources = scope();
  const first = control("first.ldefs", {
    closeFails: true,
    synchronizedClose: true,
  });
  const second = control("second.ldefs", {
    closeFails: true,
    synchronizedClose: true,
  });
  barrier.state.expected = 2;
  // Concurrent resolutions can each retain an owner in the same scope.
  const roots = [await installation("first"), await installation("second")];
  const results = await Promise.allSettled(
    roots.map((root) => readGhidraLanguageCatalog(root, resources)),
  );
  expect(results.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
  second.closeFails = false;
  const failure = await readGhidraLanguageCatalog(
    await installation("x86"),
    resources,
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(ArtifactResourceRetryFailure);
  expect(failure).toMatchObject({
    cleanup: { resources: [expect.stringContaining("first.ldefs")] },
  });
  expect(second.closeCalls).toBe(2);
  expect(first.closeCalls).toBe(2);
});

it("keeps the read failure primary when the close also fails", async () => {
  control("damaged.ldefs", { readFails: true, closeFails: true });
  const failure = await readGhidraLanguageCatalog(
    await installation("damaged"),
    scope(),
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(ArtifactReaderFailure);
  expect(failure).toMatchObject({
    message: "definition read failed",
    cleanup: { resources: [expect.stringContaining("damaged.ldefs")] },
  });
});

it("reports retained cleanup for a catalog without definitions", async () => {
  const resources = scope();
  control("pending.ldefs", { closeFails: true });
  await expect(
    readGhidraLanguageCatalog(await installation("pending"), resources),
  ).rejects.toBeInstanceOf(ArtifactReaderFailure);
  const empty = await createTestTempDirectory("rea-ghidra-ldefs-empty-");
  await expect(
    readGhidraLanguageCatalog(empty, resources),
  ).rejects.toMatchObject({
    cleanup: { resources: [expect.stringContaining("pending.ldefs")] },
  });
});

it("retains an invalidated descriptor owner and keeps later reads blocked", async () => {
  const resources = scope();
  const broken = control("broken.ldefs", {
    closeFails: true,
    invalidateOnFailure: true,
  });
  await expect(
    readGhidraLanguageCatalog(await installation("broken"), resources),
  ).rejects.toMatchObject({
    cleanup: { resources: [expect.stringContaining("broken.ldefs")] },
  });
  const later = await readGhidraLanguageCatalog(
    await installation("x86"),
    resources,
  ).catch((cause: unknown) => cause);
  expect(later).toBeInstanceOf(ArtifactResourceRetryFailure);
  expect(later).toMatchObject({
    cleanup: { resources: [expect.stringContaining("broken.ldefs")] },
  });
  // The owner refuses to re-close an invalidated descriptor it never confirmed.
  expect(broken.closeCalls).toBe(1);
  expect(resources.hasPending).toBe(true);
});
