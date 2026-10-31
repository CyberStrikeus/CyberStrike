import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let root = NSView(frame: NSRect(x: 0, y: 0, width: 80, height: 40))
root.identifier = NSUserInterfaceItemIdentifier("Café")
for name in ["Left", "Right"] {
    let child = NSView(frame: .zero)
    child.identifier = NSUserInterfaceItemIdentifier(name)
    root.addSubview(child)
}
let archiver = NSKeyedArchiver(requiringSecureCoding: false)
archiver.outputFormat = .xml
archiver.encode(root, forKey: NSKeyedArchiveRootObjectKey)
archiver.finishEncoding()
let original = archiver.encodedData
let text = String(data: original, encoding: .utf8)!
let reference = try PropertyListSerialization.propertyList(from: original, options: [], format: nil)
let referenceXML = try PropertyListSerialization.data(fromPropertyList: reference, format: .xml, options: 0)
let utf16Text = text.replacingOccurrences(of: "UTF-8", with: "UTF-16")
let representations: [String: Data] = [
    "utf8": original,
    "utf8-bom": Data([0xef, 0xbb, 0xbf]) + original,
    "utf16le": Data([0xff, 0xfe]) + utf16Text.data(using: .utf16LittleEndian)!,
    "utf16be": Data([0xfe, 0xff]) + utf16Text.data(using: .utf16BigEndian)!,
    "binary": try PropertyListSerialization.data(fromPropertyList: reference, format: .binary, options: 0),
]
for (name, bytes) in representations {
    let decoded = try PropertyListSerialization.propertyList(from: bytes, options: [], format: nil)
    let decodedXML = try PropertyListSerialization.data(fromPropertyList: decoded, format: .xml, options: 0)
    guard decodedXML == referenceXML else {
        fatalError("Foundation rejected graph parity for \(name)")
    }
    try bytes.write(to: output.appendingPathComponent("\(name).nib"))
}

// Foundation materializes opaque UID objects. Read original XML markers separately.
final class PlistElement {
    let kind: String
    var text = ""
    var children: [PlistElement] = []
    init(_ kind: String) { self.kind = kind }
}
final class PlistXMLReader: NSObject, XMLParserDelegate {
    let document = PlistElement("document")
    var stack: [PlistElement] = []
    override init() { super.init(); stack = [document] }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        let element = PlistElement(name)
        stack.last!.children.append(element)
        stack.append(element)
    }
    func parser(_ parser: XMLParser, foundCharacters text: String) { stack.last!.text += text }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) { stack.removeLast() }
}
func readPlist(_ element: PlistElement) -> Any {
    switch element.kind {
    case "plist": return readPlist(element.children[0])
    case "dict":
        guard element.children.count % 2 == 0 else { fatalError("Incomplete generated dictionary") }
        var result: [String: Any] = [:]
        for index in stride(from: 0, to: element.children.count, by: 2) {
            guard element.children[index].kind == "key" else { fatalError("Missing generated dictionary key") }
            result[element.children[index].text] = readPlist(element.children[index + 1])
        }
        return result
    case "array": return element.children.map(readPlist)
    case "string": return element.text
    case "integer": return Int(element.text)!
    case "true": return true
    case "false": return false
    default: fatalError("Unsupported generated oracle element \(element.kind)")
    }
}
let xmlReader = PlistXMLReader()
let xmlParser = XMLParser(data: original)
xmlParser.shouldResolveExternalEntities = false
xmlParser.delegate = xmlReader
guard xmlParser.parse(), let plist = xmlReader.document.children.first else {
    fatalError("Cannot read generated XML object table")
}
let originalXMLTable = readPlist(plist)

// Extract actual UID/class/identifier/parent facts, without REA or unarchiving.
guard let archive = originalXMLTable as? [String: Any],
      let table = archive["$objects"] as? [Any],
      let top = archive["$top"] as? [String: Any] else {
    fatalError("Expected a Foundation object table")
}
func uid(_ value: Any?) -> Int {
    guard let marker = value as? [String: Any], marker.count == 1,
          let number = marker["CF$UID"] as? NSNumber else {
        fatalError("Expected Foundation XML UID marker")
    }
    return number.intValue
}
let rootUID = uid(top[NSKeyedArchiveRootObjectKey])
guard let rootFields = table[rootUID] as? [String: Any],
      let collection = table[uid(rootFields["NSSubviews"])] as? [String: Any],
      let childReferences = collection["NS.objects"] as? [Any] else {
    fatalError("Expected serialized NSView subviews")
}
let childUIDs = childReferences.map { uid($0) }
var views: [[String: Any]] = []
for index in [rootUID] + childUIDs {
    guard let fields = table[index] as? [String: Any],
          let descriptor = table[uid(fields["$class"])] as? [String: Any],
          descriptor["$classname"] as? String == "NSView",
          let identifier = table[uid(fields["NSReuseIdentifierKey"])] as? String else {
        fatalError("Expected NSView class and serialized identifier")
    }
    if index != rootUID && uid(fields["NSSuperview"]) != rootUID {
        fatalError("Foundation did not retain the expected parent link")
    }
    views.append(["uid": index, "identifier": identifier])
}
guard views.compactMap({ $0["identifier"] as? String }) == ["Café", "Left", "Right"] else {
    fatalError("Foundation did not retain the authored identifiers")
}
let oracle: [String: Any] = ["rootUID": rootUID, "childUIDs": childUIDs, "views": views]
try JSONSerialization.data(withJSONObject: oracle, options: [.sortedKeys])
    .write(to: output.appendingPathComponent("oracle.json"))

// Deliberately invalid controls are separate from the native-validated representations.
try Data([0xff, 0xfe, 0x3c]).write(to: output.appendingPathComponent("incomplete-utf16.nib"))
try Data(utf16Text.utf8).write(to: output.appendingPathComponent("utf8-declared-utf16.nib"))
try (Data([0xff, 0xfe]) + text.data(using: .utf16LittleEndian)!).write(to: output.appendingPathComponent("utf16-declared-utf8.nib"))
try Data(text.replacingOccurrences(of: "UTF-8", with: "REA-UNSUPPORTED").utf8)
    .write(to: output.appendingPathComponent("unsupported-declaration.nib"))
try Data(text.replacingOccurrences(of: "UTF-8", with: "ISO-8859-1").utf8)
    .write(to: output.appendingPathComponent("latin1-declaration.nib"))

guard let identifierRange = original.range(of: Data("Café".utf8)) else {
    fatalError("Expected literal UTF-8 identifier in generated XML")
}
var invalidUTF8 = original
invalidUTF8[identifierRange.lowerBound] = 0xff
try invalidUTF8.write(to: output.appendingPathComponent("invalid-utf8.nib"))
