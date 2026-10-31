import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-f]+$/iu);
const identitySchema = z.object({ address: addressSchema, name: z.string() });
/** Extract one real procedure address from the complete inline inventory. */
export const firstProcedureAddress = (input) => {
  const first = z
    .array(z.object({ address: addressSchema }))
    .min(1)
    .parse(input)[0];
  if (first === undefined) throw new TypeError("Procedure inventory was empty");
  return first.address;
};

/** Reject empty and success-shaped embedded decompilation failures. */
export const requirePseudocode = (input, operation) => {
  if (typeof input !== "string" || input.trim().length === 0)
    throw new TypeError(`${operation} returned empty pseudocode`);
  if (input === "No output" || input.startsWith("Error:"))
    throw new TypeError(`${operation} returned an embedded failure: ${input}`);
  return input;
};

/** Validate a complete Hopper function dossier semantically. */
export const requireFunctionDossier = (input, expectedAddress) => {
  const value = objectValue(
    input,
    "analyze_function returned no function dossier",
  );
  const procedure = identitySchema.parse(value.procedure);
  if (procedure.address !== expectedAddress)
    throw new TypeError("analyze_function returned the wrong procedure");
  if (procedure.name.trim().length === 0)
    throw new TypeError("analyze_function omitted the procedure name");
  requirePseudocode(value.pseudocode, "analyze_function");
  for (const field of COLLECTION_FIELDS) list(value, field);
  for (const field of ["callers", "callees"])
    z.array(identitySchema).parse(list(value, field));
  validateBlocks(list(value, "basic_blocks"));
  return value;
};

/** Reject a structurally valid dossier that omits fixture-proven semantics. */
export const requireFunctionDossierOracle = (input, oracle) => {
  const value = requireFunctionDossier(input, oracle.procedure_address);
  if (oracle.callee_address !== undefined) {
    const callees = z.array(identitySchema).parse(list(value, "callees"));
    if (!callees.some(({ address }) => address === oracle.callee_address))
      throw new TypeError(
        "analyze_function omitted the expected fixture callee",
      );

    const references = z
      .array(
        z.object({
          source_address: addressSchema,
          target_address: addressSchema,
        }),
      )
      .parse(list(value, "outgoing_references"));
    if (
      !references.some(
        ({ target_address }) => target_address === oracle.callee_address,
      )
    )
      throw new TypeError(
        "analyze_function omitted the expected fixture reference",
      );
  }

  if (oracle.caller_address !== undefined) {
    const callers = z.array(identitySchema).parse(list(value, "callers"));
    if (!callers.some(({ address }) => address === oracle.caller_address))
      throw new TypeError(
        "analyze_function omitted the expected fixture caller",
      );
  }

  if (oracle.referenced_string !== undefined)
    requireReferencedValue(
      value,
      "referenced_strings",
      oracle.referenced_string,
      (candidate) => candidate,
    );

  if (oracle.referenced_name !== undefined)
    requireReferencedValue(
      value,
      "referenced_names",
      oracle.referenced_name,
      (candidate) => candidate.replace(/^_+/u, ""),
    );

  if (oracle.comment !== undefined) {
    const comments = z
      .array(
        z.object({
          address: addressSchema,
          kind: z.enum(["comment", "inline"]),
          text: z.string(),
        }),
      )
      .parse(list(value, "comments"));
    if (
      !comments.some(
        ({ address, kind, text }) =>
          address === oracle.procedure_address &&
          kind === "comment" &&
          text === oracle.comment,
      )
    )
      throw new TypeError("analyze_function omitted the verifier comment");
  }

  if (oracle.require_assembly === true && list(value, "assembly").length === 0)
    throw new TypeError("analyze_function omitted fixture assembly");

  if (oracle.require_cfg_successor) {
    const blocks = z
      .array(z.object({ successors: z.array(addressSchema) }))
      .parse(list(value, "basic_blocks"));
    if (!blocks.some(({ successors }) => successors.length > 0))
      throw new TypeError("analyze_function omitted a real CFG successor");
  }
  return value;
};

const referencedValueSchema = z.object({
  address: addressSchema,
  value: z.string(),
  source_address: addressSchema,
});

const referenceEdgeSchema = z.object({
  source_address: addressSchema,
  target_address: addressSchema,
});

const requireReferencedValue = (dossier, field, expected, normalize) => {
  const values = z.array(referencedValueSchema).parse(list(dossier, field));
  const references = z
    .array(referenceEdgeSchema)
    .parse(list(dossier, "outgoing_references"));
  const found = values.some(
    ({ address, value, source_address: sourceAddress }) =>
      normalize(value) === expected &&
      references.some(
        ({ source_address, target_address }) =>
          source_address === sourceAddress && target_address === address,
      ),
  );
  if (!found)
    throw new TypeError(
      `analyze_function omitted the expected fixture ${field === "referenced_strings" ? "string" : "name"}`,
    );
};

/** Require every relationship to be an actual hexadecimal address. */
export const requireAddressArray = (input, operation) => {
  const parsed = z.array(addressSchema).parse(input);
  if (parsed.some((address) => address.length === 0))
    throw new TypeError(`${operation} returned an invalid address list`);
  return parsed;
};

const COLLECTION_FIELDS = [
  "assembly",
  "comments",
  "callers",
  "callees",
  "incoming_references",
  "outgoing_references",
  "referenced_strings",
  "referenced_names",
  "basic_blocks",
];

const list = (value, field) => z.array(z.unknown()).parse(value[field]);

const validateBlocks = (items) => {
  for (const block of items)
    if (!Array.isArray(objectValue(block, "Invalid basic block").successors))
      throw new TypeError("analyze_function omitted CFG successor evidence");
};

const objectValue = (input, message) => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  if (!parsed.success) throw new TypeError(message);
  return parsed.data;
};
