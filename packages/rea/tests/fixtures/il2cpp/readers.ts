import { linkIl2cppBinarySteps } from "../../../src/il2cpp/Il2cppBinaryFile.js";
import {
  readIl2cppMetadataForLinkingSteps,
  readIl2cppMetadataSteps,
} from "../../../src/il2cpp/Il2cppMetadataFile.js";

/** Consume production reader steps synchronously, optionally observing each yield. */
export const drain = <T>(steps: Generator<void, T>, onYield = () => {}): T => {
  for (;;) {
    const step = steps.next();
    if (step.done === true) return step.value;
    onYield();
  }
};

export const readIl2cppMetadata = (
  ...parameters: Parameters<typeof readIl2cppMetadataSteps>
) => drain(readIl2cppMetadataSteps(...parameters));

export const readIl2cppMetadataForLinking = (
  ...parameters: Parameters<typeof readIl2cppMetadataForLinkingSteps>
) => drain(readIl2cppMetadataForLinkingSteps(...parameters));

export const linkIl2cppBinary = (
  ...parameters: Parameters<typeof linkIl2cppBinarySteps>
) => drain(linkIl2cppBinarySteps(...parameters));
