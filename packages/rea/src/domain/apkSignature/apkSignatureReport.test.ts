import { inspectApkSignatureInputSchema } from "./apkSignatureQuery.js";
import { describe, expect, it } from "vitest";

import {
  apkSignatureResultSchema,
  deriveApkPosture,
  type ApkPostureInput,
  type ApkPostureLineage,
  type ApkPostureSigner,
} from "./apkSignatureReport.js";

const base: ApkPostureInput = {
  v1Present: false,
  v2Present: false,
  v3Present: false,
  v31Present: false,
  sourceStampPresent: false,
  blockSchemes: [],
  v1SignerFingerprints: [],
  selfConsistent: null,
};

const absent: ApkPostureLineage = { kind: "absent" };
const signer = (
  fingerprint: string | null,
  lineage: ApkPostureLineage = absent,
): ApkPostureSigner => ({ fingerprint, lineage });
const decoded = (...fingerprints: (string | null)[]): ApkPostureLineage => ({
  kind: "decoded",
  fingerprints,
});
/** Signers per block scheme, lowest first: v2, v3, v3.1. */
const blocks = (
  ...schemes: (string | null | ApkPostureSigner)[][]
): ApkPostureInput["blockSchemes"] =>
  (["v2", "v3", "v3.1"] as const).map((scheme, index) => ({
    scheme,
    signers: (schemes[index] ?? []).map((s) =>
      typeof s === "object" && s !== null ? s : signer(s),
    ),
  }));
const derive = (input: Partial<ApkPostureInput>) =>
  deriveApkPosture({ ...base, ...input }).posture;

it("does not attribute unchanged multi-signer sets to rotation", () => {
  const result = derive({
    v2Present: true,
    v3Present: true,
    blockSchemes: blocks(
      ["aa", "bb"],
      [signer("bb", decoded("aa", "bb")), "aa"],
    ),
  });
  expect(result.schemes_agree_on_signer).toBe(true);
  expect(result.signer_change_declared_by_rotation).toBe(false);
});

it.each(["v3", "v3.1"] as const)(
  "keeps a missing %s signer identity unknown despite a readable lineage",
  (scheme) => {
    const result = derive({
      v1Present: true,
      v3Present: scheme === "v3",
      v31Present: scheme === "v3.1",
      blockSchemes: [
        { scheme, signers: [signer(null, decoded("old", "new"))] },
      ],
      v1SignerFingerprints: ["old"],
    });
    expect(result.v1_signers_match_block_signers).toBeNull();
  },
);

describe("deriveApkPosture", () => {
  it("includes present empty signer sets when comparing declared schemes", () => {
    expect(
      derive({
        v2Present: true,
        v3Present: true,
        blockSchemes: blocks([], ["aa"]),
      }).schemes_agree_on_signer,
    ).toBe(false);
    expect(
      derive({ v2Present: true, blockSchemes: blocks([]) })
        .schemes_agree_on_signer,
    ).toBeNull();
  });
  it("flags v1-only when only JAR signing is present", () => {
    const p = derive({ v1Present: true });
    expect(p.v1_only).toBe(true);
    expect(p.strongest_scheme).toBe("v1");
    expect(p.schemes_agree_on_signer).toBeNull();
  });

  it("picks the strongest scheme and is not v1-only when v3 is present", () => {
    const p = derive({
      v1Present: true,
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["aa"], ["aa"]),
    });
    expect(p.v1_only).toBe(false);
    expect(p.strongest_scheme).toBe("v3");
    expect(p.schemes_agree_on_signer).toBe(true);
  });

  it("observes different signers across schemes as disagreement", () => {
    const p = derive({
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["aa"], ["bb"]),
    });
    expect(p.schemes_agree_on_signer).toBe(false);
  });

  it("keeps observed disagreement separate from a declared rotation", () => {
    const p = derive({
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["old"], [signer("new", decoded("old", "new"))]),
    });
    expect(p.schemes_agree_on_signer).toBe(false);
    expect(p.signer_change_declared_by_rotation).toBe(true);
    expect(p.rotation_present).toBe(true);
  });

  it("does not credit rotation when a signer is missing from the lineage", () => {
    const p = derive({
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["evil"], [signer("new", decoded("old", "new"))]),
    });
    expect(p.signer_change_declared_by_rotation).toBe(false);
  });

  it("leaves a declared signer change unknown when a lineage or identity is unknown", () => {
    const undecoded: ApkPostureLineage = { kind: "undecoded" };
    const changed = { v2Present: true, v3Present: true };
    expect(
      derive({
        ...changed,
        blockSchemes: blocks(["old"], [signer("new", undecoded)]),
      }).signer_change_declared_by_rotation,
    ).toBeNull();
    expect(
      derive({
        ...changed,
        blockSchemes: blocks(["old"], [signer(null, decoded("old"))]),
      }).signer_change_declared_by_rotation,
    ).toBeNull();
    // An undecoded lineage cannot hide a change when the signers agree.
    expect(
      derive({
        ...changed,
        blockSchemes: blocks(["same"], [signer("same", undecoded)]),
      }).signer_change_declared_by_rotation,
    ).toBe(false);
  });

  it("leaves agreement unknown when a signer carries no certificate", () => {
    const p = derive({
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["aa"], [null]),
    });
    expect(p.schemes_agree_on_signer).toBeNull();
  });

  it("compares signer sets, so an extra signer in one scheme is a disagreement", () => {
    const p = derive({
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["aa", "bb"], ["aa"]),
    });
    expect(p.schemes_agree_on_signer).toBe(false);
    const same = derive({
      v2Present: true,
      v3Present: true,
      blockSchemes: blocks(["bb", "aa"], ["aa", "bb"]),
    });
    expect(same.schemes_agree_on_signer).toBe(true);
  });

  it("surfaces rotation, source stamp and self-consistency", () => {
    const p = derive({
      v3Present: true,
      sourceStampPresent: true,
      blockSchemes: blocks([], [signer("aa", decoded("aa"))]),
      selfConsistent: true,
    });
    expect(p.rotation_present).toBe(true);
    expect(p.source_stamp_present).toBe(true);
    expect(p.self_consistent).toBe(true);
  });

  it("accepts only an absolute path; schema is strict", () => {
    expect(
      inspectApkSignatureInputSchema.safeParse({ path: "/a/b.apk" }).success,
    ).toBe(true);
    expect(
      inspectApkSignatureInputSchema.safeParse({ path: "/a/b.apk", extra: 1 })
        .success,
    ).toBe(false);
    // The result schema rejects unknown keys (sanity that strictObject holds).
    expect(apkSignatureResultSchema.safeParse({}).success).toBe(false);
  });
});

