import { z } from "zod";

/** Scalar view of CBOR; uninterpreted containers remain in original bytecode. */
export const solidityMetadataScalarSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: z.string().max(65535) }),
  z.strictObject({
    kind: z.literal("integer"),
    value: z
      .string()
      .max(21)
      .regex(/^-?(?:0|[1-9][0-9]*)$/),
  }),
  z.strictObject({
    kind: z.literal("bytes"),
    value: z
      .string()
      .max(131070)
      .regex(/^(?:[a-f0-9]{2})*$/),
  }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("null") }),
  z.strictObject({
    kind: z.literal("uninterpreted"),
    container: z.enum(["array", "map"]),
  }),
]);

/** A trailer candidate, not authentication of Solidity origin or deployment. */
export const solidityMetadataSchema = z
  .strictObject({
    profile: z.literal("terminal-cbor-scalars-v1"),
    status: z.enum(["unavailable", "decoded", "partial", "not-decoded"]),
    bytecode_offset: z.int().nonnegative().nullable(),
    cbor_bytes: z.int().positive().max(65535).nullable(),
    entries: z
      .array(
        z.strictObject({
          key: solidityMetadataScalarSchema,
          value: solidityMetadataScalarSchema,
        }),
      )
      .max(32767),
    compiler_version: z
      .strictObject({
        representation: z.enum(["release-bytes", "prerelease-text"]),
        value: z.string().min(1).max(65535),
      })
      .nullable(),
    diagnostic: z.string().max(512).nullable(),
    admission: z
      .strictObject({
        code: z.string().min(1).max(64),
        detail: z
          .record(
            z.string().min(1).max(64),
            z.union([z.string().max(512), z.number()]),
          )
          .optional(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    const unavailable = value.status === "unavailable";
    if (
      unavailable
        ? value.bytecode_offset !== null || value.cbor_bytes !== null
        : value.bytecode_offset === null || value.cbor_bytes === null
    )
      context.addIssue({
        code: "custom",
        message: "Only unavailable metadata omits the candidate range.",
      });
    const unexamined = unavailable || value.status === "not-decoded";
    if (
      unexamined &&
      (value.entries.length !== 0 || value.compiler_version !== null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Unavailable interpretation cannot report decoded entries or compiler identity.",
      });
    const uninterpreted = value.entries.some(
      ({ key, value: entryValue }) =>
        key.kind === "uninterpreted" || entryValue.kind === "uninterpreted",
    );
    if (
      (value.status === "decoded" && uninterpreted) ||
      (value.status === "partial" && !uninterpreted)
    )
      context.addIssue({
        code: "custom",
        message: "Scalar coverage must preserve uninterpreted containers.",
      });
  });

export type SolidityMetadata = z.infer<typeof solidityMetadataSchema>;
export type SolidityMetadataScalar = z.infer<
  typeof solidityMetadataScalarSchema
>;
