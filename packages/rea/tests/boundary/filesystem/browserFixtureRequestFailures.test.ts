import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { processTest } from "../../support/process/processFixture.js";

for (const [fixture, factory, ordinaryPath, malformedPath] of [
  ["browser-network-site", "startBrowserNetworkSite", "/binary", "/same"],
  [
    "browser-request-site",
    "startBrowserRequestSite",
    "/api/items",
    "/api/items",
  ],
] as const) {
  processTest(
    `${fixture} retains malformed request failure through physical close`,
    async ({ processes }) => {
      const module = new URL(
        `../../../scripts/fixtures/${fixture}.mjs`,
        import.meta.url,
      ).href;
      const cleanup = new URL(
        "../../../scripts/lib/verifier-cleanup.mjs",
        import.meta.url,
      ).href;
      const program = `
      import assert from "node:assert/strict";
      import { withVerifierCleanup } from ${JSON.stringify(cleanup)};
      const { ${factory}: start } = await import(${JSON.stringify(module)});
      const site = await start();
      let closed = false;
      await withVerifierCleanup(async () => {
        const ordinary = await fetch(site.origin + ${JSON.stringify(ordinaryPath)}, { signal: AbortSignal.timeout(2000) });
        assert.equal(ordinary.status, 200);
        await ordinary.arrayBuffer();
        await assert.rejects(fetch(site.origin + ${JSON.stringify(malformedPath)}, {
          method: "POST", body: "{", signal: AbortSignal.timeout(2000),
        }));
        const outcome = await site.close().then(
          () => ({ ok: true }), cause => ({ ok: false, cause }),
        );
        closed = true;
        assert.equal(outcome.ok, false);
        assert(outcome.cause instanceof AggregateError);
        assert.equal(outcome.cause.errors.length, 1);
        assert(outcome.cause.errors[0] instanceof SyntaxError);
        await assert.rejects(fetch(site.origin, { signal: AbortSignal.timeout(2000) }));
        console.log("ordinary response preserved; malformed request retained; endpoint closed");
      }, [async () => { if (!closed) await site.close(); }]);
    `;
      const result = await processes.run(
        process.execPath,
        ["--input-type=module", "-e", program],
        {
          cwd: fileURLToPath(new URL("../../../", import.meta.url)),
          timeoutMs: 10_000,
        },
      );
      expect(result.signal, result.stderr).toBeNull();
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        "ordinary response preserved; malformed request retained; endpoint closed\n",
      );
    },
  );
}
