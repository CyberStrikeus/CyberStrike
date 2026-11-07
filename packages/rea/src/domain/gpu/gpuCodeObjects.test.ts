import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gpuPtxArtifactSchema } from "./gpuCodeObjects.js";
it("binds retained PTX identity to its actual UTF-8 bytes and source extent", () => {
  const text = "\uFEFF// 雪🧪\n.version 8.8\n",
    size = Buffer.byteLength(text);
  const artifact = {
    id: "ptx",
    object_id: "object",
    sha256: createHash("sha256").update(text).digest("hex"),
    media_type: "text/x-ptx",
    encoding: "utf-8",
    byte_length: size,
    text,
    location: {
      container_id: "object",
      offset: 0,
      size,
      section_index: null,
      section_name: null,
    },
  };
  expect(gpuPtxArtifactSchema.safeParse(artifact).success).toBe(true);
  for (const patch of [
    { sha256: "0".repeat(64) },
    { text: text + "changed" },
    { byte_length: size + 1 },
    { location: { ...artifact.location, size: size + 1 } },
    { text: "\ud800" },
  ])
    expect(
      gpuPtxArtifactSchema.safeParse({ ...artifact, ...patch }).success,
    ).toBe(false);
});
