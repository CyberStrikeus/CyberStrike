import { expect } from "vitest";

import { parseJavaScriptSource } from "../../../src/domain/javascript/javascriptSourceParser.js";
import { processTest } from "../../support/process/processFixture.js";

for (const source of [
  "return;",
  "void new.target;",
  "var await = 1; return;",
  "with ({ value: 1 }) { void value; } void new.target;",
]) {
  processTest(
    `accepts Node CommonJS syntax while retaining module errors: ${source}`,
    async ({ processes }) => {
      const commonjs = await processes.run(
        process.execPath,
        ["--check", "--input-type=commonjs"],
        { input: source, timeoutMs: 5_000 },
      );
      expect(commonjs.exitCode).toBe(0);
      const module = await processes.run(
        process.execPath,
        ["--check", "--input-type=module"],
        { input: source, timeoutMs: 5_000 },
      );
      expect(module.exitCode).not.toBe(0);

      const parsed = parseJavaScriptSource(source, "main.cjs");
      expect(parsed).not.toBeNull();
      expect(parsed?.errors).toEqual([]);
      expect(
        parseJavaScriptSource(source, "main.mjs")?.errors.length,
      ).toBeGreaterThan(0);
      expect(
        parseJavaScriptSource(source, "main.mts")?.errors.length,
      ).toBeGreaterThan(0);
    },
  );
}
