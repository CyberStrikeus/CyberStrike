import { appendFile, open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { machoImage } from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import type { AnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { inspectMachoSchema } from "../../../../src/domain/native/nativeInspection.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

/** A thin arm64 image whose LC_ENCRYPTION_INFO_64 marks 0x4000-0x8000 as ciphertext. */
const encryptedImage = (): Uint8Array => {
  const command = new Uint8Array(24);
  const view = new DataView(command.buffer);
  view.setUint32(0, 0x2c, true);
  view.setUint32(4, 24, true);
  view.setUint32(8, 0x4000, true);
  view.setUint32(12, 0x4000, true);
  view.setUint32(16, 1, true);
  const bytes = new Uint8Array(0x10000);
  bytes.set(machoImage({ commands: [command] }));
  return bytes;
};

const writeTarget = async () => {
  const root = await createTestTempDirectory("rea-native-macho-encryption-");
  const path = join(root, "fixture.macho");
  await writeFile(path, encryptedImage());
  return path;
};

const thinLipo = { lipo: "Non-fat file: fixture is architecture: arm64\n" };

const inspect = async (
  path: string,
  runner: NativeFixtureRunner = new NativeFixtureRunner(thinLipo),
) => {
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    await nativeMachoTargetForFile(path),
  );
  onTestFinished(async () => {
    await client.close();
  });
  return { client, result: await client.execute("inspect_macho", {}) };
};

it("reads encryption from the bound file and names the ciphertext bytes", async () => {
  const { result } = await inspect(await writeTarget());
  if (!result.ok) throw result.error;
  const report = inspectMachoSchema.parse(result.value.result);
  expect(report.encryption).toMatchObject({
    total: 1,
    exhaustive: true,
    items: [
      {
        status: "encrypted",
        container_file_offset: 0,
        range: { content: "ciphertext", container_start: 0x4000 },
      },
    ],
  });
  expect(result.value.limitations).toContain(
    "Bytes 16384-32768 (input file offsets, end exclusive) of the arm64 slice are ciphertext (cryptid 1); disassembly, decompilation, strings and references derived from them do not describe program code.",
  );
});

/** Replay fixture output while appending to the target once lipo reads it. */
class MutatingRunner extends NativeFixtureRunner {
  constructor(private readonly path: string) {
    super(thinLipo);
  }

  override async run(tool: string, arguments_: readonly string[]) {
    if (tool === "lipo") await appendFile(this.path, "changed");
    return super.run(tool, arguments_);
  }
}

it("refuses facts when the file changes while the tools inspect it", async () => {
  const path = await writeTarget();
  const { result } = await inspect(path, new MutatingRunner(path));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a changed-artifact refusal");
  expect(result.error).toMatchObject({
    _tag: "AnalysisArtifactChangedError",
    cleanupIncomplete: false,
  });
});

/** Make only the admitted descriptor's close reject until released. */
const failingClose = async (onClosed?: () => void) => {
  const probe = await open(await writeTarget(), "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const state = { failing: onClosed === undefined, attempts: 0 };
  const original = prototype.stat;
  const stat = vi
    .spyOn(prototype, "stat")
    .mockImplementationOnce(async function (
      this: FileHandle,
      ...args: Parameters<FileHandle["stat"]>
    ) {
      const release = this.close.bind(this);
      this.close = async () => {
        state.attempts += 1;
        if (state.failing) throw new Error("macho target close failed");
        await release();
        onClosed?.();
      };
      return Reflect.apply(original, this, args);
    });
  onTestFinished(() => {
    stat.mockRestore();
    state.failing = false;
  });
  return state;
};

/** The finished report survives a failure that arrives after the read completed. */
const expectRetainedReport = (error: AnalysisError) => {
  const report = inspectMachoSchema.parse(
    (error.partialObservation as { normalized_result?: unknown } | undefined)
      ?.normalized_result,
  );
  expect(report.encryption.items).toMatchObject([{ status: "encrypted" }]);
  expect(projectAnalysisError(error).details?.partial_observation).toEqual(
    error.partialObservation,
  );
};

it("retains the target descriptor when close rejects and retries it on client close", async () => {
  const path = await writeTarget();
  const state = await failingClose();
  const { client, result } = await inspect(path);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected the close failure");
  expect(result.error).toBeInstanceOf(ProviderCleanupError);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual([path]);
  expect(state.attempts).toBe(1);
  expectRetainedReport(result.error);

  expect((await client.close()).ok).toBe(false);
  expect(state.attempts).toBe(2);
  state.failing = false;
  expect((await client.close()).ok).toBe(true);
  expect(state.attempts).toBe(3);
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("keeps the inspection failure primary when the descriptor close also rejects", async () => {
  const path = await writeTarget();
  const state = await failingClose();
  const { client, result } = await inspect(path, new MutatingRunner(path));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected change and close failures");
  expect(result.error).toBeInstanceOf(ProviderCleanupError);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual([path]);
  expect(result.error.cleanupPrimary?._tag).toBe(
    "AnalysisArtifactChangedError",
  );
  expect(result.error.partialObservation).toBeUndefined();

  state.failing = false;
  expect((await client.close()).ok).toBe(true);
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("reports cancellation that arrives during the final close without retaining the descriptor", async () => {
  const path = await writeTarget();
  const controller = new AbortController();
  const reason = { caller: "macho-final-close" };
  await failingClose(() => controller.abort(reason));
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(thinLipo),
    "darwin",
  ).createClient(await nativeMachoTargetForFile(path));
  onTestFinished(async () => {
    await client.close();
  });
  const result = await client.execute(
    "inspect_macho",
    {},
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected final-close cancellation");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cleanupIncomplete: false,
  });
  expectRetainedReport(result.error);
});
