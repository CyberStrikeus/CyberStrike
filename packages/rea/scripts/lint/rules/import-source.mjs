import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve local import spellings without assigning local meaning to bare or HTTP imports. */
export const resolveImportSource = (filename, specifier) => {
  if (typeof specifier !== "string") return undefined;
  if (isAbsolute(specifier)) return resolve(specifier);
  if (specifier.startsWith("file:")) {
    try {
      const url = new URL(specifier);
      if (url.search !== "" || url.hash !== "") return undefined;
      return fileURLToPath(url);
    } catch {
      return undefined;
    }
  }
  if (specifier.startsWith("./") || specifier.startsWith("../"))
    return resolve(dirname(filename), specifier);
  return undefined;
};
