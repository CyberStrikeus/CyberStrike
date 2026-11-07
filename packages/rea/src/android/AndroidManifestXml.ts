import type { Attr, Element, Node } from "@xmldom/xmldom";
import type { AndroidManifestLocation } from "../domain/android/androidManifestComponents.js";
import { XML_LINE_ENDING } from "../domain/xmlDocument.js";

const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android";
export const childNodes = (element: Element): readonly Node[] =>
  Array.from(element.childNodes);
export const isManifestElement = (node: Node | null): node is Element =>
  node !== null &&
  node.nodeType === 1 &&
  (node as Element).namespaceURI === null;
export const plainAttribute = (
  element: Element,
  name: string,
): string | null => {
  const value = element.getAttribute(name);
  return value === "" ? null : value;
};
/** Namespace identity, never the spelling of a bound prefix, selects a fact. */
export const isAndroidAttribute = (attribute: Attr): boolean =>
  attribute.namespaceURI === ANDROID_NAMESPACE ||
  (attribute.namespaceURI === null && attribute.prefix === "android");

export const androidAttribute = (
  element: Element,
  localName: string,
): string | null => {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute === null || attribute.localName !== localName) continue;
    if (isAndroidAttribute(attribute)) return attribute.nodeValue;
  }
  return null;
};
/** Build the source line index once; all locations address the same retained text. */
export const createManifestLocationReader = (source: string) => {
  const starts = [0];
  for (const match of source.matchAll(XML_LINE_ENDING))
    starts.push(match.index + match[0].length);
  return (element: Element): AndroidManifestLocation | null => {
    const line = element.lineNumber;
    const column = element.columnNumber;
    if (line === undefined || column === undefined || line < 1 || column < 1)
      return null;
    const start = starts[line - 1];
    if (start === undefined) return null;
    const offset = start + column - 1;
    return source[offset] === "<" ? { line, column, offset } : null;
  };
};
