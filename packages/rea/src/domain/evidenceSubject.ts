import { z } from "zod";

import {
  BINARY_ARCHITECTURES,
  RAW_ONLY_ARCHITECTURES,
} from "./binaryTargetTypes.js";

export const evidenceSubjectFormatSchema = z.enum([
  "hopper",
  "analysis-database",
  "mach-o",
  "elf",
  "pe",
  "dos-mz",
  "dos-com",
  "raw-binary",
  "gamecube-dol",
  "zip",
  "ipa",
  "apk",
  "msix",
  "appx",
  "hap",
  "hsp",
  "app-pack",
  "asar",
  "ines",
  "godot-pck",
  "unityfs",
  "uimage",
  "dmg",
  "pkg",
  "plist",
  "javascript",
  "source-map",
  "directory",
  "file",
  "unknown",
  "mach-o-universal",
  "javascript-bundle",
  "entitlements",
  "pyinstaller",
  "node-sea",
  "dotnet-bundle",
  "bun-standalone",
  "intel-hex",
  "srec",
  "esp-image",
  "uf2",
  "dfuse",
  "esp-flash-image",
  "fit",
]);

/** Format-owned architecture declarations shared by Evidence and persisted executions. */
const detectedEvidenceSubjectDeclaration = {
  format: evidenceSubjectFormatSchema.exclude(["raw-binary", "gamecube-dol"]),
  architecture: z
    .enum(BINARY_ARCHITECTURES)
    .exclude([...RAW_ONLY_ARCHITECTURES])
    .nullable(),
};

const rawEvidenceSubjectDeclaration = {
  format: z.literal("raw-binary"),
  architecture: z.enum(BINARY_ARCHITECTURES).nullable(),
};

const gamecubeEvidenceSubjectDeclaration = {
  format: z.literal("gamecube-dol"),
  architecture: z.literal("powerpc"),
};

/** Add the complete format-owned declaration to a persistence envelope. */
export const withEvidenceSubjectDeclaration = <
  Shape extends z.ZodRawShape,
  Config extends z.core.$ZodObjectConfig,
>(
  base: z.ZodObject<Shape, Config>,
) =>
  z.discriminatedUnion("format", [
    base.extend(detectedEvidenceSubjectDeclaration),
    base.extend(rawEvidenceSubjectDeclaration),
    base.extend(gamecubeEvidenceSubjectDeclaration),
  ]);
