import { expect, it, vi } from "vitest";

import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { DecodedNdjsonLineBuffer } from "../process/DecodedNdjsonLineBuffer.js";
import { PendingOperations } from "../process/PendingOperations.js";
import { GhidraResponseRouter } from "./GhidraResponseRouter.js";
import { GhidraSessionError } from "./GhidraSessionError.js";

it("routes later Ghidra response lines after an unknown response id", async () => {
  const pending = new PendingOperations<
    number,
    Result<JsonValue, GhidraSessionError>
  >();
  const protocolFailure = vi.fn();
  const router = new GhidraResponseRouter({
    pending,
    nextId: () => 2,
    remoteFailure: (failure) =>
      new GhidraSessionError(
        "remote",
        failure.message,
        {},
        {
          remoteCode: failure.code,
        },
      ),
    protocolFailure: (message, cause) =>
      protocolFailure(
        new GhidraSessionError("protocol", message, {}, { cause }),
      ),
  });
  const response = pending.wait(1, {
    cancelledValue: () =>
      err(new GhidraSessionError("cancelled", "request cancelled")),
  });
  const lines = new DecodedNdjsonLineBuffer();

  for (const line of lines.push(
    '{"id":2,"ok":true,"result":null}\n{"id":1,"ok":true,"result":"settled"}\n',
  ))
    router.route(line);

  expect(protocolFailure).toHaveBeenCalledOnce();
  expect(protocolFailure).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "protocol" }),
  );
  await expect(response).resolves.toEqual(ok("settled"));
});
