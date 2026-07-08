// The single XML → JS-object boundary. fast-xml-parser is isolated here so the rest of
// normalize treats parsed XML as a plain object — walked by the SAME keyPaths (shape) and
// jsonLeaves (slots) as JSON, so SOAP/XML needs no bespoke shape/value code. The parser is
// swappable behind parseXmlToObject() without touching callers.
//
// Config chosen from measured real SOAP (dneonline / oorsprong CountryInfo):
//   removeNSPrefix    — key on the LOCAL name (soap:/m: prefixes vary per service; the local
//                       name is stable → the endpoint shape doesn't fork on a prefix rename).
//   ignoreDeclaration — drop the <?xml ...?> node; it is pure noise in shape/slots.
//   ignoreAttributes  — false + "@" prefix: attribute values (e.g. <user id="42">) carry
//                       IDOR/access-control substrate, so they must be observable.
//   parseTagValue     — false: keep leaf values as raw strings (we hash/observe strings).
import { XMLParser } from "fast-xml-parser"

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreDeclaration: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
})

/**
 * Parse an XML/SOAP body to a plain JS object, or undefined if it is not usable XML.
 * fast-xml-parser is lenient (won't throw on most malformed input), so we also reject an
 * empty/non-object result — those fall through to the raw-body handling, exactly as before.
 */
export function parseXmlToObject(body: string): unknown | undefined {
  let obj: unknown
  try {
    obj = parser.parse(body)
  } catch {
    return undefined
  }
  if (obj && typeof obj === "object" && Object.keys(obj as Record<string, unknown>).length > 0) return obj
  return undefined
}
