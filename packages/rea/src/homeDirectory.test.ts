import { userInfo } from "node:os";

import { describe, expect, it } from "vitest";

import { homeDirectoryFromEnvironment } from "./config/homeDirectory.js";

describe("home directory environment selection", () => {
  it("skips an empty HOME before selecting USERPROFILE on POSIX", () => {
    expect(
      homeDirectoryFromEnvironment(
        { HOME: "", USERPROFILE: "relative/profile" },
        "linux",
      ),
    ).toBe("relative/profile");
  });

  it("falls back to the account home when POSIX home variables are empty", () => {
    expect(
      homeDirectoryFromEnvironment({ HOME: "", USERPROFILE: "" }, "linux"),
    ).toBe(userInfo().homedir);
  });

  it("preserves a nonempty relative Windows profile ahead of drive variables", () => {
    expect(
      homeDirectoryFromEnvironment(
        {
          USERPROFILE: "relative/profile",
          HOMEDRIVE: "D:",
          HOMEPATH: "\\Users\\account",
          HOME: "other/home",
        },
        "win32",
      ),
    ).toBe("relative/profile");
  });

  it("uses the Windows drive pair when USERPROFILE is empty", () => {
    expect(
      homeDirectoryFromEnvironment(
        {
          USERPROFILE: "",
          HOMEDRIVE: "D:",
          HOMEPATH: "\\Users\\account",
          HOME: "other/home",
        },
        "win32",
      ),
    ).toBe("D:\\Users\\account");
  });

  it("falls back to the account home when all Windows home values are empty", () => {
    expect(
      homeDirectoryFromEnvironment(
        {
          USERPROFILE: "",
          HOMEDRIVE: "",
          HOMEPATH: "",
          HOME: "",
        },
        "win32",
      ),
    ).toBe(userInfo().homedir);
  });
});
