import { describe, expect, it } from "vitest";

import { urlDeclaresQueryOrFragment } from "./urlComponents.js";

describe("URL query and fragment spelling", () => {
  it("treats an explicit empty query or fragment as present", () => {
    expect(urlDeclaresQueryOrFragment(new URL("https://a.test/main.js"))).toBe(
      false,
    );
    expect(
      urlDeclaresQueryOrFragment(new URL("https://a.test/%3Ffile.js")),
    ).toBe(false);
    for (const value of [
      "https://a.test/main.js?",
      "https://a.test/main.js#",
      "https://a.test/main.js?#",
      "https://a.test/main.js?v=1",
      "https://a.test/main.js#part",
    ])
      expect(urlDeclaresQueryOrFragment(new URL(value)), value).toBe(true);
  });
});
