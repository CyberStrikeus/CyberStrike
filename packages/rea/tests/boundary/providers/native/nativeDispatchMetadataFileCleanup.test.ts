import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

/** Open a real target and make only its admitted descriptor's close reject until released. */
const fixture = async (bindActualDigest: boolean, admissionFailure?: Error) => {
  const root = await createTestTempDirectory("rea-native-dispatch-close-");
  const path = join(root, "fixture.macho");
  await writeFile(path, "bound target bytes");
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const target = bindActualDigest
    ? await nativeMachoTargetForFile(path)
    : nativeMachoTarget(path);
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner({}),
    "darwin",
  ).createClient(target);
  const state = { failing: true, attempts: 0 };
  let release: (() => Promise<void>) | undefined;
  const original = prototype.stat;
  const stat = vi
    .spyOn(prototype, "stat")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["stat"]>
    ) {
      release = this.close.bind(this);
      this.close = async () => {
        state.attempts += 1;
        if (state.failing) throw new Error("dispatch target close failed");
        await release!();
      };
      if (admissionFailure !== undefined) throw admissionFailure;
      return Reflect.apply(original, this, args);
    });
  onTestFinished(async () => {
    stat.mockRestore();
    state.failing = false;
    await client.close();
  });
  return { client, path, state };
};

it("keeps the integrity failure primary and retains the target descriptor when close rejects", async () => {
  const { client, path, state } = await fixture(false);

  const result = await client.execute("inspect_native_dispatch_metadata", {});
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected integrity and close failures");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual([path]);
  expect(result.error.cleanupPrimary?._tag).toBe("EvidenceIntegrityError");
  expect(state.attempts).toBe(1);

  // Client close retries the exact retained descriptor without reopening it.
  const held = await client.close();
  expect(held.ok).toBe(false);
  expect(state.attempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(true);

  state.failing = false;
  expect((await client.close()).ok).toBe(true);
  expect(state.attempts).toBe(3);
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("reports a completed read whose close rejects as retained cleanup", async () => {
  const { client, path, state } = await fixture(true);

  const result = await client.execute("inspect_native_dispatch_metadata", {});
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected the close failure");
  expect(result.error).toBeInstanceOf(ProviderCleanupError);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual([path]);
  expect(result.error.cleanupPrimary).toBeUndefined();

  state.failing = false;
  expect((await client.close()).ok).toBe(true);
  expect(state.attempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(false);
});

it.each([
  { code: "ENOENT", tag: "AnalysisArtifactChangedError" },
  { code: "EACCES", tag: "AnalysisAccessDeniedError" },
])(
  "retains the physical $code admission failure through close denial and retry",
  async ({ code, tag }) => {
    const physical = Object.assign(new Error(`admission ${code}`), { code });
    const { client, path, state } = await fixture(true, physical);
    const result = await client.execute("inspect_native_dispatch_metadata", {});
    if (result.ok) throw new Error("Expected admission and cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([path]);
    expect(result.error.cleanupPrimary?._tag).toBe(tag);
    expect(result.error.cleanupPrimary?.cause).toBe(physical);
    state.failing = false;
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupPrimary?._tag).toBe(tag);
  },
);
