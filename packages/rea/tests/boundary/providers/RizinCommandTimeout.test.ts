import { describe, expect, it } from "vitest";

import { isRizinCommandDeadlineExpired } from "../../../src/rizin/RizinDebugSessionManager.js";

describe("Rizin command timeout semantics", () => {
  it("treats zero and negative remaining time as expired", () => {
    expect(isRizinCommandDeadlineExpired(1)).toBe(false);
    expect(isRizinCommandDeadlineExpired(0)).toBe(true);
    expect(isRizinCommandDeadlineExpired(-1)).toBe(true);
  });
});
