import { describe, expect, it } from "vitest";
import { IDA_COMPATIBILITY_PROFILES } from "./IdaConfiguration.js";
import {
  IDA_OPERATIONS,
  idaCapabilities,
  idaOperationUnavailableReason,
} from "./IdaProviderCapabilities.js";

describe("IDA profile operation admission", () => {
  for (const [name, profile] of Object.entries(IDA_COMPATIBILITY_PROFILES)) {
    it(`keeps ${name} advertisement and execution admission aligned`, () => {
      const capabilities = idaCapabilities(profile, false);
      for (const operation of IDA_OPERATIONS) {
        const capability = capabilities.find(
          (candidate) => candidate.operation === operation,
        );
        const reason = idaOperationUnavailableReason(operation, profile);
        if (capability === undefined) {
          expect(operation).toBe("resolve_containing_procedure");
          expect(profile.mode).toBe("attached");
          expect(reason).toBeDefined();
        } else {
          expect(capability.available).toBe(reason === undefined);
          expect(capability.reason).toBe(reason ?? null);
        }
      }
      expect(
        idaOperationUnavailableReason("procedure_callers", profile) ===
          undefined,
      ).toBe(name === "legacy");
      expect(
        idaOperationUnavailableReason("procedure_callees", profile),
      ).toBeUndefined();
    });
  }
});
