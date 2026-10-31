/** Full v2/v3 signer framing with opaque, deliberately unverified signatures. */
const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const lp = (bytes: Uint8Array): Buffer =>
  Buffer.concat([u32(bytes.length), bytes]);

export const apkSchemeValue = (
  signedData: Uint8Array,
  sdkRange?: { readonly min: number; readonly max: number },
): Uint8Array => {
  const signature = Buffer.concat([u32(0x0103), lp(Uint8Array.of(1))]);
  const signer = Buffer.concat([
    lp(signedData),
    ...(sdkRange === undefined ? [] : [u32(sdkRange.min), u32(sdkRange.max)]),
    lp(lp(signature)),
    lp(new Uint8Array()),
  ]);
  return lp(lp(signer));
};
