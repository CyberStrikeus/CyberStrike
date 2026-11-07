import { z } from "zod";

import type { Evidence } from "./evidence.js";
import type { EvidenceInput } from "./evidenceReference.js";
import { ok, type Result } from "./result.js";

type EvidenceInputDeclaration =
  | { readonly kind: "evidence" }
  | { readonly kind: "borrowed"; readonly owner: object };

// Zod registries carry owner metadata through describe/meta clones. This is a
// schema declaration registry, never a store of caller Evidence or references.
const declarations = z.registry<EvidenceInputDeclaration>();
const borrowedDeclarations = new WeakMap<object, z.ZodType>();

/** Inspect authored declarations, including described clones, for catalog checks. */
export const isDeclaredEvidenceInput = (schema: z.ZodType): boolean =>
  declarations.get(schema) !== undefined;

/** Mark the canonical logical Evidence input, independently of its JSON shape. */
export const declareEvidenceInput = <Schema extends z.ZodType>(
  schema: Schema,
): Schema => {
  declarations.add(schema, { kind: "evidence" });
  return schema;
};

/** Keep an SDK-borrowed selection associated with its owning declaration. */
export const declareBorrowedEvidenceInput = <Schema extends z.ZodType>(
  schema: Schema,
  declaration: z.ZodType,
): Schema => {
  const owner = {};
  borrowedDeclarations.set(owner, declaration);
  declarations.add(schema, { kind: "borrowed", owner });
  return schema;
};

/** The application replaces only declared Evidence inputs, retaining ordinary fields. */
export type ResolvedEvidenceRequestInput<
  Input,
  Seen = never,
> = Input extends EvidenceInput
  ? Evidence
  : Input extends Seen
    ? Input
    : Input extends readonly unknown[]
      ? {
          [Index in keyof Input]: ResolvedEvidenceRequestInput<
            Input[Index],
            Seen | Input
          >;
        }
      : Input extends object
        ? {
            [Key in keyof Input]: ResolvedEvidenceRequestInput<
              Input[Key],
              Seen | Input
            >;
          }
        : Input;

/** Envelope facts are typed; each unadmitted Evidence carrier remains unknown. */
export type EvidenceRequestFrameInput<
  Input,
  Seen = never,
> = Input extends EvidenceInput
  ? unknown
  : Input extends Seen
    ? Input
    : Input extends readonly unknown[]
      ? {
          [Index in keyof Input]: EvidenceRequestFrameInput<
            Input[Index],
            Seen | Input
          >;
        }
      : Input extends object
        ? {
            [Key in keyof Input]: EvidenceRequestFrameInput<
              Input[Key],
              Seen | Input
            >;
          }
        : Input;

export type EvidenceInputPath = readonly (string | number)[];
type Visitor<Failure> = (
  input: unknown,
  path: EvidenceInputPath,
) => Result<unknown, Failure>;

/** A borrowing envelope and the exact Evidence locations derived from one schema. */
export interface EvidenceInputContract<Frame = unknown> {
  readonly frameSchema: z.ZodType<Frame>;
  readonly hasEvidence: boolean;
  resolve<Failure>(
    input: unknown,
    visit: Visitor<Failure>,
    path?: EvidenceInputPath,
  ): Result<unknown, Failure>;
}

const contracts = new WeakMap<z.ZodType, EvidenceInputContract>();
const identity = (schema: z.ZodType): EvidenceInputContract => ({
  frameSchema: schema,
  hasEvidence: false,
  resolve: (input) => ok(input),
});

/**
 * Compile author-owned object/array/union/wrapper declarations once. Inline
 * Evidence is borrowed, not parsed or authenticated here. Unsupported ordinary
 * value schemas stay with their owner; no arbitrary JSON is searched for IDs.
 */
export const getEvidenceInputContract = <Schema extends z.ZodType>(
  schema: Schema,
): EvidenceInputContract<EvidenceRequestFrameInput<z.output<Schema>>> => {
  const existing = contracts.get(schema);
  if (existing !== undefined)
    return existing as EvidenceInputContract<
      EvidenceRequestFrameInput<z.output<Schema>>
    >;
  const result = compile(schema);
  contracts.set(schema, result);
  return result as EvidenceInputContract<
    EvidenceRequestFrameInput<z.output<Schema>>
  >;
};

