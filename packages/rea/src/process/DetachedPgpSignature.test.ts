import { beforeAll, describe, expect, it } from "vitest";
import { createMessage, generateKey, readPrivateKey, sign } from "openpgp";

import { verifyDetachedPgpSignature } from "./DetachedPgpSignature.js";

const bytes = Buffer.from("binary package fixture\0\xff", "latin1");
let publicKey: string;
let fingerprint: string;
let signatures: Uint8Array[];
let signingFingerprints: string[];

beforeAll(async () => {
  const generated = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Fixture publisher" }],
    subkeys: [{ sign: true }, { sign: true }],
    format: "armored",
  });
  const privateKey = await readPrivateKey({ armoredKey: generated.privateKey });
  publicKey = generated.publicKey;
  fingerprint = privateKey.getFingerprint().toUpperCase();
  signingFingerprints = privateKey.subkeys.map((subkey) =>
    subkey.getFingerprint().toUpperCase(),
  );
  signatures = [];
  for (const subkey of privateKey.subkeys)
    signatures.push(
      await sign({
        message: await createMessage({ binary: bytes }),
        signingKeys: privateKey,
        signingKeyIDs: [subkey.getKeyID()],
        detached: true,
        format: "binary",
      }),
    );
});

describe("detached binary PGP publisher verification", () => {
  it("accepts independently selected signing subkeys through one pinned primary", async () => {
    for (const [index, signature] of signatures.entries())
      expect(
        await verifyDetachedPgpSignature(
          bytes,
          signature,
          publicKey,
          fingerprint,
        ),
      ).toEqual({
        ok: true,
        value: {
          primaryFingerprint: fingerprint,
          signingFingerprint: signingFingerprints[index],
        },
      });
  });

  it("rejects a valid signature belonging to another primary", async () => {
    expect(
      await verifyDetachedPgpSignature(
        bytes,
        signatures[0]!,
        publicKey,
        "0".repeat(40),
      ),
    ).toMatchObject({ ok: false, error: { reason: "wrong_publisher" } });
  });

  it("rejects tampered payload bytes", async () => {
    const tampered = Buffer.from(bytes);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    expect(
      await verifyDetachedPgpSignature(
        tampered,
        signatures[0]!,
        publicKey,
        fingerprint,
      ),
    ).toMatchObject({ ok: false, error: { reason: "invalid_signature" } });
  });

  it("rejects malformed signatures and public keys", async () => {
    expect(
      await verifyDetachedPgpSignature(
        bytes,
        new Uint8Array([1, 2, 3]),
        publicKey,
        fingerprint,
      ),
    ).toMatchObject({ ok: false, error: { reason: "invalid_signature" } });
    expect(
      await verifyDetachedPgpSignature(
        bytes,
        signatures[0]!,
        "malformed",
        fingerprint,
      ),
    ).toMatchObject({ ok: false, error: { reason: "invalid_signature" } });
  });

  it("preserves cancellation", async () => {
    expect(
      await verifyDetachedPgpSignature(
        bytes,
        signatures[0]!,
        publicKey,
        fingerprint,
        AbortSignal.abort(),
      ),
    ).toMatchObject({ ok: false, error: { reason: "cancelled" } });
  });

  it.each([null, "caller stop", { phase: "publisher-key" }])(
    "preserves the caller's exact abort reason %j as the cancellation cause",
    async (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      const result = await verifyDetachedPgpSignature(
        bytes,
        signatures[0]!,
        publicKey,
        fingerprint,
        controller.signal,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "cancelled" },
      });
      expect(result.ok ? undefined : result.error.cause).toBe(reason);
    },
  );

  it("preserves cancellation while loading the publisher key, before classifying its identity", async () => {
    const controller = new AbortController();
    const verification = verifyDetachedPgpSignature(
      bytes,
      signatures[0]!,
      publicKey,
      "0".repeat(40),
      controller.signal,
    );
    queueMicrotask(() => controller.abort());
    expect(await verification).toMatchObject({
      ok: false,
      error: { reason: "cancelled" },
    });
  });
});
