import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";
import {
  acceptedSpawnPayloadBytes,
  assertSpawnArgumentsWithinLimit,
  LINUX_4K_SINGLE_ARGUMENT_BYTES,
} from "../../support/process/spawnArgumentLimit.js";

const minimalSpawnEnvironment = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? "",
  ...(process.platform === "win32"
    ? {
        SystemRoot: process.env.SystemRoot,
        TEMP: tmpdir(),
        TMP: tmpdir(),
      }
    : {}),
});

const linuxGetconf = (name: "PAGE_SIZE" | "ARG_MAX"): number => {
  const raw = execFileSync("getconf", [name], { encoding: "utf8" }).trim();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`unexpected ${name} ${raw}`);
  return value;
};

/** Linux `execve` stores one native pointer per argv and environment string. */
const linuxPointerBytes = (): number =>
  process.arch === "arm" ||
  process.arch === "ia32" ||
  process.arch === "mips" ||
  process.arch === "mipsel"
    ? 4
    : 8;

const execStringBytes = (value: string): number => Buffer.byteLength(value) + 1;

const captureSpawnFailure = async (
  run: () => Promise<unknown>,
): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

processTest(
  "spawns a file path when the payload exceeds the single-argument budget",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-spawn-argument-");
    const payload = "x".repeat(LINUX_4K_SINGLE_ARGUMENT_BYTES + 1);
    const file = join(root, "payload.txt");
    await writeFile(file, payload);
    expect(() => assertSpawnArgumentsWithinLimit([file])).not.toThrow();
    expect(() => assertSpawnArgumentsWithinLimit([payload])).toThrow(/E2BIG/u);
    const result = await processes.run(
      process.execPath,
      ["-e", "process.exit(0)", file],
      { env: minimalSpawnEnvironment(), timeoutMs: 15_000 },
    );
    expect(result.exitCode).toBe(0);
  },
);

it("fits the accepted payload to both the single-string and aggregate budgets", () => {
  const fixedStringBytes = 500;
  const pointerCount = 5;
  const pointerBytes = 8;
  expect(
    acceptedSpawnPayloadBytes({
      pageSize: 4096,
      argMax: 2 * 1024 * 1024,
      pointerBytes,
      pointerCount,
      fixedStringBytes,
    }),
  ).toBe(LINUX_4K_SINGLE_ARGUMENT_BYTES);
  const tight = acceptedSpawnPayloadBytes({
    pageSize: 4096,
    argMax: 32 * 4096,
    pointerBytes,
    pointerCount,
    fixedStringBytes,
  });
  expect(tight).toBe(
    32 * 4096 - pointerCount * pointerBytes - fixedStringBytes - 1,
  );
  expect(tight).toBeLessThan(LINUX_4K_SINGLE_ARGUMENT_BYTES);
  expect(
    acceptedSpawnPayloadBytes({
      pageSize: 4096,
      argMax: 32 * 4096,
      pointerBytes,
      pointerCount,
      fixedStringBytes: 32 * 4096,
    }),
  ).toBeUndefined();
});

it("counts UTF-8 bytes when applying the single-argument budget", () => {
  const argument = "é".repeat(
    Math.ceil((LINUX_4K_SINGLE_ARGUMENT_BYTES + 1) / 2),
  );
  expect(argument.length).toBeLessThanOrEqual(LINUX_4K_SINGLE_ARGUMENT_BYTES);
  expect(Buffer.byteLength(argument)).toBeGreaterThan(
    LINUX_4K_SINGLE_ARGUMENT_BYTES,
  );
  expect(() => assertSpawnArgumentsWithinLimit([argument])).toThrow(/E2BIG/u);
  expect(() =>
    assertSpawnArgumentsWithinLimit([
      "x".repeat(LINUX_4K_SINGLE_ARGUMENT_BYTES),
    ]),
  ).not.toThrow();
});

processTest.skipIf(process.platform !== "linux")(
  "matches the kernel single-argument ceiling through the test process registry",
  async ({ processes }) => {
    const script = "process.exit(0)";
    const environment = minimalSpawnEnvironment();
    const environmentEntries = Object.entries(environment).flatMap(
      ([key, value]) =>
        typeof value === "string" ? [[key, value] as const] : [],
    );
    const pageSize = linuxGetconf("PAGE_SIZE");
    const singleStringBytes = 32 * pageSize - 1;
    expect(LINUX_4K_SINGLE_ARGUMENT_BYTES).toBeLessThanOrEqual(
      singleStringBytes,
    );
    if (pageSize === 4096)
      expect(LINUX_4K_SINGLE_ARGUMENT_BYTES).toBe(singleStringBytes);
    // The filename is copied before argv, so the executable path is counted twice.
    const fixedStringBytes =
      execStringBytes(process.execPath) +
      execStringBytes(process.execPath) +
      execStringBytes("-e") +
      execStringBytes(script) +
      environmentEntries.reduce(
        (sum, [key, value]) => sum + execStringBytes(`${key}=${value}`),
        0,
      );
    const accepted = acceptedSpawnPayloadBytes({
      pageSize,
      argMax: linuxGetconf("ARG_MAX"),
      pointerBytes: linuxPointerBytes(),
      pointerCount: Math.max(4, 1) + environmentEntries.length,
      fixedStringBytes,
    });

    const run = (payloadBytes: number) =>
      processes.run(
        process.execPath,
        ["-e", script, "x".repeat(payloadBytes)],
        { env: environment, timeoutMs: 15_000 },
      );
    if (accepted !== undefined) {
      const result = await run(accepted);
      expect(result.exitCode).toBe(0);
    }
    expect(
      await captureSpawnFailure(() => run(singleStringBytes + 1)),
    ).toMatchObject({
      code: "E2BIG",
    });
    if (accepted !== undefined && accepted < singleStringBytes) {
      expect(await captureSpawnFailure(() => run(accepted + 1))).toMatchObject({
        code: "E2BIG",
      });
    }
  },
);
