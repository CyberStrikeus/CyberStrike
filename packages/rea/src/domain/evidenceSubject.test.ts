import { describe, expect, it } from "vitest";

import { analysisSnapshotSchema } from "./analysisSnapshot.js";
import { BINARY_ARCHITECTURES } from "./binaryTargetTypes.js";
import { evidenceBundleSchema } from "./evidenceBundle.js";
import { evidenceSchema } from "./evidence.js";
import { evidenceSubjectFormatSchema } from "./evidenceSubject.js";

const evidenceSubject = evidenceSchema.shape.subject;
const snapshotSubject =
  analysisSnapshotSchema.shape.entries.element.shape.execution.shape.subject;
const digest = "a".repeat(64);

describe("persisted observation subject declarations", () => {
  it("keeps Evidence and cache admission aligned for every format and architecture", () => {
    for (const format of evidenceSubjectFormatSchema.options) {
      for (const architecture of [
        ...BINARY_ARCHITECTURES,
        null,
        "unsupported",
      ]) {
        const declaration = { format, architecture };
        const evidence = evidenceSubject.safeParse({
          ...declaration,
          name: "fixture",
          local_path: "/tmp/fixture",
          digest: { sha256: digest },
        });
        const snapshot = snapshotSubject.safeParse({
          ...declaration,
          path: "/tmp/fixture",
          sha256: digest,
        });
        const allowed =
          architecture !== "unsupported" &&
          (format === "gamecube-dol"
            ? architecture === "powerpc"
            : format === "raw-binary" ||
              (architecture !== "6502" && architecture !== "m68k"));
        expect(evidence.success, JSON.stringify(declaration)).toBe(allowed);
        expect(snapshot.success, JSON.stringify(declaration)).toBe(allowed);
        const manifest = evidenceBundleSchema.shape.artifacts.element.safeParse(
          {
            ...declaration,
            digest: { sha256: digest },
          },
        );
        expect(manifest.success, JSON.stringify(declaration)).toBe(allowed);
      }
    }
  });

  it("preserves each persistence envelope's handling of additional fields", () => {
    expect(
      evidenceSubject.safeParse({
        format: "pe",
        architecture: null,
        name: "fixture",
        local_path: "/tmp/fixture",
        digest: { sha256: digest },
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      snapshotSubject.parse({
        format: "pe",
        architecture: null,
        path: "/tmp/fixture",
        sha256: digest,
        extra: true,
      }),
    ).not.toHaveProperty("extra");
  });
});
