/** Supported native resource receivers, shared by acquisition and validity owners. */
export const BUILTIN_RESOURCE_METHODS = {
  fs: ["open", "openSync", "createReadStream", "createWriteStream"],
  "fs/promises": ["open"],
  net: ["connect", "createConnection"],
  tls: ["connect"],
} as const;

/**
 * Release methods the value Node returns from each acquisition actually has.
 *
 * `fs.openSync` returns a numeric descriptor and `fs.open` in its callback form
 * returns `undefined`, so neither has a release method at all; the descriptor is
 * released through `fs.closeSync`/`fs.close`, which is not a member call. A
 * `fs.ReadStream` exposes `end` as its byte-offset field, not a method. A
 * `FileHandle` and a `net.Socket`/`TLSSocket` each expose only their own subset,
 * so a family-blind release list claims a teardown that throws instead.
 */
export const BUILTIN_RESOURCE_RELEASE_METHODS = {
  "fs:open": [],
  "fs:openSync": [],
  "fs:createReadStream": ["close", "destroy"],
  "fs:createWriteStream": ["close", "destroy", "end"],
  "fs/promises:open": ["close"],
  "net:connect": ["destroy", "end"],
  "net:createConnection": ["destroy", "end"],
  "tls:connect": ["destroy", "end"],
} as const satisfies Readonly<
  Record<string, readonly ("close" | "destroy" | "end")[]>
>;

export const BUILTIN_RESOURCE_SPECIFIERS = Object.keys(
  BUILTIN_RESOURCE_METHODS,
);
