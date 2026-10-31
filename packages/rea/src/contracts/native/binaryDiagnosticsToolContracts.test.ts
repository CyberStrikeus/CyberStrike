import { expect, it } from "vitest";

import { toolContract } from "../toolContracts.js";

const entropy = toolContract("inspect_byte_entropy");

it("warns that complete byte-entropy output can become very large", () => {
  expect(entropy.description).toContain(
    "Complete output can become very large because it includes one row per selected block, and summary detail still retains that full list.",
  );
  expect(entropy.description).toContain(
    "Use a shorter length or a larger block_size",
  );
});

it("keeps the public entropy input closed after detail is added", () => {
  expect(entropy.inputSchema.parse({ path: "/file" })).toMatchObject({
    path: "/file",
    block_size: 4096,
    offset: 0,
    detail: "complete",
  });
  expect(
    entropy.inputSchema.safeParse({
      path: "/file",
      detail: "summary",
      extra: true,
    }).success,
  ).toBe(false);
  expect(
    entropy.inputSchema.safeParse({ path: "/file", block_size: 257 }).success,
  ).toBe(false);
});
