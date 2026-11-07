import { chmod } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const scenarios = [
  {
    title: "empty, whitespace and zero device properties",
    tool: "inspect_adb_device",
    argv: ["inspect-adb-device", "device", "--json"],
    input: { serial: "device" },
    expected: {
      serial: "device",
      property_count: 4,
      emulator_observed: false,
      properties: [
        { name: "ro.build.version.security_patch", value: "" },
        { name: "ro.debuggable", value: "0" },
        { name: "ro.kernel.qemu", value: "0" },
        { name: "ro.product.model", value: "  " },
      ],
    },
  },
  {
    title: "version name whitespace",
    tool: "inspect_adb_package",
    argv: ["inspect-adb-package", "device", "com.example", "--json"],
    input: { serial: "device", package: "com.example" },
    expected: {
      serial: "device",
      package_name: "com.example",
      version_name: "  My Build  ",
      version_code: "0",
    },
  },
] as const;

for (const scenario of scenarios) {
  it.skipIf(process.platform === "win32").each(["cli", "mcp"] as const)(
    `preserves ${scenario.title} through %s`,
    async (adapter) => {
      const workspace = await createTestWorkspace("rea-adb-properties-");
      onTestFinished(() => removeTestWorkspace(workspace.root));
      const binary = await workspace.write(
        "adb",
        `#!/bin/sh
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\nInstalled as %s\\n' "$0"
  exit 0
fi
if [ "$1" = -s ] && [ "$3" = shell ] && [ "$4" = getprop ]; then
  printf '[ro.build.version.security_patch]: []\\n[ro.product.model]: [  ]\\n[ro.debuggable]: [0]\\n[ro.kernel.qemu]: [0]\\n[sys.unlisted]: []\\n'
  exit 0
fi
if [ "$1" = -s ] && [ "$3" = shell ] && [ "$4" = dumpsys ]; then
  printf '  Package [com.example] (abcdef):\\n    pkg=Package{abcdef com.example}\\n    versionName=  My Build  \\n    versionCode=0 minSdk=23 targetSdk=34\\n'
  exit 0
fi
exit 1
`,
      );
      await chmod(binary, 0o755);
      let evidence;
      if (adapter === "cli") {
        const output = await execFileOutput(
          process.execPath,
          ["scripts/rea.mjs", ...scenario.argv],
          {
            env: { ...process.env, REA_ADB_PATH: binary },
            timeout: 20_000,
            stopSignal: "SIGTERM",
            maxBuffer: 1024 * 1024,
          },
        );
        evidence = parseEvidence(JSON.parse(output.stdout));
      } else {
        const server = createServer(
          {
            kind: "session",
            session: createTestBinarySession(() => {
              throw new Error(
                "Device inspection must not open a binary provider",
              );
            }),
          },
          {
            adbDeviceAnalysis: new AdbProvider({
              environment: { REA_ADB_PATH: binary },
            }),
          },
        );
        onTestFinished(() => server.close());
        const client = new Client({ name: "adb-properties", version: "1" });
        onTestFinished(() => client.close());
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const { tools } = await client.listTools();
        const advertised = tools.find(({ name }) => name === scenario.tool);
        const outputSchema = z
          .record(z.string(), z.unknown())
          .parse(advertised?.outputSchema);
        const ajv = new Ajv2020({ strict: false, allErrors: true });
        expect(ajv.validateSchema(outputSchema)).toBe(true);
        const validate = ajv.compile(outputSchema);
        const reply = await client.callTool({
          name: scenario.tool,
          arguments: scenario.input,
        });
        expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
        expect(
          validate(reply.structuredContent),
          JSON.stringify(validate.errors),
        ).toBe(true);
        evidence = parseEvidence(reply.structuredContent);
      }
      expect(evidence.normalized_result).toMatchObject(scenario.expected);
    },
  );
}
