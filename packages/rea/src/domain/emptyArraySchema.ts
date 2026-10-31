import { z } from "zod";

/** An empty array whose JSON Schema is valid under Draft 2020-12. */
export const emptyArraySchema = z.array(z.never()).length(0);
