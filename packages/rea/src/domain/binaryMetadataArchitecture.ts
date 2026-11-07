import { BINARY_ARCHITECTURES } from "./binaryTargetTypes.js";

/** Preserve reader spellings while retaining recognized Evidence CPU families. */
export const binaryMetadataArchitecture = (architecture: string) => {
  switch (architecture) {
    case "386":
      return "x86";
    case "amd64":
      return "x86_64";
    case "ppc":
      return "powerpc";
    default:
      return BINARY_ARCHITECTURES.find(
        (supported) => supported === architecture,
      );
  }
};
