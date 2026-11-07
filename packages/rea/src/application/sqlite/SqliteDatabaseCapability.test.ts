import { expect, it } from "vitest";
import { expandProviderCapabilities } from "../../contracts/toolOutputSchemaPrimitives.js";
import { providerCapabilitySets } from "../binary/BinarySessionStatus.js";
import { sqliteDatabaseCapability } from "./SqliteDatabaseCapability.js";

it.each([
  ["22.23.1", false],
  ["24.11.0", false],
  ["24.14.9", false],
  ["24.15.0", true],
  ["25.1.0", false],
  ["26.0.0", true],
  ["24.15.0-rc.1", false],
  ["invalid", false],
])(
  "reports SQLite inspection availability on Node %s as %s",
  (version, available) => {
    const [capability] = expandProviderCapabilities(
      providerCapabilitySets([sqliteDatabaseCapability(version)]),
    );
    expect(capability).toMatchObject({
      operation: "inspect_sqlite_database",
      available,
      reason: available
        ? null
        : expect.stringContaining("Node.js 24.x >=24.15 or 26+"),
      availability_code: available ? null : "unsupported_version",
      limitations: [expect.stringContaining("DatabaseSync.limits")],
    });
  },
);
