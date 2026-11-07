import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import { NativeModuleResolver } from "../../src/browser/modules/NativeModuleResolver.js";
import { observeProcessStartIdentity } from "../../src/process/ProcessOwnershipObservation.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

afterEach(() => vi.unstubAllEnvs());

// Playwright starts the actual selected executable, which records its environment
// and exits before the browser handshake. This proves launch inheritance only.
it.skipIf(process.platform === "win32").each([
  { name: "missing", selected: {}, expected: "absent" },
  {
    name: "unset",
    selected: { REA_MODULE_ENV_PROFILE: undefined },
    expected: "absent",
  },
  { name: "empty", selected: { REA_MODULE_ENV_PROFILE: "" }, expected: "" },
  {
    name: "selected",
    selected: { REA_MODULE_ENV_PROFILE: "selected-profile" },
    expected: "selected-profile",
  },
])(
  "preserves $name module-resolver settings in the real Playwright child",
  async ({ selected, expected }) => {
    const root = await createTestTempDirectory(
      "rea-module-resolver-environment-",
    );
    const command = join(root, "browser"),
      receipt = join(root, "receipt");
    const quotedReceipt = `'${receipt.replaceAll("'", "'\\''")}'`;
    await writeFile(
      command,
      '#!/bin/sh\nprintf "%s\\n%s" "$$" "${REA_MODULE_ENV_PROFILE-absent}" > ' +
        quotedReceipt +
        "\nexit 0\n",
      { mode: 0o755 },
    );
    const environment = { REA_BROWSER_EXECUTABLE: command, ...selected };
    const resolver = new NativeModuleResolver(environment);
    onTestFinished(() => resolver.close());
    // Constructor selection is immutable even when the original caller map changes.
    Object.assign(environment, {
      REA_MODULE_ENV_PROFILE: "later-caller-profile",
    });
    vi.stubEnv("REA_MODULE_ENV_PROFILE", "late-ambient-profile");
    const result = await resolver.resolve({
      importerUrl: "https://app.test/main.js",
      importMap: null,
      specifiers: ["./dep.js"],
    });
    expect(result.ok).toBe(false);
    const observed = await readFile(receipt, "utf8");
    const separator = observed.indexOf("\n");
    expect(observed.slice(separator + 1)).toBe(expected);
    const pid = Number(observed.slice(0, separator));
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    expect(await observeProcessStartIdentity(pid)).toBeUndefined();
  },
);
