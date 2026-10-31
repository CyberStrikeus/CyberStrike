import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import { createCli } from "../../src/cli.js";
import { ApktoolProvider } from "../../src/apktool/ApktoolProvider.js";
import { ApktoolResourceAnalysisService } from "../../src/application/apktool/ApktoolResourceAnalysisService.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const initialExitCode = process.exitCode;
afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = initialExitCode;
});

// These executable probes validate the real CLI and process environment boundary;
// they do not establish native Apktool decoding behavior.
it.skipIf(process.platform === "win32").each([
  { name: "missing", selected: {}, expected: "absent" },
  {
    name: "unset",
    selected: { REA_APKTOOL_ENV_PROFILE: undefined },
    expected: "absent",
  },
  {
    name: "empty",
    selected: { REA_APKTOOL_ENV_PROFILE: "" },
    expected: "empty",
  },
  {
    name: "selected",
    selected: { REA_APKTOOL_ENV_PROFILE: "selected-profile" },
    expected: "selected-profile",
  },
])(
  "preserves $name Apktool settings after the ambient environment changes",
  async ({ selected, expected }) => {
    const root = await createTestTempDirectory(
      "rea-apktool-selected-environment-",
    );
    const command = join(root, "apktool");
    await writeFile(
      command,
      '#!/bin/sh\nprofile=${REA_APKTOOL_ENV_PROFILE-absent}\n[ -n "$profile" ] || profile=empty\nprintf "2.11.1+%s\\n" "$profile"\n',
      { mode: 0o755 },
    );
    const cli = createCli({ REA_APKTOOL_COMMAND: command, ...selected });
    vi.stubEnv("REA_APKTOOL_ENV_PROFILE", "late-ambient-profile");
    let stdout = "";
    await cli.serve(["inspect-apktool-client", "--json"], {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => undefined,
    });
    const evidence = parseEvidence(JSON.parse(stdout));
    expect(evidence.normalized_result).toMatchObject({
      client: { apktool_version: `2.11.1+${expected}` },
    });
    expect(evidence.environment).toBeNull();
  },
);

it.skipIf(process.platform === "win32")(
  "inherits the current default launcher when no environment was selected",
  async () => {
    const root = await createTestTempDirectory(
      "rea-apktool-default-environment-",
    );
    const command = join(root, "apktool");
    await writeFile(command, '#!/bin/sh\nprintf "2.11.1+later\\n"\n', {
      mode: 0o755,
    });
    vi.stubEnv("REA_APKTOOL_COMMAND", "/ambient/initial-apktool");
    const provider = new ApktoolProvider();
    onTestFinished(() => provider.close());
    vi.stubEnv("REA_APKTOOL_COMMAND", command);
    const result = await new ApktoolResourceAnalysisService(provider).execute(
      "inspect_apktool_client",
      {},
    );
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      client: { command, apktool_version: "2.11.1+later" },
    });
  },
);
