import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { parseCliJsonInput } from "../../../src/cliJsonInput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { failFileReadAfterAbort } from "../../support/failFileReadAfterAbort.js";

it("reports an already-cancelled inline JSON read as cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    await parseCliJsonInput('{"value":1}', "test-input", controller.signal),
  ).toMatchObject({
    ok: false,
    error: { code: "cancelled", details: { operation: "test-input" } },
  });
});

it("cancels a pending regular-file JSON read through the owning reader", async () => {
  const root = await createTestTempDirectory("rea-json-input-cancel-");
  const path = join(root, "input.json");
  await writeFile(path, '{"value":1}');
  const controller = new AbortController();
  const result = parseCliJsonInput(path, "test-input", controller.signal);
  controller.abort();
  expect(await result).toMatchObject({
    ok: false,
    error: { code: "cancelled", details: { operation: "test-input" } },
  });
});

it.each([
  { label: "undefined", physical: undefined },
  { label: "null", physical: null },
])(
  "classifies a physical $label read rejection before late cancellation",
  async ({ physical }) => {
    const root = await createTestTempDirectory("rea-json-input-late-io-");
    const path = join(root, "input.json");
    await writeFile(path, '{"value":1}');
    const controller = new AbortController();
    await failFileReadAfterAbort(
      path,
      controller,
      new Error("later cancellation"),
      physical,
    );
    try {
      expect(
        await parseCliJsonInput(path, "test-input", controller.signal),
      ).toMatchObject({
        ok: false,
        error: {
          code: "invalid_request",
          input_reason: "read-failed",
          details: { operation: "test-input" },
        },
      });
    } finally {
      vi.restoreAllMocks();
    }
  },
);

it("keeps a physical rejection when it is the identical object used to abort", async () => {
  const root = await createTestTempDirectory("rea-json-input-identical-abort-");
  const path = join(root, "input.json");
  await writeFile(path, '{"value":1}');
  const controller = new AbortController();
  const physical = Object.assign(new Error("descriptor EIO"), { code: "EIO" });
  await failFileReadAfterAbort(path, controller, physical, physical);
  try {
    expect(
      await parseCliJsonInput(path, "test-input", controller.signal),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        input_reason: "read-failed",
        details: {
          operation: "test-input",
          issues: [{ message: expect.stringContaining("EIO") }],
        },
      },
    });
  } finally {
    vi.restoreAllMocks();
  }
});

it("cancels cooperative sealing of an owned inline Evidence input", async () => {
  const controller = new AbortController();
  const input = JSON.stringify(
    Array.from({ length: 20000 }, () => ({ value: 1 })),
  );
  const pending = parseCliJsonInput(input, "test-input", controller.signal, {
    snapshot: true,
  });
  controller.abort();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "cancelled" },
  });
});
