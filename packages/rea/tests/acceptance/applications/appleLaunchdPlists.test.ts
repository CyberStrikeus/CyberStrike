import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import { appleApplicationProjectionResultSchema } from "../../../src/domain/apple/appleApplication.js";
import { compareUnicodeCodePoints } from "../../../src/domain/unicodeCodePointOrder.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "Apple launchd domains follow their owning directory through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-launchd-cli-");
    const environment = { HOME: root, USERPROFILE: root };
    const expected = [
      [
        "LaunchDaemons/Sample.app/Contents/Library/LaunchAgents/agent.plist",
        "agent",
      ],
      [
        "LaunchDaemons/Sample.app/Contents/Resources/LaunchDaemons/Nested.app/Contents/Library/LaunchAgents/nested.plist",
        "agent",
      ],
      [
        "LaunchAgents/Other.app/Contents/Library/LaunchDaemons/daemon.plist",
        "daemon",
      ],
      [
        "launchdaemons/Case.app/contents/library/launchagents/mixed.plist",
        "agent",
      ],
    ] as const;
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const [path] of expected)
      await writer.add(path, new TextReader("<plist/>"));
    for (const path of [
      "LaunchDaemons/Sample.app/Contents/Library/LaunchAgents/nested/ignored.plist",
      "LaunchDaemons/Sample.app/Contents/Library/LaunchAgents/not-a-plist",
      "Contents/Library/LaunchAgents/unrooted.plist",
      "__MACOSX/Sample.app/Contents/Library/LaunchAgents/sidecar.plist",
    ])
      await writer.add(path, new TextReader("<plist/>"));
    await writer.add(
      "LaunchDaemons/Sample.app/Contents/Library/LaunchAgents/directory.plist/",
      undefined,
      { directory: true },
    );
    const path = join(root, "Launchd.zip");
    await writeFile(path, await writer.close());
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
      environment,
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const source = parseEvidence(inspected.json);
    const input = { inventory_evidence: [source] };
    const projected = await cli.run({
      arguments: [
        "project-apple-application-graph",
        JSON.stringify(input),
        "--json",
      ],
      environment,
    });
    expect(projected.exitCode, projected.stderr).toBe(0);
    const evidence = parseEvidence(projected.json);
    const result = appleApplicationProjectionResultSchema.parse(
      evidence.normalized_result,
    );
    expect(
      result.components.launchd_plists.map(({ path, domain }) => [
        path,
        domain,
      ]),
    ).toEqual(
      [...expected].sort(([left], [right]) =>
        compareUnicodeCodePoints(left, right),
      ),
    );
    expect(result.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
    const { call } = await connectLocalToolsMcp(environment);
    const mcp = await call("project_apple_application_graph", input);
    expect(mcp.isError).not.toBe(true);
    expect(parseEvidence(mcp.structuredContent)).toEqual(evidence);
  },
);
