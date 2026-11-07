import { isProxy } from "node:util/types";

import { AnalysisInputError } from "../analysisErrorCore.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { MAX_JSON_DEPTH } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";

// Covers cloned member slots and per-member validation/entries/map scratch.
const MEMBER_BYTES = 256;
const CONTAINER_BYTES = 512;
const textBytes = (length: number): number => 32 + length * 14;

/** Inspect borrowed data without invoking accessors; only API-surface reserves bytes. */
export const admitAnalysisViewData = (
  value: unknown,
  inline: boolean,
  reserve?: (bytes: number) => Result<void, AnalysisError>,
): Result<void, AnalysisError> => {
  const ancestors = new Set<object>();
  // A single bounded stack preserves diagnostics without per-node path copies.
  const path: (string | number)[] = inline
    ? ["source", "evidence"]
    : ["source"];
  const invalid = (): Result<never, AnalysisError> =>
    err(
      new AnalysisInputError("inspect_analysis_view", undefined, [
        {
          path: [...path],
          reason: "invalid_value",
          message:
            "Parent data must contain bounded ordinary JSON data without cycles or accessors.",
        },
      ]),
    );
  const visit = (item: unknown, depth: number): Result<void, AnalysisError> => {
    // Proxy reflection and callable constructor metadata can execute caller code.
    if (isProxy(item) || typeof item === "function") return invalid();
    // Capture records add three levels before reported; inline Evidence adds one.
    if (
      depth > MAX_JSON_DEPTH + (inline ? 4 : 3) ||
      (typeof item === "object" && item !== null && ancestors.has(item))
    )
      return invalid();
    const member = reserve?.(
      MEMBER_BYTES +
        (inline && typeof item === "string" ? textBytes(item.length) : 0) +
        (typeof item === "object" && item !== null ? CONTAINER_BYTES : 0),
    );
    if (member !== undefined && !member.ok) return member;
    if (typeof item !== "object" || item === null) return ok(undefined);
    ancestors.add(item);
    const child = (key: string | number): Result<void, AnalysisError> => {
      path.push(key);
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      const admitted =
        descriptor === undefined || !Object.hasOwn(descriptor, "value")
          ? invalid()
          : visit(descriptor.value, depth + 1);
      path.pop();
      return admitted;
    };
    // Walk depth-first without copying the graph. Aliases are examined each time
    // the schema copies them, so byte reservations retain the same accounting.
    if (Array.isArray(item)) {
      // JSON validation iterates arrays and cloning calls map (which reads
      // constructor/species). Reject those traversal overrides without building
      // an input-sized key list. Other array metadata is omitted by JSON cloning.
      if (
        Object.getPrototypeOf(item) !== Array.prototype ||
        Object.hasOwn(item, Symbol.iterator) ||
        Object.hasOwn(item, "map") ||
        Object.hasOwn(item, "constructor")
      )
        return invalid();
      for (let index = 0; index < item.length; index += 1) {
        const admitted = child(index);
        if (!admitted.ok) return admitted;
      }
    } else {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null)
        return invalid();
      // Zod reads named fields even when they are non-enumerable.
      for (const key of Object.getOwnPropertyNames(item)) {
        // Authentication hashes strings and keys alongside the schema clone.
        const keyAdmission = inline
          ? reserve?.(textBytes(key.length))
          : undefined;
        if (keyAdmission !== undefined && !keyAdmission.ok) return keyAdmission;
        const admitted = child(key);
        if (!admitted.ok) return admitted;
      }
    }
    ancestors.delete(item);
    return ok(undefined);
  };
  return visit(value, 0);
};
