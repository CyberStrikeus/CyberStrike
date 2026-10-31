import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "rejects a headerless image until architecture and entry are supplied",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-raw-cli-");
    const path = join(root, "ecu.bin");
    await writeFile(path, Buffer.from("1eff2fe1", "hex"));
    const before = await cli.run({
      arguments: ["inspect", path, "--json"],
      environment: {
        HOME: root,
        XDG_CONFIG_HOME: root,
        XDG_CACHE_HOME: root,
      },
    });
    expect(before.exitCode).not.toBe(0);
    expect(JSON.stringify(before.json)).not.toContain("raw-binary");
    const missing = await cli.run({
      arguments: ["inspect", path, "--target-format", "raw-binary", "--json"],
      environment: {
        HOME: root,
        XDG_CONFIG_HOME: root,
        XDG_CACHE_HOME: root,
      },
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.json).toMatchObject({
      code: "invalid_request",
      details: { reason: expect.stringContaining("architecture") },
    });
  },
);

cliTest(
  "rejects a 6502 image crossing the 16-bit boundary before provider startup",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-6502-cli-overflow-");
    const path = join(root, "image.bin");
    await writeFile(path, Buffer.from("a92a60", "hex"));
    const result = await cli.run({
      arguments: [
        "inspect",
        path,
        "--target-format",
        "raw-binary",
        "--architecture",
        "6502",
        "--entry-point",
        "0xffff",
        "--provider",
        "ghidra",
        "--json",
      ],
      environment: { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: { reason: expect.stringContaining("6502 address width") },
    });
  },
);

cliTest.for([
  ["arm64", "c0035fd6", "0x8000001", "must be 4-byte aligned"],
  ["m68k", "4e75", "0x1001", "must be 2-byte aligned"],
] as const)(
  "rejects an unaligned %s entry before provider startup",
  async ([architecture, bytes, entryPoint, reason], { cli }) => {
    const root = await createTestTempDirectory("rea-raw-cli-alignment-");
    const path = join(root, "image.bin");
    await writeFile(path, Buffer.from(bytes, "hex"));
    const result = await cli.run({
      arguments: [
        "inspect",
        path,
        "--target-format",
        "raw-binary",
        "--architecture",
        architecture,
        "--entry-point",
        entryPoint,
        "--provider",
        "ghidra",
        "--json",
      ],
      environment: { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: { reason: expect.stringContaining(reason) },
    });
  },
);

cliTest(
  "stops Hopper from claiming a caller-supplied raw-binary image",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-raw-cli-hopper-");
    const path = join(root, "ecu.bin");
    await writeFile(path, Buffer.from("1eff2fe1", "hex"));
    const result = await cli.run({
      arguments: [
        "inspect",
        path,
        "--target-format",
        "raw-binary",
        "--architecture",
        "arm",
        "--entry-point",
        "0x8000000",
        "--provider",
        "hopper",
        "--json",
      ],
      environment: {
        HOME: root,
        XDG_CONFIG_HOME: root,
        XDG_CACHE_HOME: root,
      },
    });
    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result.json)).toMatch(/Hopper|ghidra|Ghidra|hopper/i);
    expect(JSON.stringify(result.json)).not.toMatch(
      /unsupported binary format/i,
    );
  },
);
