import { describe, expect, it } from "vitest";
import type { BinaryTarget } from "../../../src/domain/binaryTargetTypes.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import {
  createAnalysisSnapshotEntry,
  parseAnalysisSnapshot,
  serializeAnalysisSnapshot,
  snapshotBinding,
  snapshotTarget,
  snapshotMatchesProfile,
} from "../../../src/domain/analysisSnapshot.js";
import { sessionOutputSchemas } from "../../../src/contracts/toolOutputSchemaGroups.js";

const target: BinaryTarget = {
  path: "/source-owned.elf",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "elf",
  architecture: "mips",
  availableArchitectures: ["mips"],
  mips: { elfClass: 32, byteOrder: "little", type: 2, flags: 0x70001001 },
};
const provider = { id: "ghidra", name: "Ghidra", version: "12.1.4" };
const profile = createAnalysisProfile(provider, {
  mips_elf: { elf_class: 32, byte_order: "little", type: 2, flags: 0x70001001 },
});

describe("MIPS identity through lifecycle, Evidence and snapshot consumers", () => {
  it("round-trips query bindings without relaxing integrity", () => {
    const result = [{ address: "0x20150", value: "rea_mips_entry" }];
    const parameters = {};
    const evidence = createEvidence(target, provider, {
      operation: "list_procedures",
      parameters,
      result,
      analysisProfile: profile,
    });
    const binding = snapshotBinding(profile);
    const entry = createAnalysisSnapshotEntry({
      target: snapshotTarget(target),
      binding,
      operation: "list_procedures",
      parameters,
      execution: {
        result,
        rawResult: null,
        provider,
        analysisProfile: profile,
        limitations: [],
        locations: [],
        subject: target,
      },
    });
    const snapshot = {
      target: snapshotTarget(target),
      binding,
      entries: [entry],
      workflow_entries: [],
      evidence_bundle: createEvidenceBundle([evidence]),
    };
    const restored = parseAnalysisSnapshot(
      JSON.parse(serializeAnalysisSnapshot(snapshot)),
    );
    expect(restored.target.architecture).toBe("mips");
    expect(restored.evidence_bundle.records[0]?.subject?.architecture).toBe(
      "mips",
    );
    expect(restored.entries[0]?.execution.subject?.architecture).toBe("mips");
    expect(
      sessionOutputSchemas.open_binary.parse({ result: target }).result
        .architecture,
    ).toBe("mips");
    expect(() =>
      parseEvidence({
        ...evidence,
        subject: { ...evidence.subject, architecture: "x86" },
      }),
    ).toThrow("semantic identifier");
    const changed = createAnalysisProfile(provider, {
      mips_elf: {
        elf_class: 32,
        byte_order: "big",
        type: 2,
        flags: 0x70001001,
      },
    });
    expect(snapshotMatchesProfile(binding, changed)).toBe(false);
  });
});
