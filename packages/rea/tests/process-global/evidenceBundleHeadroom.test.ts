import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../src/domain/evidenceBundle.js";

const HEADROOM_MODULE = "../../src/application/JsonAuthenticationHeadroom.js";

afterEach(() => {
  vi.doUnmock(HEADROOM_MODULE);
  vi.resetModules();
});

/** The reader bound to the real budget, measured against a heap that holds 1024 bytes. */
const readerUnderStarvedHeap = async () => {
  vi.resetModules();
  vi.doMock(HEADROOM_MODULE, async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/application/JsonAuthenticationHeadroom.js")
      >();
    return {
      ...actual,
      requireAuthenticationHeadroom: (
        value: unknown,
        options: Parameters<typeof actual.requireAuthenticationHeadroom>[1],
      ) =>
        actual.requireAuthenticationHeadroom(value, {
          ...options,
          availableBytes: 1024,
        }),
    };
  });
  return import("../../src/application/EvidenceBundleFiles.js");
};

describe("evidence bundle import headroom", () => {
  it("refuses to authenticate a bundle the live heap cannot hold", async () => {
    const path = join(
      await createTestTempDirectory("rea-evidence-bundle-headroom-"),
      "bundle.json",
    );
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: {},
        result: { text: "y".repeat(10_000) },
      },
    );
    await writeFile(path, JSON.stringify(createEvidenceBundle([record])));
    const { readEvidenceBundle } = await readerUnderStarvedHeap();
    expect(await readEvidenceBundle(path)).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        operation: "import_evidence_bundle",
        resource: "memory",
        reportedLimits: {
          input_path: path,
          available_heap_bytes: 1024,
        },
      },
    });
  });
});
