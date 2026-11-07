import { expect } from "vitest";
import { z } from "zod";

import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import {
  expectKeyedArchivePrototypeKeys,
  keyedArchivePrototypeKeyFixture,
} from "../../fixtures/keyedArchivePrototypeKeys.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { openProductionTarget } from "../../support/mcp/productionSession.js";

mcpTest(
  "MCP retains ordinary evidence with formatted XML prototype keys",
  async ({ mcp, onTestFinished }) => {
    const fixture = await keyedArchivePrototypeKeyFixture();
    const client = await openProductionTarget(
      mcp,
      onTestFinished,
      fixture.path,
    );
    const result = await client.callTool({
      name: "inspect_keyed_archive",
      arguments: {},
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expectKeyedArchivePrototypeKeys(
      z
        .object({ normalized_result: keyedArchiveResultSchema })
        .parse(result.structuredContent).normalized_result,
      fixture.digest,
    );
  },
);
