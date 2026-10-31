import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 360, height: 180), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "REA source-owned UI verification"
window.animationBehavior = .none
final class FixtureController: NSObject {
  @objc func increment(_ sender: NSButton) { sender.title = "REA fixture incremented" }
}
let controller = FixtureController()
let button = NSButton(frame: NSRect(x: 30, y: 60, width: 280, height: 40))
button.title = "Increment REA fixture"
button.target = controller
button.action = #selector(FixtureController.increment(_:))
window.contentView?.addSubview(button)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
  let record = "{\"pid\":\(ProcessInfo.processInfo.processIdentifier),\"window_id\":\(window.windowNumber)}\n"
  FileHandle.standardOutput.write(Data(record.utf8))
}
app.run()
