import AppKit

let count = Int(CommandLine.arguments[2]) ?? 40
let root = NSView(frame: .zero)
root.identifier = NSUserInterfaceItemIdentifier("root")
var parent = root
for index in 0..<count {
  let child = NSView(frame: .zero)
  child.identifier = NSUserInterfaceItemIdentifier("view-\(index)")
  parent.addSubview(child)
  parent = child
}
let archive = try NSKeyedArchiver.archivedData(
  withRootObject: root,
  requiringSecureCoding: false,
)
try archive.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
