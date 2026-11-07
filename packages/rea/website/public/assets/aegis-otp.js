// Teaching reconstruction of the calculation inspected in Aegis v3.4.3.
// The key is public RFC 6238 test data, not an account credential.
const testKey = new TextEncoder().encode("12345678901234567890");
let importedKey;

/** Generate a code with the public test key and a 30-second time step. */
export async function generateExampleCode(seconds, digits = 6) {
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    ![6, 8].includes(digits)
  ) {
    throw new RangeError(
      "Use a nonnegative integer time and six or eight digits.",
    );
  }
  importedKey ??= crypto.subtle.importKey(
    "raw",
    testKey,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const key = await importedKey;
  const block = Math.floor(seconds / 30);
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(block), false);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = hash[hash.length - 1] & 15;
  const number =
    ((hash[offset] & 127) << 24) |
    ((hash[offset + 1] & 255) << 16) |
    ((hash[offset + 2] & 255) << 8) |
    (hash[offset + 3] & 255);
  return String(number % 10 ** digits).padStart(digits, "0");
}
