import { z } from "zod";

/** Primitive values admitted into the constant lattice. */
export type JavaScriptSemanticPrimitive = string | number | boolean | null;

/** Resource bound that prevented an exact semantic value. */
export const javaScriptSemanticResourceLimitSchema = z.enum([
  "primitive-candidates",
  "primitive-bytes",
  "expression-depth",
  "getter-expansion",
  "alias-selections",
]);

/** Resource-limit classifications shared by static facts and semantic values. */
export type JavaScriptSemanticResourceLimit = z.infer<
  typeof javaScriptSemanticResourceLimitSchema
>;

type JavaScriptSemanticObjectValue = {
  readonly status: "object";
  readonly properties: readonly JavaScriptSemanticProperty[];
} & (
  | {
      readonly unknownProperties: false;
      readonly omittedProperties: 0;
    }
  | {
      readonly unknownProperties: true;
      readonly omittedProperties: number | null;
    }
);

type JavaScriptSemanticArrayValue = {
  readonly status: "array";
  readonly items: readonly JavaScriptSemanticProperty[];
} & (
  | {
      readonly unknownItems: false;
      readonly omittedItems: 0;
    }
  | {
      readonly unknownItems: true;
      readonly omittedItems: number | null;
    }
);

/** Execution-free value lattice for JavaScript expressions. */
export type JavaScriptSemanticValue =
  | {
      readonly status: "literal";
      readonly value: JavaScriptSemanticPrimitive;
    }
  | {
      readonly status: "union";
      readonly values: readonly JavaScriptSemanticPrimitive[];
    }
  | JavaScriptSemanticObjectValue
  | JavaScriptSemanticArrayValue
  | {
      readonly status: "unknown" | "ambiguous" | "cycle";
      readonly reason: string;
      readonly resourceLimit?: JavaScriptSemanticResourceLimit;
    };

/** One statically named own slot in an object or array. */
export interface JavaScriptSemanticProperty {
  readonly name: string;
  readonly value: JavaScriptSemanticValue;
  readonly presence: JavaScriptSemanticSlotPresence;
}

/** Own-slot presence, independent of its value and sibling coverage. */
export type JavaScriptSemanticSlotPresence =
  | "present"
  | "absent"
  | "unknown-coverage";
