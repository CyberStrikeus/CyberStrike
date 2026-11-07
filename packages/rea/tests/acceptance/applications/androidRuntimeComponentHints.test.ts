import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import { androidApplicationProjectionResultSchema } from "../../../src/domain/android/androidApplication.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "Android runtime hints follow classified bytecode through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-android-runtime-hints-");
    const environment = { HOME: root, USERPROFILE: root };
    const { call } = await connectLocalToolsMcp(environment);
    for (const prefix of ["", "named"]) {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("AndroidManifest.xml", new TextReader("fixture"));
      for (const extension of ["dex", "class"])
        await writer.add(
          `assets/${prefix}.${extension}`,
          new TextReader("ordinary text"),
        );
      const path = join(root, `${prefix || "dot-names"}.apk`);
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
          "project-android-application-graph",
          JSON.stringify(input),
          "--json",
        ],
        environment,
      });
      expect(projected.exitCode, projected.stderr).toBe(0);
      const evidence = parseEvidence(projected.json);
      const graph = androidApplicationProjectionResultSchema.parse(
        evidence.normalized_result,
      );
      expect(graph.components.dex.map(({ path }) => path)).toEqual(
        prefix ? ["assets/named.dex"] : [],
      );
      expect(graph.components.jvm_classes.map(({ path }) => path)).toEqual(
        prefix ? ["assets/named.class"] : [],
      );
      expect(graph.runtime_families).toEqual(
        prefix ? ["dalvik-art", "java-kotlin"] : [],
      );
      const mcp = await call("project_android_application_graph", input);
      expect(mcp.isError).not.toBe(true);
      expect(parseEvidence(mcp.structuredContent)).toEqual(evidence);
    }
  },
);

cliTest(
  "projects nested APK v1 filename candidates as inventory metadata through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-android-signing-candidates-",
    );
    const environment = { HOME: root, USERPROFILE: root };
    const { call } = await connectLocalToolsMcp(environment);
    const entries = [
      "META-INF/CERT.SF",
      "META-INF/CERT.EC",
      "META-INF/keys/NESTED.SF",
      "META-INF/keys/NESTED.EC",
      "META-INF/keys/readme.txt",
      "assets/not-signing.SF",
    ];
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("AndroidManifest.xml", new TextReader("fixture"));
    for (const entry of entries)
      await writer.add(entry, new TextReader(`inventory:${entry}`));
    const path = join(root, "signing-candidates.apk");
    await writeFile(path, await writer.close());

    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
      environment,
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const input = { inventory_evidence: [parseEvidence(inspected.json)] };
    const projected = await cli.run({
      arguments: [
        "project-android-application-graph",
        JSON.stringify(input),
        "--json",
      ],
      environment,
    });
    expect(projected.exitCode, projected.stderr).toBe(0);
    const cliEvidence = parseEvidence(projected.json);
    const cliGraph = androidApplicationProjectionResultSchema.parse(
      cliEvidence.normalized_result,
    );
    const mcp = await call("project_android_application_graph", input);
    expect(mcp.isError).not.toBe(true);
    const mcpEvidence = parseEvidence(mcp.structuredContent);
    const mcpGraph = androidApplicationProjectionResultSchema.parse(
      mcpEvidence.normalized_result,
    );

    const expectedPaths = [
      "META-INF/CERT.EC",
      "META-INF/CERT.SF",
      "META-INF/keys/NESTED.EC",
      "META-INF/keys/NESTED.SF",
    ];
    expect(cliGraph.components.signing.map(({ path }) => path).sort()).toEqual(
      expectedPaths,
    );
    expect(mcpGraph.components.signing).toEqual(cliGraph.components.signing);
    for (const component of cliGraph.components.signing)
      expect(component.sha256).toBe(
        createHash("sha256")
          .update(`inventory:${component.path}`)
          .digest("hex"),
      );
    expect(JSON.stringify(cliGraph.components.signing)).not.toContain(
      "readme.txt",
    );
    expect(JSON.stringify(cliGraph.components.signing)).not.toContain(
      "not-signing.SF",
    );
    expect(mcpEvidence).toEqual(cliEvidence);
  },
);
