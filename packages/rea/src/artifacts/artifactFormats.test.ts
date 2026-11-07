import { describe, expect, it } from "vitest";

import { ARTIFACT_FORMAT_IDS } from "../domain/artifactGraph.js";
import {
  ZIP_PACKAGE_FORMATS,
  type ZipPackageFormat,
} from "../domain/zipPackageFormat.js";
import {
  ARTIFACT_FORMATS,
  ZIP_FAMILY_CAPABILITIES,
} from "./artifactFormats.js";
import {
  createArtifactReader,
  type ArtifactReaderFormat,
} from "./createArtifactReader.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type FormatsWithReaders =
  | ZipPackageFormat
  | "dotnet-bundle"
  | "bun-standalone"
  | "dmg"
  | "asar"
  | "ines"
  | "godot-pck"
  | "unityfs"
  | "uimage"
  | "mach-o-universal"
  | "directory"
  | "pyinstaller"
  | "node-sea"
  | "intel-hex"
  | "srec"
  | "esp-image"
  | "uf2"
  | "dfuse"
  | "esp-flash-image"
  | "fit";

const readerFormatsMatch: Equal<ArtifactReaderFormat, FormatsWithReaders> =
  true;
const unknownHasNoReader: "unknown" extends ArtifactReaderFormat
  ? false
  : true = true;

describe("artifact format descriptors", () => {
  it("derives the reader-format union from descriptors that construct a reader", () => {
    expect(readerFormatsMatch).toBe(true);
    expect(unknownHasNoReader).toBe(true);
  });

  it("covers every domain format id and no other id", () => {
    expect(Object.keys(ARTIFACT_FORMATS).sort()).toEqual(
      [...ARTIFACT_FORMAT_IDS].sort(),
    );
  });

  it("leaves unknown without a reader", () => {
    expect("createReader" in ARTIFACT_FORMATS.unknown).toBe(false);
    expect(
      createArtifactReader("/unused", "unknown", {
        environment: {},
        unreadableDirectories: "omit",
      }),
    ).toBeUndefined();
  });

  it("shares one capability row across zip package families", () => {
    for (const id of ZIP_PACKAGE_FORMATS)
      expect(ARTIFACT_FORMATS[id]).toMatchObject(ZIP_FAMILY_CAPABILITIES);
    const zipIds = new Set<ZipPackageFormat>(ZIP_PACKAGE_FORMATS);
    for (const id of ARTIFACT_FORMAT_IDS)
      if (!zipIds.has(id as ZipPackageFormat))
        expect(ARTIFACT_FORMATS[id].zipFamily).toBe(false);
  });
});
