import Foundation
import CryptoKit

// Foundation writes the archive. XMLParser only observes inert plist element types.
final class PlistElements: NSObject, XMLParserDelegate {
  struct Frame {
    let kind: String
    var values: [Any] = []
    var fields: [String: Any] = [:]
    var key: String?
    var text = ""
  }
  var frames: [Frame] = []
  var value: Any?
  func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
    frames.append(Frame(kind: name))
  }
  func parser(_ parser: XMLParser, foundCharacters text: String) {
    if !frames.isEmpty { frames[frames.count - 1].text += text }
  }
  func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
    let frame = frames.removeLast()
    if name == "key" {
      frames[frames.count - 1].key = frame.text
      return
    }
    let item: Any
    switch name {
    case "dict": item = frame.fields
    case "array": item = frame.values
    case "integer", "real":
      item = ["numberKind": name, "literal": frame.text.trimmingCharacters(in: .whitespacesAndNewlines)]
    case "string": item = frame.text
    case "true": item = true
    case "false": item = false
    case "plist": value = frame.values.first; return
    default: parser.abortParsing(); return
    }
    if frames.last?.kind == "dict" {
      guard let key = frames.last?.key else { parser.abortParsing(); return }
      frames[frames.count - 1].fields[key] = item
      frames[frames.count - 1].key = nil
    } else if !frames.isEmpty {
      frames[frames.count - 1].values.append(item)
    }
  }
}
func elements(_ bytes: Data) throws -> [String: Any] {
  let delegate = PlistElements()
  let parser = XMLParser(data: bytes)
  parser.shouldResolveExternalEntities = false
  parser.delegate = delegate
  guard parser.parse(), let value = delegate.value as? [String: Any] else {
    throw NSError(domain: "REA.IntegerOracle", code: 1)
  }
  return value
}
func rows(_ value: Any, path: [Any] = []) -> [[String: Any]] {
  if let fields = value as? [String: Any] {
    // Reference markers identify objects; their UID is not an archived numeric value.
    if fields.count == 1 && fields["CF$UID"] != nil { return [] }
    if let kind = fields["numberKind"] as? String, let literal = fields["literal"] as? String {
      return [["path": path, "kind": kind, "literal": literal]]
    }
    return fields.keys.sorted().flatMap { rows(fields[$0]!, path: path + [$0]) }
  }
  if let values = value as? [Any] {
    return values.enumerated().flatMap { rows($0.element, path: path + [$0.offset]) }
  }
  return []
}
func literal(_ value: Any?, kind: String) throws -> String {
  guard let fields = value as? [String: String], fields["numberKind"] == kind, let text = fields["literal"] else {
    throw NSError(domain: "REA.IntegerOracle", code: 2)
  }
  return text
}
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let positive: Int64 = 9_007_199_254_740_993
let negative: Int64 = Int64.min
let unsigned: UInt64 = 9_007_199_254_740_993
let real: Double = 9_007_199_254_740_992
var archives: [String: Any] = [:]
for format in ["xml", "binary"] {
  let archiver = NSKeyedArchiver(requiringSecureCoding: false)
  archiver.outputFormat = format == "xml" ? .xml : .binary
  archiver.encode(positive, forKey: "unsafeSigned")
  archiver.encode(negative, forKey: "unsafeNegative")
  archiver.encode(Int64(9_007_199_254_740_991), forKey: "safeInteger")
  archiver.encode(Int64(-42), forKey: "safeNegative")
  archiver.encode(real, forKey: "integralReal")
  archiver.encode(NSNumber(value: unsigned), forKey: "boxedUnsigned")
  archiver.encode(NSNumber(value: real), forKey: "boxedReal")
  archiver.finishEncoding()
  let bytes = archiver.encodedData
  let native = try PropertyListSerialization.propertyList(from: bytes, options: [], format: nil)
  let xml = try PropertyListSerialization.data(fromPropertyList: native, format: .xml, options: 0)
  let parsed = try elements(xml)
  guard let top = parsed["$top"] as? [String: Any], let table = parsed["$objects"] as? [Any] else {
    throw NSError(domain: "REA.IntegerOracle", code: 3)
  }
  guard try literal(top["unsafeSigned"], kind: "integer") == String(positive),
        try literal(top["unsafeNegative"], kind: "integer") == String(negative),
        try literal(top["safeInteger"], kind: "integer") == "9007199254740991",
        try literal(top["safeNegative"], kind: "integer") == "-42",
        Double(try literal(top["integralReal"], kind: "real")) == real else {
    throw NSError(domain: "REA.IntegerOracle", code: 4)
  }
  var selectedRows: [[String: Any]] = []
  for key in ["unsafeSigned", "unsafeNegative", "safeInteger", "safeNegative", "integralReal"] {
    for row in rows(top[key]!) {
      selectedRows.append(row.merging(["container": "roots", "path": [key], "root": key]) { _, rhs in rhs })
    }
  }
  for key in ["boxedUnsigned", "boxedReal"] {
    guard let reference = top[key] as? [String: Any],
          let uid = Int(try literal(reference["CF$UID"], kind: "integer")), uid > 0, uid < table.count else {
      throw NSError(domain: "REA.IntegerOracle", code: 5)
    }
    let numericRows = rows(table[uid])
    let expectedKind = key == "boxedUnsigned" ? "integer" : "real"
    guard numericRows.contains(where: { row in
      guard row["kind"] as? String == expectedKind, let text = row["literal"] as? String else { return false }
      return key == "boxedUnsigned" ? text == String(unsigned) : Double(text) == real
    }) else { throw NSError(domain: "REA.IntegerOracle", code: 6) }
    for row in numericRows {
      selectedRows.append(row.merging(["container": "objects", "objectId": uid, "root": key]) { _, rhs in rhs })
    }
  }
  let filename = "numbers.\(format).plist"
  try bytes.write(to: output.appendingPathComponent(filename))
  archives[format] = ["filename": filename, "sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), "rows": selectedRows]
}
try JSONSerialization.data(withJSONObject: archives, options: [.sortedKeys]).write(to: output.appendingPathComponent("oracle.json"))
