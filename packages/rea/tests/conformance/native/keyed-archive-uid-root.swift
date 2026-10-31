import Foundation

// Encode roots under keys that match both binary and XML UID marker spellings.
let archiver = NSKeyedArchiver(requiringSecureCoding: false)
archiver.encode("payload" as NSString, forKey: "UID")
archiver.encode("payload" as NSString, forKey: "CF$UID")
archiver.finishEncoding()
try archiver.encodedData.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
