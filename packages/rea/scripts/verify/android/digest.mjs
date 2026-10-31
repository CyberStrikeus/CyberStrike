import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Verify artifact identity without depending on private runtime snapshot helpers. */
export const hashAndroidFile = async (path) => {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
};