describe("deriveApkPosture v1 comparison", () => {
  const v1 = (
    v1SignerFingerprints: (string | null)[],
    ...schemes: (string | null | ApkPostureSigner)[][]
  ) =>
    deriveApkPosture({
      ...base,
      v1Present: true,
      v2Present: (schemes[0]?.length ?? 0) > 0,
      v3Present: (schemes[1]?.length ?? 0) > 0,
      v31Present: (schemes[2]?.length ?? 0) > 0,
      blockSchemes: blocks(...schemes),
      v1SignerFingerprints,
    });

  it("compares v1 signers with the lowest block scheme that has signers", () => {
    const match = (...args: Parameters<typeof v1>) =>
      v1(...args).posture.v1_signers_match_block_signers;
    expect(match(["aa"], ["aa"], ["aa"])).toBe(true);
    // A rotated v3 signer does not hide that v1 and v2 agree.
    expect(
      match(["old"], ["old"], [signer("new", decoded("old", "new"))]),
    ).toBe(true);
    // The JAR signature naming another key is a mismatch, not agreement.
    expect(match(["other"], ["aa"], ["aa"])).toBe(false);
    // Without v2 or a lineage the comparison falls to the v3 signer itself.
    expect(match(["aa"], [], ["aa"])).toBe(true);
    expect(match(["aa", "bb"], ["aa"])).toBe(false);
    // Unknown identity on either side stays unknown.
    expect(match([null], ["aa"])).toBeNull();
    expect(match(["aa"], [null])).toBeNull();
    // v1-only or no v1: nothing to compare.
    expect(
      derive({ v1Present: true, v1SignerFingerprints: ["aa"] })
        .v1_signers_match_block_signers,
    ).toBeNull();
    expect(
      derive({ v2Present: true, blockSchemes: blocks(["aa"]) })
        .v1_signers_match_block_signers,
    ).toBeNull();
  });

  it("compares v1 with a v3 lineage's original certificate when v2 is absent", () => {
    // Rotated v1 + v3 without v2: v1 keeps the original key, v3 the newest.
    const rotated = v1(["old"], [], [signer("new", decoded("old", "new"))]);
    expect(rotated.posture.v1_signers_match_block_signers).toBe(true);
    expect(rotated.notes).toEqual([]);
    // v1 signed with the newest key is not the lineage origin apksig requires.
    expect(
      v1(["new"], [], [signer("new", decoded("old", "new"))]).posture
        .v1_signers_match_block_signers,
    ).toBe(false);
    // The same holds for v3.1 when it is the lowest scheme with signers.
    expect(
      v1(["old"], [], [], [signer("new", decoded("old", "mid", "new"))]).posture
        .v1_signers_match_block_signers,
    ).toBe(true);
  });

  it("explains unknown identities on both sides without repeating reasons", () => {
    const result = v1([null], [null, null]);
    expect(result.posture.v1_signers_match_block_signers).toBeNull();
    expect(result.notes).toEqual([
      "v1_signers_match_block_signers is null: one or more v1 signer identities are unknown; inspect the v1 signer records for details.",
      "v1_signers_match_block_signers is null: one or more v2 signer identities are unknown; inspect the block signer records for details.",
    ]);
    expect(v1(["aa"], ["aa"]).notes).toEqual([]);
  });

  it("leaves the v1 comparison unknown, with a reason, when the lineage origin is unknown", () => {
    for (const lineage of [
      { kind: "undecoded" } as const,
      decoded(),
      decoded(null, "new"),
    ]) {
      const unknown = v1(["old"], [], [signer("new", lineage)]);
      expect(unknown.posture.v1_signers_match_block_signers).toBeNull();
      expect(unknown.notes).toHaveLength(1);
      expect(unknown.notes[0]).toMatch(
        /^v1_signers_match_block_signers is null: the v3 signer's declared rotation lineage/,
      );
    }
  });
});

it.each([true, false, null])(
  "compares v1 against populated v3 despite empty v2: %s",
  (expected) => {
    const result = derive({
      v1Present: true,
      v2Present: true,
      v3Present: true,
      v1SignerFingerprints: ["old"],
      blockSchemes: blocks(
        [],
        [
          signer(
            "new",
            expected === null
              ? { kind: "undecoded" }
              : decoded(expected ? "old" : "other", "new"),
          ),
        ],
      ),
    });
    expect(result.v1_signers_match_block_signers).toBe(expected);
    expect(result.schemes_agree_on_signer).toBe(false);
  },
);
