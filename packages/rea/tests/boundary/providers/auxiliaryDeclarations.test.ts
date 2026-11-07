import { expect, it } from "vitest";

import { auxiliaryAnalysisProviderDeclarations } from "../../../src/composition/auxiliaryAnalysisProviders.js";
import { LazyAnalysisProvider } from "../../../src/application/binary/LazyAnalysisProvider.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";

it("keeps declaration discovery and client creation lazy and independently owned", async () => {
  const target = await parseBinaryTarget(process.execPath);
  if (!target.ok) throw target.error;
  for (const declaration of auxiliaryAnalysisProviderDeclarations({})) {
    let loads = 0;
    const provider = new LazyAnalysisProvider({
      ...declaration,
      load: async () => {
        loads += 1;
        return declaration.load();
      },
    });
    expect(provider.identity()).toEqual(declaration.identity);
    expect(provider.capabilities()).toEqual(declaration.capabilities);
    const client = provider.createClient(target.value);
    const unusedClient = provider.createClient(target.value);
    await unusedClient.close();
    expect(loads).toBe(0);
    try {
      expect(await client.execute("health", {})).toMatchObject({
        ok: true,
        value: { provider: declaration.identity },
      });
      expect(loads).toBe(1);
      expect(await client.execute("health", {})).toMatchObject({ ok: true });
      expect(loads).toBe(1);
    } finally {
      await client.close();
    }
  }
});
