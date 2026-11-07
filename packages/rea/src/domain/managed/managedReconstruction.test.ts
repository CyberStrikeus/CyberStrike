import { describe, expect, it } from "vitest";

import { createEvidence } from "../evidence.js";
import { managedReconstructionImportInputSchema } from "./managedReconstruction.js";

describe("managed reconstruction import input", () => {
  it("accepts more than the former 50-method and 100-note ceilings", () => {
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: {},
      },
    );
    const method = {
      token: "0x06000001",
      signature_sha256: "a".repeat(64),
      normalized_il_sha256: null,
      reconstruction: {
        kind: "semantic-pseudocode",
        language: "pseudocode",
        text: "return;",
      },
    };

    const parsed = managedReconstructionImportInputSchema.parse({
      static_members: evidence,
      decompiler: {
        name: "Fixture decompiler",
        family: "other",
        options: Array.from({ length: 51 }, (_, index) => `option-${index}`),
      },
      methods: Array.from({ length: 51 }, (_, index) => ({
        ...method,
        token: `0x${(0x06000001 + index).toString(16).padStart(8, "0")}`,
        signature_sha256: index.toString(16).padStart(64, "0"),
      })),
      notes: Array.from({ length: 101 }, (_, index) => `note-${index}`),
    });

    expect(parsed.methods).toHaveLength(51);
    expect(parsed.decompiler.options).toHaveLength(51);
    expect(parsed.decompiler).toMatchObject({
      version: null,
      executable_sha256: null,
    });
    expect(parsed.notes).toHaveLength(101);
  });

  it("accepts decompiler text and metadata without arbitrary length ceilings", () => {
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: {},
      },
    );
    const text = "x".repeat(65_537);
    const metadata = "m".repeat(4_097);

    const result = managedReconstructionImportInputSchema.parse({
      static_members: evidence,
      decompiler: {
        name: metadata,
        version: metadata,
        family: "other",
        executable_sha256: null,
        options: ["o".repeat(513)],
      },
      methods: [
        {
          token: "0x06000001",
          signature_sha256: "a".repeat(64),
          normalized_il_sha256: null,
          reconstruction: {
            kind: "semantic-pseudocode",
            language: "pseudocode",
            text,
            source_path: metadata,
          },
        },
      ],
      notes: [metadata],
    });

    expect(result.methods[0]?.reconstruction.text).toHaveLength(65_537);
    expect(result.decompiler.name).toHaveLength(4_097);
  });
});
