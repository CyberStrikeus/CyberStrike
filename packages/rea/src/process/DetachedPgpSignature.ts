import { err, ok, type Result } from "../domain/result.js";

export class DetachedPgpSignatureError extends Error {
  readonly _tag = "DetachedPgpSignatureError";
  constructor(
    readonly reason: "invalid_signature" | "wrong_publisher" | "cancelled",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this._tag;
  }
}

/** Verify the complete binary payload and its signing subkey's primary identity. */
export const verifyDetachedPgpSignature = async (
  bytes: Uint8Array,
  detachedSignature: Uint8Array,
  armoredPublicKey: string,
  primaryFingerprint: string,
  signal?: AbortSignal,
): Promise<
  Result<
    {
      readonly primaryFingerprint: string;
      readonly signingFingerprint: string;
    },
    DetachedPgpSignatureError
  >
> => {
  const cancelled = () =>
    err(
      new DetachedPgpSignatureError(
        "cancelled",
        "Package verification was cancelled.",
        { cause: signal?.reason },
      ),
    );
  const isAborted = () => signal?.aborted === true;
  if (isAborted()) return cancelled();
  try {
    // Keep the cryptographic implementation out of unrelated CLI cold starts.
    const pgp = await import("openpgp");
    const key = await pgp.readKey({ armoredKey: armoredPublicKey });
    if (isAborted()) return cancelled();
    const fingerprint = key.getFingerprint().toUpperCase();
    if (fingerprint !== primaryFingerprint)
      return err(
        new DetachedPgpSignatureError(
          "wrong_publisher",
          "The package signing key does not belong to the pinned publisher.",
        ),
      );
    const signature = await pgp.readSignature({
      binarySignature: detachedSignature,
    });
    if (isAborted()) return cancelled();
    if (
      signature.packets.length !== 1 ||
      signature.packets[0]?.signatureType !== pgp.enums.signature.binary
    )
      return err(
        new DetachedPgpSignatureError(
          "invalid_signature",
          "Expected one detached binary package signature.",
        ),
      );
    const verified = await pgp.verify({
      message: await pgp.createMessage({ binary: bytes }),
      signature,
      verificationKeys: key,
      format: "binary",
    });
    const signed = verified.signatures[0];
    if (signed === undefined || verified.signatures.length !== 1)
      return err(
        new DetachedPgpSignatureError(
          "invalid_signature",
          "The package has no unique verified signature.",
        ),
      );
    await signed.verified;
    const signingKey = await key.getSigningKey(
      signed.keyID,
      signature.packets[0].created,
    );
    if (isAborted()) return cancelled();
    return ok({
      primaryFingerprint: fingerprint,
      signingFingerprint: signingKey.getFingerprint().toUpperCase(),
    });
  } catch (cause: unknown) {
    if (isAborted()) return cancelled();
    return err(
      new DetachedPgpSignatureError(
        "invalid_signature",
        "The package signature could not be verified.",
        { cause },
      ),
    );
  }
};
