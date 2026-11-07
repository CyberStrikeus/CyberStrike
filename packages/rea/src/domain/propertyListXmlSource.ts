import type { Document, Node } from "@xmldom/xmldom";
import { MAX_PLIST_DEPTH, PlistNestingLimitError } from "./apple/plistValue.js";
import { err, ok, type Result } from "./result.js";
import { parseXmlDocument, XML_LINE_ENDING } from "./xmlDocument.js";
import {
  decodeXmlPlistData,
  XmlPlistDataError,
} from "./propertyListXmlData.js";

interface ScalarSpan {
  readonly start: number;
  readonly end: number;
  readonly selfClosing: boolean;
}

export class XmlPlistSourceError extends TypeError {
  readonly _tag = "XmlPlistSourceError";
  constructor() {
    super("Cannot locate XML plist scalar in its original source");
  }
}

/** One source owner binds lexical scalar values to their validated DOM nodes. */
export const readXmlPlistSource = (
  text: string,
  maximumDepth = MAX_PLIST_DEPTH,
) => {
  const normalized = text.replace(XML_LINE_ENDING, "\n");
  const parsed = parseXmlDocument(normalized, {
    doctype: "allow",
    lineEndings: "preserve",
  });
  if (!parsed.ok) throw parsed.error;
  const document = parsed.value;
  const lineEndings = new RegExp(XML_LINE_ENDING);
  let line = 1;
  let lineStart = 0;
  // The depth walk visits elements in source order, so location lookup is
  // linear without an index entry for every line in a potentially large value.
  const readSpan = (node: Node): Result<ScalarSpan, "source-location"> => {
    if (node.lineNumber === undefined || node.columnNumber === undefined)
      return err("source-location");
    while (line < node.lineNumber) {
      const ending = lineEndings.exec(text);
      if (ending === null) return err("source-location");
      lineStart = ending.index + ending[0].length;
      line += 1;
    }
    if (line !== node.lineNumber) return err("source-location");
    const start = lineStart + node.columnNumber - 1;
    const openingEnd = openingTagEnd(text, start);
    if (openingEnd < 0 || text[start] !== "<") return err("source-location");
    const selfClosing = text[openingEnd - 1] === "/";
    const end = selfClosing
      ? openingEnd + 1
      : closingTagStart(text, openingEnd + 1);
    return end < 0
      ? err("source-location")
      : ok({ start: openingEnd + 1, end, selfClosing });
  };
  const spans = collectXmlPlistScalarSpans(document, readSpan, maximumDepth);
  return {
    document,
    scalarLiteral(node: Node): Result<string, XmlPlistSourceError> {
      const span = spans.get(node);
      return span?.ok === true
        ? ok(text.slice(span.value.start, span.value.end))
        : err(new XmlPlistSourceError());
    },
    dataValue(node: Node): Result<Uint8Array, XmlPlistDataError> {
      const span = spans.get(node);
      if (node.nodeName !== "data" || span === undefined)
        return err(new XmlPlistDataError("source-location"));
      if (!span.ok) return err(new XmlPlistDataError(span.error));
      for (
        let child = node.firstChild;
        child !== null;
        child = child.nextSibling
      )
        if (child.nodeType !== child.TEXT_NODE)
          return err(new XmlPlistDataError("markup"));
      if (span.value.selfClosing)
        return err(new XmlPlistDataError("empty-element"));
      return decodeXmlPlistData(text.slice(span.value.start, span.value.end));
    },
  };
};

/** Scan validated tag syntax without treating a quoted > as its end. */
const openingTagEnd = (source: string, start: number): number => {
  let quote: string | undefined;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return cursor;
  }
  return -1;
};

/**
 * Locate an element's closing tag in validated XML. Comments, CDATA and PIs
 * can contain apparent tags; nested markup is retained as source, not decoded
 * or recursively interpreted as additional plist values.
 */
const closingTagStart = (source: string, contentStart: number): number => {
  let depth = 1;
  let cursor = contentStart;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) return -1;
    const delimiter = source.startsWith("<!--", start)
      ? "-->"
      : source.startsWith("<![CDATA[", start)
        ? "]]>"
        : source.startsWith("<?", start)
          ? "?>"
          : undefined;
    if (delimiter !== undefined) {
      const end = source.indexOf(delimiter, start + 2);
      if (end < 0) return -1;
      cursor = end + delimiter.length;
      continue;
    }
    const end = openingTagEnd(source, start);
    if (end < 0) return -1;
    if (source[start + 1] === "/") {
      depth -= 1;
      if (depth === 0) return start;
    } else if (source[end - 1] !== "/") depth += 1;
    cursor = end + 1;
  }
  return -1;
};

const PLIST_LEXICAL_SCALARS = new Set([
  "data",
  "integer",
  "real",
  "date",
  "true",
  "false",
]);

/** Elements whose children the plist value decoder visits recursively. */
const PLIST_CONTAINER_ELEMENTS = new Set(["plist", "dict", "array"]);

/**
 * Reject XML plists nested deeper than the projection supports before any
 * recursive value pass runs. Value decoding and prototype omission recurse once
 * per nesting level, so a deeply nested document exhausts the call stack
 * before the projection limit can report the resource bound. The failure
 * matches `projectPlistValue` so callers classify it as a limit failure.
 *
 * Depth counts values the way the projection does: the root value is level 0
 * and every container member is one level deeper. A dictionary key names a
 * member instead of nesting one, and a self-closing element is the value at
 * its own level. The outer plist envelope is unwrapped by the decoder;
 * nested plist elements decode as arrays and must count toward the bound.
 */
const collectXmlPlistScalarSpans = (
  document: Document,
  readSpan: (node: Node) => Result<ScalarSpan, "source-location">,
  maximumDepth: number,
): WeakMap<Node, Result<ScalarSpan, "source-location">> => {
  const spans = new WeakMap<Node, Result<ScalarSpan, "source-location">>();
  const root = document.documentElement;
  if (root === null) return spans;
  const pending: Array<{ node: Node; depth: number }> = [
    { node: root, depth: -1 },
  ];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { node, depth } = entry;
    // Schedule only the next sibling, keeping traversal storage proportional
    // to depth rather than the number of members in a wide container.
    if (node.nextSibling !== null)
      pending.push({ node: node.nextSibling, depth });
    if (node.nodeType !== node.ELEMENT_NODE) continue;
    if (node.nodeName !== "key" && depth > maximumDepth)
      throw new PlistNestingLimitError(maximumDepth);
    if (PLIST_LEXICAL_SCALARS.has(node.nodeName))
      spans.set(node, readSpan(node));
    if (PLIST_CONTAINER_ELEMENTS.has(node.nodeName) && node.firstChild !== null)
      pending.push({ node: node.firstChild, depth: depth + 1 });
  }
  return spans;
};
