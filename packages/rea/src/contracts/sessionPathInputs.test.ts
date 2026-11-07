import { describe, expect, it } from "vitest";

import { browserScenarioBrowserSchema } from "../domain/browserScenarioValues.js";
import { firmwareInputSchemas } from "../domain/firmware/firmwareAnalysis.js";
import { electronActiveObservationInputSchema } from "../domain/javascript/electronActiveObservation.js";
import { managedTargetInputSchema } from "./managed/managedToolContracts.js";
import { exportEvidenceBundleInputSchema } from "./sessionToolContracts.js";
import {
  closeBinaryInputSchema,
  openBinaryInputSchema,
} from "./sessionLifecycleInputs.js";
import { importEvidenceBundleInputSchema } from "./sessionToolSchemas.js";
import { binarySessionInputSchema } from "./sessionStatusContract.js";

type PathCase = {
  readonly name: string;
  readonly accepts: (value: unknown) => boolean;
  readonly relative: unknown[];
  readonly absolute: string;
  readonly omitted?: () => boolean;
};

const cases: readonly PathCase[] = [
  {
    name: "open binary snapshot",
    accepts: (snapshot_path) =>
      openBinaryInputSchema.safeParse({ path: "/tmp/fixture", snapshot_path })
        .success,
    relative: ["relative/analysis.json", "../outside/analysis.json"],
    absolute: "/tmp/rea/analysis.json",
    omitted: () =>
      openBinaryInputSchema.safeParse({ path: "/tmp/fixture" }).success,
  },
  {
    name: "close binary snapshot",
    accepts: (snapshot_path) =>
      closeBinaryInputSchema.safeParse({ snapshot_path }).success,
    relative: ["analysis.json"],
    absolute: "/tmp/analysis.json",
    omitted: () => closeBinaryInputSchema.safeParse({}).success,
  },
  {
    name: "evidence bundle export",
    accepts: (path) =>
      exportEvidenceBundleInputSchema.safeParse({ path }).success,
    relative: ["out/bundle.json", "../../bundle.json"],
    absolute: "/tmp/bundle.json",
  },
  {
    name: "managed target",
    accepts: (path) => managedTargetInputSchema.safeParse({ path }).success,
    relative: ["bin/app.dll"],
    absolute: "/tmp/app.dll",
    omitted: () => managedTargetInputSchema.safeParse({}).success,
  },
  {
    name: "open binary target",
    accepts: (path) => openBinaryInputSchema.safeParse({ path }).success,
    relative: ["fixtures/app.bin"],
    absolute: "/tmp/fixture.bin",
  },
  {
    name: "evidence bundle import",
    accepts: (path) =>
      importEvidenceBundleInputSchema.safeParse({ path }).success,
    relative: ["evidence.json"],
    absolute: "/tmp/evidence.json",
  },
  {
    name: "firmware inspection",
    accepts: (path) =>
      firmwareInputSchemas.inspect_firmware_regions.safeParse({ path }).success,
    relative: ["firmware.bin"],
    absolute: "/tmp/firmware.bin",
  },
  {
    name: "firmware extraction",
    accepts: (path) =>
      firmwareInputSchemas.extract_firmware.safeParse({
        path,
        output_directory: "/tmp/firmware-output",
      }).success,
    relative: ["firmware.bin"],
    absolute: "/tmp/firmware.bin",
  },
  {
    name: "browser executable",
    accepts: (executable_path) =>
      browserScenarioBrowserSchema.safeParse({
        mode: "launch",
        executable_path,
      }).success,
    relative: ["chrome"],
    absolute: "/opt/chromium/chrome",
  },
  {
    name: "Electron executable",
    accepts: (executable_path) =>
      electronActiveObservationInputSchema.safeParse({
        executable_path,
        application_path: "/tmp/electron-app/main.js",
      }).success,
    relative: ["Electron"],
    absolute: "/Applications/Electron.app/Contents/MacOS/Electron",
  },
  {
    name: "Electron application",
    accepts: (application_path) =>
      electronActiveObservationInputSchema.safeParse({
        executable_path: "/Applications/Electron.app/Contents/MacOS/Electron",
        application_path,
      }).success,
    relative: ["main.js"],
    absolute: "/tmp/electron-app/main.js",
  },
  {
    name: "Electron application root",
    accepts: (application_root) =>
      electronActiveObservationInputSchema.safeParse({
        executable_path: "/Applications/Electron.app/Contents/MacOS/Electron",
        application_path: "/tmp/electron-app/main.js",
        application_root,
      }).success,
    relative: ["app"],
    absolute: "/tmp/electron-app",
    omitted: () =>
      electronActiveObservationInputSchema.safeParse({
        executable_path: "/Applications/Electron.app/Contents/MacOS/Electron",
        application_path: "/tmp/electron-app/main.js",
      }).success,
  },
  {
    name: "expected server",
    accepts: (expected_server_path) =>
      binarySessionInputSchema.safeParse({ expected_server_path }).success,
    relative: ["dist/main.js"],
    absolute: "/opt/rea/dist/main.js",
    omitted: () => binarySessionInputSchema.safeParse({}).success,
  },
];

it.each(cases)("$name requires an absolute local path", (pathCase) => {
  for (const relative of pathCase.relative)
    expect(pathCase.accepts(relative), pathCase.name).toBe(false);
  expect(pathCase.accepts(pathCase.absolute), pathCase.name).toBe(true);
  if (pathCase.omitted !== undefined)
    expect(pathCase.omitted(), pathCase.name).toBe(true);
});

it("preserves whitespace in selected browser and Electron filesystem names", () => {
  const executable = "/opt/browser with trailing space ";
  expect(
    browserScenarioBrowserSchema.parse({
      mode: "launch",
      executable_path: executable,
    }),
  ).toMatchObject({ executable_path: executable });
  const application = "/tmp/application ";
  const root = "/tmp/application root ";
  expect(
    electronActiveObservationInputSchema.parse({
      executable_path: executable,
      application_path: application,
      application_root: root,
    }),
  ).toMatchObject({
    executable_path: executable,
    application_path: application,
    application_root: root,
  });
});

describe.runIf(process.platform === "win32")(
  "Windows absolute path forms",
  () => {
    it.each([
      [closeBinaryInputSchema, { snapshot_path: "C:\\rea\\analysis.json" }],
      [closeBinaryInputSchema, { snapshot_path: "C:/rea/analysis.json" }],
      [exportEvidenceBundleInputSchema, { path: "C:/rea/bundle.json" }],
    ])("accepts %o", (schema, input) => {
      expect(schema.safeParse(input).success).toBe(true);
    });
  },
);
