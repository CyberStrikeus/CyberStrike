import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../../src/cli.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const initialExitCode = process.exitCode;
afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = initialExitCode;
});

const serve = async (
  cli: ReturnType<typeof createCli>,
  arguments_: string[],
) => {
  let stdout = "";
  await cli.serve([...arguments_, "--json"], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: () => undefined,
  });
  const result: unknown = JSON.parse(stdout);
  return result;
};

describe("CLI selected environment", () => {
  it("retains the selected binary provider and launcher after caller and ambient environment changes", async () => {
    vi.stubEnv("REA_ANALYSIS_PROVIDER", "ambient-provider");
    vi.stubEnv("HOPPER_LAUNCHER_PATH", "/ambient/hopper");
    const environment = {
      REA_ANALYSIS_PROVIDER: "selected-provider",
      HOPPER_LAUNCHER_PATH: process.execPath,
    };
    const cli = createCli(environment);
    environment.REA_ANALYSIS_PROVIDER = "changed-provider";
    environment.HOPPER_LAUNCHER_PATH = "/changed/hopper";
    const root = await createTestTempDirectory("rea-cli-selected-env-");
    const target = join(root, "fixture.hop");
    await writeFile(target, "fixture");

    for (const command of [
      ["decompile", target, "main"],
      ["read-bytes", target, "0x1000"],
    ]) {
      const result = await serve(cli, command);
      expect(result).toMatchObject({
        code: "capability_unavailable",
        details: { requested_provider_id: "selected-provider" },
      });
    }
    for (const command of ["providers", "capabilities"]) {
      const result = await serve(cli, [command]);
      expect(result).toMatchObject({
        analysis_provider_candidates: expect.arrayContaining([
          expect.objectContaining({
            provider: expect.objectContaining({ id: "hopper" }),
            availability: expect.objectContaining({
              diagnostics: expect.objectContaining({
                launcher_path: process.execPath,
              }),
            }),
          }),
        ]),
      });
    }
  });

  it("does not borrow invalid ambient settings or capture inherited environment in artifact Evidence", async () => {
    vi.stubEnv("REA_GHIDRA_STARTUP_TIMEOUT_MS", "ambient-invalid-setting");
    vi.stubEnv(
      "REA_AMBIENT_CAPTURE_SENTINEL",
      "ambient-value-must-not-be-captured",
    );
    const root = await createTestTempDirectory("rea-cli-isolated-artifact-");
    const target = join(root, "empty.zip");
    await writeFile(
      target,
      Buffer.from("504b0506000000000000000000000000000000000000", "hex"),
    );
    const cli = createCli({
      REA_SELECTED_CAPTURE_SENTINEL: "selected-value-must-not-be-captured",
    });
    const result = await serve(cli, ["inspect-artifact", target]);
    const evidence = parseEvidence(result);
    expect(evidence.operation).toBe("inspect_artifact");
    expect(evidence.subject?.local_path).toBe(target);
    expect(evidence.environment).toBeNull();
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("CAPTURE_SENTINEL");
    expect(serialized).not.toContain("value-must-not-be-captured");
  });
});

// Real owned probes exercise CLI environment admission; these scripts do not
// establish native Wireshark behavior.
it.skipIf(process.platform === "win32").each([
  { name: "missing", selected: {}, expected: "absent" },
  {
    name: "unset",
    selected: { REA_PCAP_ENV_PROFILE: undefined },
    expected: "absent",
  },
  { name: "empty", selected: { REA_PCAP_ENV_PROFILE: "" }, expected: "" },
  {
    name: "selected",
    selected: { REA_PCAP_ENV_PROFILE: "selected-profile" },
    expected: "selected-profile",
  },
])(
  "preserves $name PCAP settings after the ambient environment changes",
  async ({ selected, expected }) => {
    const root = await createTestTempDirectory("rea-cli-pcap-environment-");
    const tshark = join(root, "tshark"),
      capinfos = join(root, "capinfos");
    for (const [path, label] of [
      [tshark, "TShark"],
      [capinfos, "Capinfos"],
    ] as const)
      await writeFile(
        path,
        `#!/bin/sh\nprintf '${label} (Wireshark) 4.6.6-%s\\n' "` +
          "${REA_PCAP_ENV_PROFILE-absent}" +
          '"\n',
        { mode: 0o755 },
      );
    const cli = createCli({
      REA_TSHARK_COMMAND: tshark,
      REA_CAPINFOS_COMMAND: capinfos,
      ...selected,
    });
    vi.stubEnv("REA_PCAP_ENV_PROFILE", "late-ambient-profile");
    const evidence = parseEvidence(await serve(cli, ["inspect-pcap-client"]));
    expect(evidence.normalized_result).toMatchObject({
      client: {
        tshark_version: `TShark (Wireshark) 4.6.6-${expected}`,
        capinfos_version: `Capinfos (Wireshark) 4.6.6-${expected}`,
      },
    });
    expect(evidence.environment).toBeNull();
  },
);
