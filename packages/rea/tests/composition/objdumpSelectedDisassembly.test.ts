import { rm } from "node:fs/promises";
import { expect, it, vi } from "vitest";

import { createArtifact } from "../support/reverseEngineeringCompositionFixtures.js";
import { TestReverseEngineeringService } from "../support/reverseEngineeringService.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";

it("keeps omitted and undefined selection out of default command Evidence", async () => {
  const { directory, path } = await createArtifact();
  const run = vi.fn(async (_command: string, _args: readonly string[]) => ({
    stdout: "complete disassembly\n",
    stderr: "",
  }));
  const service = new TestReverseEngineeringService({ run });
  try {
    for (const selector of [{}, { symbol: undefined }]) {
      const result = await service.inspectWithObjdump({
        path,
        operation: "disassemble",
        ...selector,
      });
      if (!result.ok) throw result.error;
      expect(result.value.parameters).not.toHaveProperty("symbol");
      expect(result.value.parameters.command_arguments).toEqual(["-d", path]);
    }
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "curl_version_info",
  "_Z3foov@@VERSION_1",
  "--leading-option with spaces\nand-newline",
  "native_\u{1F680}_symbol",
  "native_\uFFFD_symbol",
])(
  "preserves native symbol %j as one argument and scoped Evidence",
  async (symbol) => {
    const { directory, path } = await createArtifact();
    const run = vi.fn(async (_command: string, _args: readonly string[]) => ({
      stdout: "selected disassembly\n",
      stderr: "",
    }));
    const service = new TestReverseEngineeringService({ run });
    try {
      const result = await service.inspectWithObjdump({
        path,
        operation: "disassemble",
        symbol,
      });
      if (!result.ok) throw result.error;
      expect(run.mock.calls[0]?.[1]).toEqual([`--disassemble=${symbol}`, path]);
      expect(result.value.parameters).toMatchObject({
        operation: "disassemble",
        symbol,
        command_arguments: [`--disassemble=${symbol}`, path],
      });
      expect(result.value.normalized_result).toMatchObject({
        stdout: "selected disassembly\n",
        output_truncated: false,
        artifact_changed: false,
        completion_status: "complete",
      });
      expect(result.value.limitations).toContain(
        "Disassembly is scoped to the caller-selected symbol using the provider's matching and symbol-boundary semantics; an empty match does not establish artifact-wide absence.",
      );
    } finally {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.each([
  "architectures",
  "file_headers",
  "section_headers",
  "symbols",
  "relocations",
  "dwarf",
  "disassemble_all",
])(
  "rejects symbol selection for %s before reading or launching",
  async (operation) => {
    const digest = vi.fn();
    const run = vi.fn();
    const service = new TestReverseEngineeringService({ digest, run });
    const result = await service.inspectWithObjdump({
      ...(operation === "architectures" ? {} : { path: "/unread-artifact" }),
      operation,
      symbol: "my_function",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
    if (result.ok) throw new Error("Expected selector rejection");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_with_objdump",
        issues: expect.arrayContaining([
          { path: ["symbol"], reason: "unknown_argument" },
        ]),
      },
    });
    expect(digest).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    await service.close();
  },
);

it.each([
  "",
  "a\u0000b",
  "\ud800",
  "\udc00",
  "prefix\ud800suffix",
  "prefix\udc00\ud800suffix",
  null,
  1,
])("rejects invalid symbol %j before artifact admission", async (symbol) => {
  const digest = vi.fn();
  const run = vi.fn();
  const service = new TestReverseEngineeringService({ digest, run });
  const result = await service.inspectWithObjdump({
    path: "/unread-artifact",
    operation: "disassemble",
    symbol,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  expect(digest).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  await service.close();
});
