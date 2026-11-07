import { describe, expect, it } from "vitest";

import {
  projectReferenceSourceImportError,
  type ReferenceSourceImportError,
} from "./ReferenceSourceImportTypes.js";
import { analysisErrorProjectionSchema } from "../contracts/errorSchemas.js";
import type { ReferenceSourceRead } from "../reference/ReferenceSourceReaderTypes.js";

describe("reference-source import error projection", () => {
  it("preserves primary evidence with category-specific recovery guidance", () => {
    const expectedCategories = {
      cancelled: "cancelled",
      "invalid-root": "invalid_input",
      unsupported: "unsupported_provider",
      io: "execution_failure",
      parse: "execution_failure",
    } as const;
    for (const [code, category] of Object.entries(expectedCategories)) {
      const projected = projectReferenceSourceImportError({
        tag: "reference-source-import",
        code: code as ReferenceSourceImportError["code"],
        message: "EIO while reading /selected/source/src/main.ts",
      });
      expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
        true,
      );
      expect(projected.category).toBe(category);
      expect(projected.message).toContain(
        "EIO while reading /selected/source/src/main.ts",
      );
      expect(projected.message).toMatch(
        /try again|when ready|Check that|REA on Linux/u,
      );
    }
  });

  it("preserves cancellation, partial facts, and cleanup diagnostics", () => {
    const bytes = Buffer.from("export const observed = true;\n");
    const partial: ReferenceSourceRead = {
      root: "/selected/source",
      entries: [
        {
          status: "read",
          kind: "file",
          path: "src/main.ts",
          bytes,
          size: bytes.length,
        },
      ],
      bytesRead: bytes.length,
      limitations: [],
    };
    const projected = projectReferenceSourceImportError({
      tag: "reference-source-import",
      code: "cancelled",
      message: "Traversal cancelled after reading src/main.ts",
      cleanup: {
        reason: "directory close rejected",
        resources: ["/selected/source"],
      },
      partial,
    });

    expect(projected).toMatchObject({
      category: "cancelled",
      message: expect.stringContaining(
        "Traversal cancelled after reading src/main.ts",
      ),
      code: "cleanup_incomplete",
      details: {
        cleanup: "incomplete",
        cleanup_reason: "directory close rejected",
        resources: ["/selected/source"],
        diagnostics: {
          reference_source_code: "cancelled",
          partial: {
            root: "/selected/source",
            entries: [{ path: "src/main.ts", bytes: Array.from(bytes) }],
          },
        },
      },
    });
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
  });
});
