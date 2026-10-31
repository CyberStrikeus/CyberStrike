import { expect, it } from "vitest";

import {
  createReferenceSourcePathLookup,
  decodeReferenceSourceModuleUrlPath,
} from "./referenceSourcePathIdentity.js";

it("reports ambiguous canonical identities while preserving exact paths", () => {
  const first = "package/a\u0301\u0323/package.json";
  const second = "package/a\u0323\u0301/package.json";
  const third = "package/\u1ea1\u0301/package.json";
  const lookup = createReferenceSourcePathLookup([first, second]);

  expect(lookup.has(third)).toBe(true);
  expect(lookup.resolve(third)).toBeUndefined();
  expect(lookup.resolve(first)).toBe(first);
  expect(lookup.resolve(second)).toBe(second);
});

it.each([
  ["literal%5Cdir/dep.js", "literal\\dir/dep.js"],
  ["literal%255Cdir/dep.js", "literal%5Cdir/dep.js"],
  ["literal%252Fdir/dep.js", "literal%2Fdir/dep.js"],
])("decodes historical inventory bytes once: %s", (encoded, path) => {
  expect(decodeReferenceSourceModuleUrlPath(encoded)).toEqual({
    ok: true,
    value: path,
  });
});

it.each(["dir%2Fdep.js", "dir%2fdep.js", "dir/%00dep.js", "dir/%invalid.js"])(
  "refuses malformed historical module paths: %s",
  (encoded) => {
    expect(decodeReferenceSourceModuleUrlPath(encoded).ok).toBe(false);
  },
);
