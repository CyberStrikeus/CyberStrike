import Foundation
let archiver = NSKeyedArchiver(requiringSecureCoding: false)
archiver.outputFormat = .xml
archiver.encode(["text": "Café"] as NSDictionary, forKey: NSKeyedArchiveRootObjectKey)
archiver.finishEncoding()
let xml = String(data: archiver.encodedData, encoding: .utf8)!
let utf16 = xml.replacingOccurrences(of: "UTF-8", with: "UTF-16").data(using: .utf16)!
let _: Any = try PropertyListSerialization.propertyList(from: utf16, options: [], format: nil)
try archiver.encodedData.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
try utf16.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
let bigEndian = Data([0xfe, 0xff]) + xml.replacingOccurrences(of: "UTF-8", with: "UTF-16").data(using: .utf16BigEndian)!
let _: Any = try PropertyListSerialization.propertyList(from: bigEndian, options: [], format: nil)
try bigEndian.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
