import { expect } from "vitest";
import { z } from "zod";

import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import {
  archiveNumberMetadataCases,
  expectKeyedArchiveNumberMetadata,
  keyedArchiveNumberMetadataFixture,
} from "../../fixtures/keyedArchiveNumberMetadata.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { openProductionTarget } from "../../support/mcp/productionSession.js";

mcpTest.for(archiveNumberMetadataCases)(
  "MCP preserves numeric meaning for $name",
  async (item, { mcp, onTestFinished }) => {
    const fixture = await keyedArchiveNumberMetadataFixture(item);
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
    expectKeyedArchiveNumberMetadata(
      z
        .object({ normalized_result: keyedArchiveResultSchema })
        .parse(result.structuredContent).normalized_result,
      item,
      fixture.digest,
    );
  },
);
