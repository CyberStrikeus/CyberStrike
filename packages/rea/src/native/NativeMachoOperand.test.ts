import { mkdtemp, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../tests/fixtures/nativeCommands.js";
import { NativeMacOSProvider } from "./NativeMacOSProvider.js";
import type { NativeCallTracer } from "./LldbCallTracer.js";
import { NativeCommandFailure } from "./CommandRunner.js";
import { inspectMachoSchema } from "../domain/native/nativeInspection.js";
import { err, ok } from "../domain/result.js";
import { VTOOL_CONTAINER_REFUSAL_LIMITATION } from "./NativeMachoInspection.js";

const targetDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    targetDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
/** A FAT container whose arm64 row matches the canned lipo fixture. */
const parenthesizedFatTarget = () => {
  const bytes = Buffer.alloc(40_960);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(2, 4);
  const slices = [
    { cpu: 0x01000007, subtype: 3, offset: 16_384, size: 4_096, align: 14 },
    { cpu: 0x0100000c, subtype: 0, offset: 32_768, size: 8_192, align: 14 },
  ];
  for (const [index, slice] of slices.entries()) {
    const at = 8 + index * 20;
    bytes.writeUInt32BE(slice.cpu, at);
    bytes.writeUInt32BE(slice.subtype, at + 4);
    bytes.writeUInt32BE(slice.offset, at + 8);
    bytes.writeUInt32BE(slice.size, at + 12);
    bytes.writeUInt32BE(slice.align, at + 16);
  }
  const header = bytes.subarray(32_768, 32_800);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  return bytes;
};
const parenthesizedTarget = async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-macho-target-"));
  targetDirectories.push(directory);
  const path = join(directory, "app(foo)");
  await writeFile(path, parenthesizedFatTarget());
  return { directory, target: await nativeMachoTargetForFile(path) };
};

const tracer: NativeCallTracer = {
  trace: async () => {
    throw new Error("unexpected trace");
  },
  close: async () => ({ ok: true, value: null }),
};

describe("private otool operand lifecycle", () => {
  it("uses a private alias for native commands and removes it after all commands settle", async () => {
    const path = await mkdtemp(join(tmpdir(), "rea-macho-operand-test-"));
    const selected = await parenthesizedTarget();
    const target = selected.target.path;
    const calls: { tool: string; operand: string | undefined }[] = [];
    const fixture = new NativeFixtureRunner();
    const runner = {
      async run(tool: string, args: readonly string[]) {
        calls.push({ tool, operand: args.at(-1) });
        if (args.at(-1) === join(path, "artifact.macho"))
          expect(await readlink(args.at(-1)!)).toBe(target);
        return fixture.run(tool, args);
      },
    };
    const client = new NativeMacOSProvider(
      {},
      runner,
      "darwin",
      () => tracer,
      async () => ({
        path,
        close: async () => {
          await rm(path, { recursive: true, force: true });
        },
      }),
    ).createClient(selected.target);
    try {
      const result = await client.execute("inspect_macho", {});
      if (!result.ok) throw result.error;
      const alias = join(path, "artifact.macho");
      const report = inspectMachoSchema.parse(result.value.result);
      expect(
        report.provenance
          .find((entry) => entry.tool === "lipo")
          ?.command.at(-1),
      ).toBe(alias);
      expect(calls.some(({ operand }) => operand === alias)).toBe(true);
      expect(calls.some(({ operand }) => operand === target)).toBe(false);
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await client.close();
      await rm(path, { recursive: true, force: true });
      await rm(selected.directory, { recursive: true, force: true });
    }
  });

  it("keeps completed Mach-O facts when vtool refuses the private alias", async () => {
    const path = await mkdtemp(join(tmpdir(), "rea-macho-operand-test-"));
    const selected = await parenthesizedTarget();
    const target = selected.target.path;
    const alias = join(path, "artifact.macho");
    const fixture = new NativeFixtureRunner();
    const runner = {
      async run(tool: string, args: readonly string[]) {
        const captured = await fixture.run(tool, args);
        if (!captured.ok || tool !== "vtool") return captured;
        const operand = args.at(-1);
        const stderr = `/usr/bin/vtool error: ${operand} file is not mach-o\n`;
        return ok({
          ...captured.value,
          stdout: "",
          stdoutBytes: 0,
          stderr,
          stderrBytes: Buffer.byteLength(stderr),
          exitCode: 1,
          signal: null,
        });
      },
    };
    const client = new NativeMacOSProvider(
      {},
      runner,
      "darwin",
      () => tracer,
      async () => ({
        path,
        close: async () => {
          await rm(path, { recursive: true, force: true });
        },
      }),
    ).createClient(selected.target);
    try {
      const result = await client.execute("inspect_macho", {});
      if (!result.ok) throw result.error;
      const report = inspectMachoSchema.parse(result.value.result);
      expect(report).toMatchObject({
        format: "mach-o-universal",
        selected_architecture: {
          name: "arm64",
          container_file_offset: 32_768,
        },
      });
      const vtool = report.provenance.find((entry) => entry.tool === "vtool");
      expect(vtool).toMatchObject({
        exit: { code: 1, signal: null },
      });
      expect(vtool?.command.at(-1)).toBe(alias);
      expect(report.limitations).toContain(VTOOL_CONTAINER_REFUSAL_LIMITATION);
      expect(
        report.provenance.find((entry) => entry.tool === "lipo"),
      ).toMatchObject({ exit: { code: 0, signal: null } });
      expect(target.endsWith("app(foo)")).toBe(true);
    } finally {
      await client.close();
      await rm(path, { recursive: true, force: true });
      await rm(selected.directory, { recursive: true, force: true });
    }
  });
});

