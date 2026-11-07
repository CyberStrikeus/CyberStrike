import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AnalysisSettings } from "../../../src/application/AnalysisSettings.js";
import { runtimeAsarHeaderAdmission } from "../../../src/config/runtimeAnalysisSettings.js";
import { authorizedElectronFile } from "../../../src/browser/ElectronFileScope.js";
import { asarHeaderBytes } from "../../fixtures/asarHeader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("rechecks cached Electron ASAR headers against a lowered runtime admission", async () => {
  const root = await createTestTempDirectory("rea-settings-cache-");
  const archive = join(root, "cached.asar");
  await writeFile(
    archive,
    Buffer.concat([
      asarHeaderBytes(
        JSON.stringify({ files: { "main.js": { size: 1, offset: "0" } } }),
      ),
      Buffer.from("x"),
    ]),
  );
  const store = new AnalysisSettings({});
  const admission = runtimeAsarHeaderAdmission({}, store.read);
  const member = join(archive, "main.js");
  const authorize = () =>
    store.run(() =>
      authorizedElectronFile(
        pathToFileURL(member).href,
        undefined,
        "inspect_electron_page",
        admission,
      ),
    );
  expect(await authorize()).toBe(member);
  expect(
    store.update({
      changes: [{ setting: "asar.max_header_bytes", action: "set", value: 1 }],
    }).ok,
  ).toBe(true);
  expect(await authorize()).toBeUndefined();
});
