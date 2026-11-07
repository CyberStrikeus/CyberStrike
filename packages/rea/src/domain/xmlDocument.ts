import { DOMParser, onErrorStopParsing, type Document } from "@xmldom/xmldom";
import { SaxesParser } from "saxes";
import { err, ok, type Result } from "./result.js";

/** XML 1.0 literal line endings; Unicode separators remain source characters. */
export const XML_LINE_ENDING = /\r\n?|\n/gu;

export class XmlDocumentParseError extends Error {
  readonly _tag = "XmlDocumentParseError";
  constructor(
    readonly reason: "malformed" | "doctype",
    cause?: unknown,
  ) {
    super(
      reason === "doctype"
        ? "XML document types are unsupported"
        : `XML is not well-formed${cause instanceof Error ? `: ${cause.message}` : ""}`,
      { cause },
    );
  }
}

/** One boundary owns strict XML syntax and the source-located DOM projection. */
export const parseXmlDocument = (
  source: string,
  policy: {
    readonly doctype: "allow" | "reject";
    readonly lineEndings: "preserve" | "normalize";
  },
): Result<Document, XmlDocumentParseError> => {
  try {
    const syntax = new SaxesParser({
      xmlns: true,
      defaultXMLVersion: "1.0",
      forceXMLVersion: true,
    });
    syntax.on("doctype", () => {
      if (policy.doctype === "reject")
        throw new XmlDocumentParseError("doctype");
    });
    syntax.write(source).close();
    // Saxes owns well-formedness outside DTDs. The DOM parser additionally
    // checks DTD syntax and builds source-located nodes; its advisory warnings
    // (including literal U+FFFD) are not byte-decoding or syntax failures.
    return ok(
      new DOMParser({
        normalizeLineEndings:
          policy.lineEndings === "preserve"
            ? (text) => text
            : (text) => text.replace(XML_LINE_ENDING, "\n"),
        onError: onErrorStopParsing,
      }).parseFromString(source, "application/xml"),
    );
  } catch (cause: unknown) {
    return err(
      cause instanceof XmlDocumentParseError
        ? cause
        : new XmlDocumentParseError("malformed", cause),
    );
  }
};
