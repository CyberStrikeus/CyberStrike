import { expect, it } from "vitest";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { fakeKunaCalls } from "./fakeKuna.js";
import { session } from "./kunaSessionFixture.js";

it
  .skipIf(process.platform === "win32")
  .each([
    null,
    "caller stopped",
    new ProviderCleanupError("foreign", ["foreign-owner"], {}),
  ])(
  "retains the exact pre-admission reason without acquiring another installation: %j",
  async (reason) => {
    const fixture = await session("rea-kuna-inventory-pre-abort-");
    const client = fixture.open();
    const controller = new AbortController();
    controller.abort(reason);
    try {
      const result = await client.execute(
        "search_procedures",
        { pattern: "main", mode: "literal" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(
        (await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv[0]),
      ).toEqual(["--version"]);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  },
);

it.skipIf(process.platform === "win32").each([
  { inventory: "not-json" as const, expected: "execution_failure" },
  { inventory: "hang" as const, expected: "provider_timeout" },
  { inventory: "ok" as const, expected: "success" },
])(
  "keeps search identity for a completed $inventory callable inventory",
  async ({ inventory, expected }) => {
    const fixture = await session(
      "rea-kuna-inventory-attribution-",
      { inventory },
      { REA_KUNA_TIMEOUT_MS: "1000" },
    );
    const client = fixture.open();
    try {
      const result = await client.execute("search_procedures", {
        pattern: "main",
        mode: "literal",
      });
      if (expected === "success") {
        if (!result.ok) throw result.error;
        expect(result.value.result).toEqual([
          { address: "0x1000", value: "main" },
        ]);
      } else {
        if (result.ok) throw new Error("Expected inventory failure");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: expected,
          details: {
            operation: "search_procedures",
            diagnostics: { producer_operation: "list_procedures" },
          },
        });
      }
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "cancels one search waiter with its exact reason while retaining its peer's shared inventory",
  async () => {
    const fixture = await session("rea-kuna-inventory-waiter-", {
      inventory: "hang",
    });
    const client = fixture.open();
    const controller = new AbortController();
    const reason = new ProviderCleanupError("foreign", ["foreign-owner"], {});
    const search = client.execute(
      "search_procedures",
      { pattern: "main", mode: "literal" },
      { signal: controller.signal },
    );
    const peer = client.execute("list_procedures", {});
    let peerSettled = false;
    void peer.then(() => {
      peerSettled = true;
    });
    try {
      await expect
        .poll(async () =>
          (await fakeKunaCalls(fixture.kuna)).some(
            ({ argv }) => argv[0] === "functions",
          ),
        )
        .toBe(true);
      controller.abort(reason);
      const result = await search;
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cancelled",
        details: { operation: "search_procedures" },
      });
      expect(peerSettled).toBe(false);
      expect(
        (await fakeKunaCalls(fixture.kuna)).filter(
          ({ argv }) => argv[0] === "functions",
        ),
      ).toHaveLength(1);
    } finally {
      expect((await client.close()).ok).toBe(true);
      await Promise.all([search, peer]);
    }
    expect(reason.cleanupIncomplete).toBe(true);
  },
);
