import Foundation

final class ReaArchiveRecord: NSObject, NSCoding {
  var link: ReaArchiveRecord?
  override init() { super.init() }
  required init?(coder: NSCoder) { super.init() }
  func encode(with coder: NSCoder) {
    coder.encode(link, forKey: "cycle")
    coder.encode(Data([0, 1, 2, 255]), forKey: "payload")
    coder.encodeConditionalObject(nil, forKey: "conditional")
  }
}
let record = ReaArchiveRecord()
record.link = record
let data = try NSKeyedArchiver.archivedData(withRootObject: [record, record] as NSArray, requiringSecureCoding: false)
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
