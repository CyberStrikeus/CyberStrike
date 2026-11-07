import { createHash } from "node:crypto";

import { z } from "zod";

/** Metadata shared by complete and summarized retained web text artifacts. */
export const webTextArtifactMetadataSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.int().min(0),
  media_type: z.string().min(1),
  charset: z.literal("utf-8"),
});

/** Self-verifying text artifact used by web-source analysis boundaries. */
export const webTextArtifactSchema = webTextArtifactMetadataSchema
  .extend({ text: z.string() })
  .superRefine((artifact, context) => {
    const bytes = Buffer.byteLength(artifact.text);
    const digest = createHash("sha256").update(artifact.text).digest("hex");
    if (artifact.bytes !== bytes)
      context.addIssue({
        code: "custom",
        path: ["bytes"],
        message: "Byte count mismatch",
      });
    if (artifact.sha256 !== digest)
      context.addIssue({
        code: "custom",
        path: ["sha256"],
        message: "Digest mismatch",
      });
  });
export type WebTextArtifact = z.infer<typeof webTextArtifactSchema>;

/** Build an immutable content-addressed UTF-8 text artifact. */
export const createWebTextArtifact = (
  text: string,
  mediaType: string,
): WebTextArtifact => {
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    sha256,
    bytes: Buffer.byteLength(text),
    media_type: mediaType,
    charset: "utf-8",
    text,
  };
};
