import { appendFile, unlink } from "node:fs/promises";
import { expect, it } from "vitest";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { fakeKunaCalls, setFakeKunaBehavior } from "./fakeKuna.js";
import { session } from "./kunaSessionFixture.js";

it
  .skipIf(process.platform === "win32")
  .each(["version-refusal", "changed", "removed"] as const)(
  "attributes a shared %s installation failure independently to each caller",
  async (mode) => {
    const fixture = await session("rea-kuna-installation-attribution-");
    if (mode === "version-refusal")
      await setFakeKunaBehavior(fixture.kuna, { version: { exit: 7 } });
    if (mode === "changed")
      await appendFile(fixture.kuna, "\n// changed executable\n");
    if (mode === "removed") await unlink(fixture.kuna);
    const client = fixture.open();
    try {
      const [search, strings, health] = await Promise.all([
        client.execute("search_procedures", {
          pattern: "main",
          mode: "literal",
          case_sensitive: false,
        }),
        client.execute("list_strings", {}),
        client.execute("health", {}),
      ]);
      if (search.ok || strings.ok || health.ok)
        throw new Error("Expected installation failures");
      for (const [result, operation] of [
        [search, "search_procedures"],
        [strings, "list_strings"],
      ] as const) {
        expect(projectAnalysisError(result.error).details).toMatchObject({
          operation,
        });
        expect(result.error._tag).toBe(health.error._tag);
        expect(result.error.diagnostics).toEqual({
          ...health.error.diagnostics,
          producer_operation: "health",
        });
        expect(result.error.cause).toBe(health.error);
        expect(projectAnalysisError(result.error).retryable).toBe(
          projectAnalysisError(health.error).retryable,
        );
      }
      expect(projectAnalysisError(health.error).details).toMatchObject({
        operation: "health",
      });
      expect(
        (await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv[0]),
      ).toEqual(
        mode === "removed" ? ["--version"] : ["--version", "--version"],
      );
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "preserves successful procedure search after installation acquisition",
  async () => {
    const fixture = await session("rea-kuna-installation-search-control-");
    const client = fixture.open();
    try {
      const result = await client.execute("search_procedures", {
        pattern: "main",
        mode: "literal",
        case_sensitive: false,
      });
      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual([
        { address: "0x1000", value: "main" },
      ]);
      expect(
        (await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv[0]),
      ).toEqual(["--version", "--version", "functions"]);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  },
);
