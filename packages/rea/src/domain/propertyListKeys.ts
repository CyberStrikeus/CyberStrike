import { decodeXmlPropertyList } from "./propertyListXml.js";
import {
  decodeOpenStepPropertyList,
  startsOpenStepPropertyList,
} from "./propertyListOpenStep.js";
import {
  createPlistNumberCollector,
  type PlistNumberLiterals,
} from "./apple/plistNumbers.js";
import { MAX_PLIST_DEPTH } from "./apple/plistValue.js";

/** Values and numeric source facts decoded together; OpenStep numbers remain unknown. */
export interface ParsedPropertyList {
  readonly value: unknown;
  readonly numberLiterals: PlistNumberLiterals;
}

/** Decode XML or the existing OpenStep container form, retaining every dictionary key. */
export const parseXmlPropertyList = (
  text: string,
  maximumDepth = MAX_PLIST_DEPTH,
): ParsedPropertyList =>
  startsOpenStepPropertyList(text)
    ? {
        value: decodeOpenStepPropertyList(text, maximumDepth),
        numberLiterals: createPlistNumberCollector().result(true),
      }
    : decodeXmlPropertyList(text, maximumDepth);
