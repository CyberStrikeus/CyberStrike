import { expect, it } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";
import {
  assertCompetingLoaderCliParity,
  assertCompetingLoaderOwnership,
  cliParityLoaders,
  competingLoaderNames,
} from "./javascriptLiteralLoaderOwnership.js";

it("keeps compiled CLI parity inside the competing-loader matrix", () => {
  expect(new Set(cliParityLoaders).size).toBe(cliParityLoaders.length);
  for (const loader of cliParityLoaders)
    expect(competingLoaderNames).toContain(loader);
});

cliTest.for(competingLoaderNames.map((loader) => ({ loader })))(
  "preserves competing loader ownership for $loader through stdio MCP",
  async ({ loader }, { cli }) => {
    await assertCompetingLoaderOwnership(loader, cli);
  },
);

cliTest.for(cliParityLoaders.map((loader) => ({ loader })))(
  "matches compiled CLI analysis for competing loader $loader",
  async ({ loader }, { cli }) => {
    await assertCompetingLoaderCliParity(loader, cli);
  },
);
