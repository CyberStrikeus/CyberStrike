import { isAbsolute, basename } from "node:path";
import { z } from "zod";

/** A single expanded local project marker; archives must be restored first. */
export const ghidraProjectPathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "Ghidra project path must be absolute")
  .refine(
    (path) => path.endsWith(".gpr") && basename(path).length > 4,
    "Select an expanded .gpr project marker; restore .grez archives first",
  );

/** Headless -process accepts globs and flags; this workflow selects one root program. */
export const ghidraProgramNameSchema = z
  .string()
  .min(1)
  .refine(
    (name) =>
      name.trim().length > 0 &&
      !name.startsWith("-") &&
      !/[\\/\0*?]/u.test(name),
    "Select one exact program name in the project root, without paths, flags or wildcards",
  );

export interface GhidraProjectSelection {
  readonly path: string;
  readonly programName?: string;
}