const compile = (schema: z.ZodType): EvidenceInputContract => {
  const declared = declarations.get(schema);
  if (declared?.kind === "evidence")
    return {
      frameSchema: z.unknown().nonoptional(),
      hasEvidence: true,
      resolve: (input, visit, path = []) => visit(input, path),
    };
  if (declared?.kind === "borrowed") {
    const declaration = borrowedDeclarations.get(declared.owner);
    if (declaration === undefined)
      throw new TypeError("Borrowed Evidence schema has no owning declaration");
    const source = getEvidenceInputContract(declaration);
    return { ...source, frameSchema: schema };
  }
  if (schema instanceof z.ZodObject) return objectContract(schema);
  if (schema instanceof z.ZodArray) return arrayContract(schema);
  if (schema instanceof z.ZodUnion) return unionContract(schema);
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodExactOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodNonOptional ||
    schema instanceof z.ZodReadonly
  ) {
    const child = getEvidenceInputContract(schema.unwrap() as z.ZodType);
    if (!child.hasEvidence) return identity(schema);
    return {
      hasEvidence: true,
      frameSchema: replaceWrappedSchema(schema, child.frameSchema),
      resolve: (input, visit, path = []) =>
        input === undefined ||
        (input === null && schema instanceof z.ZodNullable)
          ? ok(input)
          : child.resolve(input, visit, path),
    };
  }
  return identity(schema);
};

/** Zod's public clone retains the concrete wrapper and its existing checks. */
const replaceWrappedSchema = (
  schema: z.ZodType,
  innerType: z.ZodType,
): z.ZodType => {
  const definition = { ...schema.def, innerType };
  return z.clone(schema, definition, { parent: true });
};

const objectContract = (schema: z.ZodObject): EvidenceInputContract => {
  const children = Object.entries(schema.shape).map(
    ([key, child]) =>
      [key, getEvidenceInputContract(child as z.ZodType)] as const,
  );
  const selected = children.filter(([, child]) => child.hasEvidence);
  if (selected.length === 0) return identity(schema);
  return {
    hasEvidence: true,
    frameSchema: schema.clone(
      {
        ...schema.def,
        shape: Object.fromEntries(
          children.map(([key, child]) => [key, child.frameSchema]),
        ),
      },
      { parent: true },
    ),
    resolve: (input, visit, path = []) => {
      if (typeof input !== "object" || input === null || Array.isArray(input))
        return ok(input);
      let result = input as Readonly<Record<string, unknown>>;
      for (const [key, child] of selected) {
        if (!Object.hasOwn(result, key)) continue;
        const value = child.resolve(result[key], visit, [...path, key]);
        if (!value.ok) return value;
        if (value.value !== result[key])
          result = { ...result, [key]: value.value };
      }
      return ok(result);
    },
  };
};

const arrayContract = (schema: z.ZodArray): EvidenceInputContract => {
  const child = getEvidenceInputContract(schema.element as z.ZodType);
  if (!child.hasEvidence) return identity(schema);
  return {
    hasEvidence: true,
    frameSchema: schema.clone(
      { ...schema.def, element: child.frameSchema },
      { parent: true },
    ),
    resolve: (input, visit, path = []) => {
      if (!Array.isArray(input)) return ok(input);
      let result = input;
      for (const [index, item] of input.entries()) {
        const value = child.resolve(item, visit, [...path, index]);
        if (!value.ok) return value;
        if (value.value !== item) {
          if (result === input) result = input.slice();
          result[index] = value.value;
        }
      }
      return ok(result);
    },
  };
};

const unionContract = (schema: z.ZodUnion): EvidenceInputContract => {
  const options = schema.options.map((option) =>
    getEvidenceInputContract(option as z.ZodType),
  );
  if (!options.some((option) => option.hasEvidence)) return identity(schema);
  // Capture the successful branch while parsing; choosing it again later would
  // repeat defaults, overwrites and refinements. Keys are only parser results.
  const branches = new WeakMap<object, EvidenceInputContract>();
  const frame = z.union(
    options.map((option) =>
      option.frameSchema.transform((value) => {
        if (typeof value === "object" && value !== null)
          branches.set(value, option);
        return value;
      }),
    ),
  );
  return {
    hasEvidence: true,
    frameSchema: frame.clone({
      ...frame.def,
      ...(schema.def.error === undefined ? {} : { error: schema.def.error }),
      ...(schema.def.checks === undefined ? {} : { checks: schema.def.checks }),
    }),
    resolve: (input, visit, path = []) => {
      const selected =
        typeof input === "object" && input !== null
          ? branches.get(input)
          : undefined;
      return selected?.resolve(input, visit, path) ?? ok(input);
    },
  };
};
