import AppKit
import CryptoKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let root = NSView(frame: NSRect(x: 0, y: 0, width: 80, height: 40))
root.identifier = NSUserInterfaceItemIdentifier("Root")
for name in ["Kept", "Changed"] {
    let child = NSView(frame: .zero)
    child.identifier = NSUserInterfaceItemIdentifier(name)
    root.addSubview(child)
}
func archiveView(includeNil: Bool) -> Data {
    let archiver = NSKeyedArchiver(requiringSecureCoding: false)
    archiver.outputFormat = .xml
    archiver.encode(root, forKey: NSKeyedArchiveRootObjectKey)
    if includeNil { archiver.encode(nil as Any?, forKey: "OptionalNil") }
    archiver.finishEncoding()
    return archiver.encodedData
}

// Foundation reads UID markers as opaque objects. Preserve XML markers for the oracle.
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
        guard element.children.count % 2 == 0 else { fatalError("Incomplete dictionary") }
        var result: [String: Any] = [:]
        for index in stride(from: 0, to: element.children.count, by: 2) {
            guard element.children[index].kind == "key" else { fatalError("Missing key") }
            result[element.children[index].text] = readPlist(element.children[index + 1])
        }
        return result
    case "array": return element.children.map(readPlist)
    case "string": return element.text
    case "integer": return Int(element.text)!
    case "real": return Double(element.text)!
    case "true": return true
    case "false": return false
    default: fatalError("Unexpected NSView plist element \(element.kind)")
    }
}
func readXML(_ bytes: Data) -> [String: Any] {
    let reader = PlistXMLReader()
    let parser = XMLParser(data: bytes)
    parser.shouldResolveExternalEntities = false
    parser.delegate = reader
    guard parser.parse(), let plist = reader.document.children.first,
          let value = readPlist(plist) as? [String: Any] else {
        fatalError("Cannot read Foundation XML object table")
    }
    return value
}
func canonicalFoundationXML(_ bytes: Data) throws -> Data {
    let value = try PropertyListSerialization.propertyList(from: bytes, options: [], format: nil)
    return try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0)
}
func json(_ value: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
}
func uid(_ value: Any?) -> Int {
    guard let marker = value as? [String: Any], marker.count == 1,
          let number = marker["CF$UID"] as? NSNumber else {
        fatalError("Expected XML UID marker")
    }
    return number.intValue
}
let original = archiveView(includeNil: false)
let originalFields = readXML(original)
guard let table = originalFields["$objects"] as? [Any],
      table.first as? String == "$null",
      let top = originalFields["$top"] as? [String: Any] else {
    fatalError("Expected NSKeyedArchiver table and nil sentinel")
}
let rootUID = uid(top[NSKeyedArchiveRootObjectKey])
guard let rootFields = table[rootUID] as? [String: Any] else { fatalError("Missing NSView root") }
let collectionUID = uid(rootFields["NSSubviews"])
guard let collection = table[collectionUID] as? [String: Any],
      let references = collection["NS.objects"] as? [Any], references.count == 2 else {
    fatalError("Missing actual NSView child collection")
}
let children = references.map { uid($0) }
var views: [[String: Any]] = []
for index in [rootUID] + children {
    guard let fields = table[index] as? [String: Any],
          let descriptor = table[uid(fields["$class"])] as? [String: Any],
          descriptor["$classname"] as? String == "NSView",
          let identifier = table[uid(fields["NSReuseIdentifierKey"])] as? String else {
        fatalError("Expected actual NSView identity")
    }
    if index != rootUID && uid(fields["NSSuperview"]) != rootUID {
        fatalError("Expected reciprocal parent UID")
    }
    views.append(["uid": index, "identifier": identifier])
}
guard views.compactMap({ $0["identifier"] as? String }) == ["Root", "Kept", "Changed"] else {
    fatalError("Unexpected native identifiers")
}

// Check generic XML-marker serialization against Foundation's opaque UID interpretation.
let rewrittenOriginal = try PropertyListSerialization.data(fromPropertyList: originalFields, format: .xml, options: 0)
guard try canonicalFoundationXML(original) == canonicalFoundationXML(rewrittenOriginal) else {
    fatalError("Oracle changed the native archived property list")
}
let danglingUID = table.count + 1
var changedReferences = references
changedReferences[1] = ["CF$UID": danglingUID]
var changedCollection = collection
changedCollection["NS.objects"] = changedReferences
var changedTable = table
changedTable[collectionUID] = changedCollection
var mutantFields = originalFields
mutantFields["$objects"] = changedTable
let dangling = try PropertyListSerialization.data(fromPropertyList: mutantFields, format: .xml, options: 0)
_ = try canonicalFoundationXML(dangling) // Plist syntax is valid; its reference is deliberately malformed.
let rereadMutant = readXML(dangling)
guard try json(rereadMutant) == json(mutantFields) else { fatalError("Mutant serialization changed the table") }

// Independent inverse comparison proves exactly one actual serialized UID slot changed.
guard var restoredTable = rereadMutant["$objects"] as? [Any],
      var restoredCollection = restoredTable[collectionUID] as? [String: Any],
      var restoredReferences = restoredCollection["NS.objects"] as? [Any],
      uid(restoredReferences[1]) == danglingUID else { fatalError("Missing mutated child UID") }
restoredReferences[1] = references[1]
restoredCollection["NS.objects"] = restoredReferences
restoredTable[collectionUID] = restoredCollection
var restoredArchive = rereadMutant
restoredArchive["$objects"] = restoredTable
guard try json(restoredArchive) == json(originalFields) else { fatalError("More than one UID slot changed") }

// A real optional top-level nil is not a synthetic nil element in an NSArray.
let nilControl = archiveView(includeNil: true)
var nilFields = readXML(nilControl)
guard var nilTop = nilFields["$top"] as? [String: Any], uid(nilTop["OptionalNil"]) == 0 else {
    fatalError("Foundation did not encode optional nil as UID0")
}
nilTop.removeValue(forKey: "OptionalNil")
nilFields["$top"] = nilTop
guard try json(nilFields) == json(originalFields) else { fatalError("Optional nil changed the object graph") }
_ = try canonicalFoundationXML(nilControl)
let files = ["original": original, "optional-nil": nilControl, "dangling-child": dangling]
var digests: [String: String] = [:]
for (name, bytes) in files {
    try bytes.write(to: output.appendingPathComponent("\(name).nib"))
    digests[name] = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}
let oracle: [String: Any] = [
    "rootUID": rootUID, "childUIDs": children, "collectionUID": collectionUID,
    "danglingUID": danglingUID, "tableLength": table.count,
    "views": views, "nilUID": 0, "nilSentinel": "$null", "digests": digests,
    "mutationPath": ["$objects", String(collectionUID), "NS.objects", "1", "CF$UID"],
]
try json(oracle).write(to: output.appendingPathComponent("oracle.json"))