describe("private operand command cleanup", () => {
  it("retains the alias until command cleanup is confirmed", async () => {
    const path = await mkdtemp(join(tmpdir(), "rea-macho-operand-test-"));
    let unresolved = true;
    class Runner extends NativeFixtureRunner {
      async retryCleanup() {
        if (unresolved) throw new Error("command remains owned");
        return [];
      }
    }
    const client = new NativeMacOSProvider(
      {},
      new Runner(),
      "darwin",
      () => tracer,
      async () => ({
        path,
        close: async () => {
          await rm(path, { recursive: true, force: true });
        },
      }),
    ).createClient((await parenthesizedTarget()).target);
    try {
      const result = await client.execute("inspect_macho", {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected cleanup failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.partialObservation).toMatchObject({
        format: "mach-o-universal",
      });
      expect((await stat(path)).isDirectory()).toBe(true);
      expect((await client.close()).ok).toBe(false);
      expect((await stat(path)).isDirectory()).toBe(true);
      unresolved = false;
      expect((await client.close()).ok).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(false);
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      unresolved = false;
      await client.close();
      await rm(path, { recursive: true, force: true });
    }
  });
});

describe("private otool operand cleanup", () => {
  it.each([false, true])(
    "preserves exact failed output with cleanup failure %s",
    async (cleanupFails) => {
      const path = await mkdtemp(join(tmpdir(), "rea-macho-operand-test-"));
      const message = `lipo failed for ${join(path, "artifact.macho")}\n`;
      const fixture = new NativeFixtureRunner();
      const runner = {
        async run(tool: string, args: readonly string[]) {
          if (tool === "lipo")
            return err(
              new NativeCommandFailure("lipo", "nonzero-exit", 1, undefined, {
                stdout: "",
                stderr: message,
                stdoutBytes: 0,
                stderrBytes: Buffer.byteLength(message),
                exitCode: 1,
                signal: null,
                truncated: false,
              }),
            );
          return fixture.run(tool, args);
        },
      };
      let attempts = 0;
      const client = new NativeMacOSProvider(
        {},
        runner,
        "darwin",
        () => tracer,
        async () => ({
          path,
          close: async () => {
            if (cleanupFails && ++attempts === 1)
              throw new Error("fixture cleanup refusal");
            await rm(path, { recursive: true, force: true });
          },
        }),
      ).createClient((await parenthesizedTarget()).target);
      try {
        const result = await client.execute("inspect_macho", {});
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected native failure");
        expect(result.error.capturedOutput?.stderr).toBe(message);
        expect(result.error.cleanupIncomplete).toBe(cleanupFails);
        if (cleanupFails) {
          expect(result.error.cleanupResources).toContain(path);
          expect((await client.close()).ok).toBe(true);
          expect(result.error.cleanupIncomplete).toBe(false);
        }
      } finally {
        await client.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  );

  it("retains a failed root cleanup and retries it on close", async () => {
    const path = await mkdtemp(join(tmpdir(), "rea-macho-operand-test-"));
    let attempts = 0;
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => tracer,
      async () => ({
        path,
        close: async () => {
          if (++attempts < 2) throw new Error("fixture cleanup refusal");
          await rm(path, { recursive: true, force: true });
        },
      }),
    ).createClient((await parenthesizedTarget()).target);
    try {
      const result = await client.execute("inspect_macho", {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected cleanup failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toContain(path);
      expect((await stat(path)).isDirectory()).toBe(true);
      expect((await client.close()).ok).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      await client.close();
      await rm(path, { recursive: true, force: true });
    }
  });

  it("reports cancellation during final root cleanup", async () => {
    const path = await mkdtemp(join(tmpdir(), "rea-macho-operand-test-"));
    const controller = new AbortController();
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => tracer,
      async () => ({
        path,
        close: async () => {
          controller.abort("cancelled while removing alias");
          await rm(path, { recursive: true, force: true });
        },
      }),
    ).createClient((await parenthesizedTarget()).target);
    try {
      const result = await client.execute(
        "inspect_macho",
        {},
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.partialObservation).toMatchObject({
        format: "mach-o-universal",
      });
    } finally {
      await client.close();
      await rm(path, { recursive: true, force: true });
    }
  });
});
