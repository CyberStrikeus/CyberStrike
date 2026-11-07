import { createHash } from "node:crypto";
import { expect, it } from "vitest";

import { browserNetworkBodySchema } from "./browserNetworkEvidence.js";

const bytes = Buffer.from([0xff, 0, 0xfe]);
const retained = {
  state: "captured",
  representation: "browser-decoded-response-bytes",
  encoding: "base64",
  content: bytes.toString("base64"),
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  media_type: null,
  redacted: false,
};

it("validates the actual retained bytes against canonical base64, count, and digest", () => {
  expect(browserNetworkBodySchema.safeParse(retained).success).toBe(true);
  expect(
    browserNetworkBodySchema.safeParse({
      ...retained,
      representation: "playwright-response-body-bytes",
    }).success,
  ).toBe(true);
  for (const mutation of [
    { bytes: 4 },
    { sha256: "0".repeat(64) },
    { content: `${retained.content}\n` },
  ])
    expect(
      browserNetworkBodySchema.safeParse({ ...retained, ...mutation }).success,
    ).toBe(false);
});
