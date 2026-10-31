import { markPlistDictionary } from "./apple/plistUid.js";
import type { Node } from "@xmldom/xmldom";

import { readXmlPlistSource } from "./propertyListXmlSource.js";

import { createPlistNumberCollector } from "./apple/plistNumbers.js";
import { UnknownPlistScalar } from "./apple/unknownPlistScalar.js";
import { MAX_PLIST_DEPTH } from "./apple/plistValue.js";
import {
  decodeXmlPlistDateLiteral,
  parseXmlPlistIntegerLiteral,
  parseXmlPlistRealLiteral,
} from "./propertyListXmlScalar.js";

/** Own source interpretation, depth, values and numeric facts together. */
export const decodeXmlPropertyList = (
  text: string,
  maximumDepth = MAX_PLIST_DEPTH,
) => {
  const source = readXmlPlistSource(text, maximumDepth);
  const document = source.document;
  const root = document.documentElement;
  if (root?.nodeName !== "plist")
    throw new TypeError("malformed document. First element should be <plist>");
  const numbers = createPlistNumberCollector();
  const textNode = (node: Node) => node.nodeType === node.TEXT_NODE;
  const characterNode = (node: Node) =>
    textNode(node) || node.nodeType === node.CDATA_SECTION_NODE;
  const content = (node: Node, accepts: (child: Node) => boolean) => {
    let text = "";
    for (
      let child = node.firstChild;
      child !== null;
      child = child.nextSibling
    ) {
      if (accepts(child)) text += child.nodeValue ?? "";
    }
    return text;
  };
  const hasUnsupportedMarkup = (
    node: Node,
    accepts: (child: Node) => boolean,
  ): boolean => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling)
      if (!accepts(child)) return true;
    return false;
  };
  const dictionaryKey = (node: Node): string => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling)
      if (child.nodeType === child.ELEMENT_NODE)
        return String(node.firstChild?.nodeValue ?? null);
    return content(node, characterNode);
  };
  const members = function* (node: Node) {
    for (let child = node.firstChild; child !== null; child = child.nextSibling)
      if (
        child.nodeType !== child.TEXT_NODE &&
        child.nodeType !== child.CDATA_SECTION_NODE &&
        child.nodeType !== child.COMMENT_NODE &&
        child.nodeType !== child.PROCESSING_INSTRUCTION_NODE
      )
        yield child;
  };
  const decode = (node: Node): unknown => {
    switch (node.nodeName) {
      case "plist":
        return Array.from(members(node), decode);
      case "array": {
        const values: unknown[] = [];
        for (const member of members(node)) {
          const value = decode(member);
          if (value !== null) values.push(value);
        }
        return values;
      }
      case "dict": {
        const entries: [string, unknown][] = [];
        let key: string | undefined;
        for (const child of members(node)) {
          if (key === undefined) {
            if (child.nodeName !== "key")
              throw new TypeError("Missing key while parsing <dict/>");
            key = dictionaryKey(child);
          } else {
            if (child.nodeName === "key")
              throw new TypeError(
                "Unexpected <key> while parsing <dict/>. Keys and values must alternate.",
              );
            entries.push([key, decode(child)]);
            key = undefined;
          }
        }
        if (key !== undefined)
          throw new TypeError("Missing value for key while parsing <dict/>");
        // Dictionary names are data, including __proto__.
        const value = Object.fromEntries(entries);
        // XML archives use Foundation's CF$UID convention; a UID key is data.
        const keys = Object.keys(value);
        markPlistDictionary(
          value,
          keys.length === 1 &&
            keys[0] === "CF$UID" &&
            typeof value["CF$UID"] === "number"
            ? value["CF$UID"]
            : undefined,
        );
        return value;
      }
      case "key": {
        // The pinned decoder also accepted key elements as scalars. Keep their
        // first-child interpretation separate from dictionary key identities.
        const value = node.firstChild === null ? "" : node.firstChild.nodeValue;
        return value;
      }
      case "string":
        return content(node, characterNode);
      case "integer": {
        const raw = source.scalarLiteral(node);
        if (!raw.ok) throw raw.error;
        const unsupportedMarkup = hasUnsupportedMarkup(node, textNode);
        const exact = !unsupportedMarkup
          ? parseXmlPlistIntegerLiteral(raw.value)
          : undefined;
        if (exact === undefined)
          return new UnknownPlistScalar(
            "integer",
            raw.value,
            unsupportedMarkup ? "unsupported-markup" : "invalid-literal",
          );
        numbers.integer(exact);
        const decoded = Number(exact);
        // Arbitrary-precision integers are a REA extension to CF's range.
        return Number.isFinite(decoded) ? decoded : exact;
      }
      case "real": {
        const raw = source.scalarLiteral(node);
        if (!raw.ok) throw raw.error;
        if (hasUnsupportedMarkup(node, characterNode))
          return new UnknownPlistScalar(
            "real",
            raw.value,
            "unsupported-markup",
          );
        const value = parseXmlPlistRealLiteral(raw.value);
        if (!value.ok)
          return new UnknownPlistScalar("real", raw.value, value.error);
        numbers.real(value.value);
        return value.value;
      }
      case "data": {
        const value = source.dataValue(node);
        if (!value.ok) throw value.error;
        return value.value;
      }
      case "date": {
        const raw = source.scalarLiteral(node);
        if (!raw.ok) throw raw.error;
        if (hasUnsupportedMarkup(node, textNode))
          return new UnknownPlistScalar(
            "date",
            raw.value,
            "unsupported-markup",
          );
        const date = decodeXmlPlistDateLiteral(raw.value);
        return date.ok
          ? date.value
          : new UnknownPlistScalar("date", raw.value, date.error);
      }
      case "null":
        return null;
      case "true":
      case "false": {
        const raw = source.scalarLiteral(node);
        if (!raw.ok) throw raw.error;
        return raw.value === ""
          ? node.nodeName === "true"
          : new UnknownPlistScalar(
              node.nodeName,
              raw.value,
              hasUnsupportedMarkup(node, textNode)
                ? "unsupported-markup"
                : "invalid-literal",
            );
      }
      default:
        throw new TypeError(`Invalid PLIST tag ${node.nodeName}`);
    }
  };
  const values = Array.from(members(root), decode);
  return {
    value: values.length === 1 ? values[0] : values,
    numberLiterals: numbers.result(),
  };
};
