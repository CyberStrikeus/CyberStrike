import { Readable } from "node:stream";
import { expect, it } from "vitest";

import { hashReadable } from "./ArtifactHash.js";

it("preserves cancellation arriving with the final stream result", async () => {
  const controller = new AbortController();
  const reason = { stage: "source-eof" };
  const source = Readable.from(
    (async function* () {
      yield Buffer.from("complete bytes");
      controller.abort(reason);
    })(),
  );

  await expect(hashReadable(source, controller.signal)).rejects.toMatchObject({
    reason: "cancelled",
    cause: reason,
  });
});
