import { expect, it } from "vitest";
import {
  ArtifactEntryContentUnavailable,
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
} from "../ArtifactReader.js";
import { scanReader } from "./scanReader.js";

const entry: ArtifactEntry = {
  path: "member",
  kind: "file",
  declaredSize: 1,
  compressedSize: null,
  executable: false,
  encrypted: false,
  byteOffset: null,
  declaredIntegrity: null,
  unpacked: true,
  limitations: [],
  adapterKey: "member",
};
const readerFailingWith = (failure: ArtifactReaderFailure): ArtifactReader => ({
  format: "asar",
  async *entries() {
    yield entry;
  },
  async open() {
    throw failure;
  },
  provenance: () => [],
  async close() {},
});

it("retains only producer-declared unavailable content as an unknown inventory fact", async () => {
  const failure = new ArtifactEntryContentUnavailable(
    "content unavailable",
    "Producer content is unsupported.",
    {
      traversal: {
        status: "unknown",
        limitations: ["Producer content is unsupported."],
      },
    },
  );
  const reader = readerFailingWith(failure);
  const result = await scanReader(reader, [reader]);
  expect(result.traversal).toMatchObject({
    status: "unknown",
    limitations: [failure.limitation],
  });
  expect(result.occurrences).toMatchObject([
    { logical_path: "member", artifact_id: null, hash_status: "unavailable" },
  ]);
});

it("keeps known member enumeration complete when only its content is unavailable", async () => {
  const reader = readerFailingWith(
    new ArtifactEntryContentUnavailable(
      "missing companion",
      "Content bytes are unavailable.",
    ),
  );
  const result = await scanReader(reader, [reader]);
  expect(result.traversal.status).toBe("complete");
  expect(result.occurrences).toMatchObject([
    { logical_path: "member", hash_status: "unavailable", artifact_id: null },
  ]);
});

it.each(["closed reader", "content failure with incomplete cleanup"])(
  "propagates a %s rather than treating it as a missing unpacked companion",
  async (kind) => {
    const failure =
      kind === "closed reader"
        ? new ArtifactReaderFailure("unavailable", "reader closed")
        : ArtifactReaderFailure.withCleanup(
            new ArtifactEntryContentUnavailable(
              "content unavailable",
              "Unsupported.",
            ),
            ArtifactReaderFailure.cleanupObservation(
              new Error("close denied"),
              "descriptor",
            ),
          );
    const reader = readerFailingWith(failure);
    await expect(scanReader(reader, [reader])).rejects.toBe(failure);
  },
);
