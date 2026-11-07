import { z } from "zod";

/** A DEX field type; hex parentheses also keep the advertised class valid in v mode. */
export const dexTypeSchema = z
  .string()
  .regex(/^\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;)$/u);

/** A DEX prototype; hex parentheses also keep the advertised class valid in v mode. */
export const dexDescriptorSchema = z
  .string()
  .regex(
    /^\((?:\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))*\)(?:V|\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))$/u,
  );
