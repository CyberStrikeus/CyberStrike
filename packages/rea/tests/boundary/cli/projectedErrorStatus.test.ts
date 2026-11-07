import { describe, expect } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";

describe("projected CLI failures", () => {
  cliTest(
    "exits unsuccessfully for invalid managed reconstruction input",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: ["import-managed-reconstruction", "{}", "--json"],
      });
      expect(result.json).toMatchObject({ code: "invalid_request" });
      expect(result.exitCode).toBe(1);
    },
  );

  cliTest(
    "keeps successful target-free inventory commands successful",
    async ({ cli }) => {
      const result = await cli.run({ arguments: ["capabilities", "--json"] });
      expect(result.exitCode).toBe(0);
      expect(result.json).toBeDefined();
    },
  );

  cliTest(
    "preserves failure identity when output selectors match or miss",
    async ({ cli }) => {
      for (const format of ["json", "toon", "yaml", "md"])
        for (const filter of ["missing", "code", "message"]) {
          const result = await cli.run({
            arguments: [
              "import-managed-reconstruction",
              "{}",
              "--format",
              format,
              "--filter-output",
              filter,
            ],
          });
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toContain("invalid_request");
          expect(result.stdout).toContain("remediation");
          if (format === "json")
            expect(result.json).toMatchObject({ code: "invalid_request" });
        }
    },
    30_000,
  );
});
