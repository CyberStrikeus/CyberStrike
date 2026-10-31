import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { HopperCancelledError } from "../domain/hopperErrors.js";
import { connectHopperSocketOnce } from "./HopperSocketConnection.js";

it("retains the caller abort reason when the socket signal is already aborted", async () => {
  const reason = { source: "caller", opaque: 7 };
  const controller = new AbortController();
  controller.abort(reason);
  const result = await connectHopperSocketOnce(
    join(tmpdir(), "rea-hopper-cancelled.sock"),
    controller.signal,
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toBeInstanceOf(HopperCancelledError);
  expect(result.error.cause).toBe(reason);
});
