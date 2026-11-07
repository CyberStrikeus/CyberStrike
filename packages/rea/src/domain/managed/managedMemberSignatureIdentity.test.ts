import { describe, expect, it } from "vitest";
import { signatureIdentity } from "./managedMemberSignatureIdentity.js";

type Signature = Parameters<typeof signatureIdentity>[0];

const digest = "ab".repeat(32);
const signature = (raw: string, resolved: string | null) =>
  ({ raw_sha256: raw, resolved_sha256: resolved }) as Signature;

describe("managed signature identity", () => {
  it("keeps a raw digest apart from an equal resolved digest", () => {
    // An undecodable blob can hold another signature's resolved preimage, so
    // its raw digest can equal that signature's resolved digest.
    expect(signatureIdentity(signature(digest, null))).not.toBe(
      signatureIdentity(signature("cd".repeat(32), digest)),
    );
  });

  it("matches resolved digests and raw digests among themselves", () => {
    expect(signatureIdentity(signature("01".repeat(32), digest))).toBe(
      signatureIdentity(signature("02".repeat(32), digest)),
    );
    expect(signatureIdentity(signature(digest, null))).toBe(
      signatureIdentity(signature(digest, null)),
    );
  });
});
