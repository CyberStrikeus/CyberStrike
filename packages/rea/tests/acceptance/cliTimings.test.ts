import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { elfNoteFixture } from "../../src/native/elf/ElfNotes.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const timingRecord = (stderr: string) => {
  const lines = stderr.trim().split("\n");
  expect(lines).toHaveLength(1);
  const record: unknown = JSON.parse(lines[0]!);
  expect(record).toMatchObject({
    rea_timings: { version: 1, command_ms: expect.any(Number) },
  });
  const duration = (record as { rea_timings: { command_ms: number } })
    .rea_timings.command_ms;
  expect(Number.isFinite(duration)).toBe(true);
  expect(duration).toBeGreaterThanOrEqual(0);
};

cliTest(
  "writes opt-in command timing to stderr after success and failure without changing JSON stdout",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-cli-timings-");
    const valid = join(root, "program");
    const invalid = join(root, "truncated");
    await writeFile(valid, elfNoteFixture({ ownership: "program" }));
    await writeFile(invalid, Buffer.from("ELF"));

    const defaultRun = await cli.run({
      arguments: ["inspect-elf-notes", valid, "--json"],
    });
    expect(defaultRun.exitCode, defaultRun.stderr).toBe(0);
    expect(defaultRun.stderr).not.toContain("rea_timings");

    const successful = await cli.run({
      arguments: ["--timings", "inspect-elf-notes", valid, "--json"],
    });
    expect(successful.exitCode, successful.stderr).toBe(0);
    expect(successful.json).toMatchObject({
      normalized_result: { coverage: { status: "complete" } },
    });
    expect(successful.stdout).toBe(defaultRun.stdout);
    timingRecord(successful.stderr);

    const defaultFailure = await cli.run({
      arguments: ["inspect-elf-notes", invalid, "--json"],
    });
    expect(defaultFailure.exitCode).toBe(1);
    const failed = await cli.run({
      arguments: ["inspect-elf-notes", invalid, "--json", "--timings"],
    });
    expect(failed.exitCode).toBe(1);
    expect(failed.json).toMatchObject({ code: "invalid_request" });
    expect(failed.stdout).toBe(defaultFailure.stdout);
    timingRecord(failed.stderr);
  },
);

cliTest(
  "preserves formatted root version output when timings are requested",
  async ({ cli }) => {
    const plain = await cli.run({ arguments: ["--version", "--json"] });
    const timed = await cli.run({
      arguments: ["--timings", "--version", "--json"],
    });
    expect(plain.exitCode).toBe(0);
    expect(plain.json).toBeTypeOf("object");
    expect(timed.exitCode).toBe(0);
    expect(timed.stdout).toBe(plain.stdout);
    expect(timed.stderr).toBe("");
  },
);
