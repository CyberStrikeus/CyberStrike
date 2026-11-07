import { expect, it } from "vitest";

import { HopperCancelledError } from "./hopperErrors.js";

it("omits a cause when the caller does not supply one", () => {
  const error = new HopperCancelledError();

  expect(error._tag).toBe("HopperCancelledError");
  expect(error.cause).toBeUndefined();
  expect(Object.hasOwn(error, "cause")).toBe(false);
});

it("retains an explicitly undefined cause separately from omission", () => {
  const error = new HopperCancelledError(undefined, {
    diagnostics: { stage: "queue" },
  });

  expect(error.cause).toBeUndefined();
  expect(Object.hasOwn(error, "cause")).toBe(true);
  expect(error.diagnostics).toEqual({ stage: "queue" });
});

it("retains an opaque caller reason by identity", () => {
  const reason = { source: "caller", opaque: 7 };
  const error = new HopperCancelledError(reason);

  expect(error.cause).toBe(reason);
});
