import { Cli } from "incur";
import pino from "pino";
import { expect, it, vi } from "vitest";
import { registerCoreNativeCommands } from "../../../src/cli/coreNativeCommands.js";

const registry = () => {
  const run = vi.fn(async () => ({
    ok: false as const,
    error: { code: "invalid_request", message: "Admitted query control" },
  }));
  const cli = Cli.create("byte-admission", { sync: false });
  registerCoreNativeCommands(cli, pino({ enabled: false }), run);
  return { cli, run };
};

it.each([
  { pattern: "??", mask: undefined, field: "pattern" },
  { pattern: "ZZ", mask: undefined, field: "pattern" },
  { pattern: "", mask: undefined, field: "pattern" },
  { pattern: "AB", mask: "FFFF", field: "mask" },
  { pattern: "AB", mask: "00", field: "pattern" },
])(
  "rejects $pattern/$mask before any target access",
  async ({ pattern, mask, field }) => {
    const { cli, run } = registry();
    let stdout = "";
    await cli.serve(
      [
        "search-bytes",
        "/missing-target",
        pattern,
        ...(mask === undefined ? [] : ["--mask", mask]),
        "--json",
      ],
      {
        stdout: (text) => {
          stdout += text;
        },
        exit: () => undefined,
      },
    );
    expect(run).not.toHaveBeenCalled();
    expect(JSON.parse(stdout)).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "search_bytes",
        issues: [
          expect.objectContaining({ path: [field], reason: "invalid_value" }),
        ],
      },
    });
  },
);

it("forwards admitted original strings and caller-selected search/provider controls", async () => {
  const { cli, run } = registry();
  await cli.serve(
    [
      "search-bytes",
      "/selected",
      "ab ?? CD",
      "--mask",
      "FF 00 ff",
      "--start",
      "0x10",
      "--end",
      "0x20",
      "--cursor",
      "next",
      "--limit",
      "7",
      "--provider",
      "ghidra",
      "--json",
    ],
    { stdout: () => undefined, exit: () => undefined },
  );
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "/selected",
    "search_bytes",
    {
      pattern: "ab ?? CD",
      mask: "FF 00 ff",
      start: "0x10",
      end: "0x20",
      cursor: "next",
      limit: 7,
    },
    expect.objectContaining({ providerId: "ghidra" }),
  );
});

it("keeps an omitted mask omitted", async () => {
  const { cli, run } = registry();
  await cli.serve(["search-bytes", "/selected", "AB", "--json"], {
    stdout: () => undefined,
    exit: () => undefined,
  });
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "/selected",
    "search_bytes",
    { pattern: "AB", limit: 100 },
    expect.any(Object),
  );
});
