import AppKit
import ApplicationServices
import CryptoKit
import ScreenCaptureKit
import Darwin

struct Request: Decodable {
  var pid: Int32
  var window_id: UInt32
  var executable: String
  var sha256: String
  var launch_time: Double?
  var screenshot: Bool
  var accessibility: Bool
  var max_nodes: Int
  var action: Action?
}
struct Action: Decodable { var kind: String; var path: [Int]?; var direction: String?; var text: String? }
struct BoundaryFailure: Error { var code: String; var message: String }
func fail(_ code: String, _ message: String) throws -> Never { throw BoundaryFailure(code: code, message: message) }
func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}
func childCount(_ element: AXUIElement) -> ChildCount {
  var count = 0
  let status = AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count)
  return captureChildCount(status: status.rawValue, success: AXError.success.rawValue, value: count)
}
func children(_ element: AXUIElement, count: Int) -> ChildBatch<AXUIElement> {
  captureChildValues(requestedCount: count) {
    var value: CFArray?
    guard AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, count, &value) == .success else { return nil }
    return value as? [AXUIElement]
  }
}
func text(_ element: AXUIElement, _ key: String) -> Any { (attribute(element, key) as? String) ?? NSNull() as Any }
func windowBounds(_ element: AXUIElement) -> CGRect? {
  guard let p = attribute(element, kAXPositionAttribute), let s = attribute(element, kAXSizeAttribute),
    CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
  var point = CGPoint.zero; var size = CGSize.zero
  guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
  return CGRect(origin: point, size: size)
}
func observe(_ request: Request) async throws -> [String: Any] {
  guard let app = NSRunningApplication(processIdentifier: request.pid) else {
    try fail("pid-not-application", "LaunchServices does not expose an application for the selected PID; this does not establish that the process is absent")
  }
  guard let url = app.executableURL else {
    try fail("application-executable-unavailable", "The selected application does not expose an executable URL; select a PID with an identifiable application executable")
  }
  guard let canonicalPointer = realpath(url.path, nil) else { try fail("executable-path-unavailable", "Running executable path cannot be resolved") }
  defer { free(canonicalPointer) }
  let canonicalExecutable = String(cString: canonicalPointer)
  guard canonicalExecutable == request.executable else {
    try fail("target-mismatch", "Selected PID executable \(canonicalExecutable) differs from active target \(request.executable)")
  }
  guard let launch = app.launchDate?.timeIntervalSince1970 else {
    try fail("process-identity-unavailable", "Selected application does not expose a launch time; stable PID reuse checks are unavailable")
  }
  if let expected = request.launch_time, expected != launch { try fail("process-replaced", "Selected process was replaced") }
  let executableSize = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? -1
  guard executableSize >= 0 && executableSize <= 256 * 1024 * 1024 else { try fail("target-limit", "Running executable exceeds the 256 MiB identity-check budget") }
  let executableBytes = try Data(contentsOf: url, options: .mappedIfSafe)
  guard SHA256.hash(data: executableBytes).map({ String(format: "%02x", $0) }).joined() == request.sha256 else {
    try fail("target-mismatch", "Running executable bytes differ from the active target digest")
  }
  guard let windows = CGWindowListCopyWindowInfo([.optionIncludingWindow], request.window_id) as? [[String: Any]],
    windows.count == 1, let window = windows.first,
    (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == request.pid,
    (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
    let boundsDictionary = window[kCGWindowBounds as String] as? [String: Any],
    let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary) else {
    try fail("window-mismatch", "Selected window is absent or belongs to another process")
  }
  if request.screenshot && !CGPreflightScreenCaptureAccess() {
    try fail("screen-recording-denied", "Grant Screen Recording to the REA host in System Settings > Privacy & Security, then retry; no broad capture fallback is used")
  }
  var selected: AXUIElement?
  if request.accessibility || request.action != nil {
    guard AXIsProcessTrusted() else { try fail("accessibility-denied", "Grant Accessibility to the REA host in System Settings > Privacy & Security, then retry") }
    let application = AXUIElementCreateApplication(request.pid)
    AXUIElementSetMessagingTimeout(application, 2)
    guard let axWindows = attribute(application, kAXWindowsAttribute) as? [AXUIElement] else {
      try fail("accessibility-unavailable", "Selected application does not expose accessibility windows")
    }
    let matches = axWindows.filter { windowBounds($0) == bounds }
    guard matches.count == 1 else { try fail("ambiguous-window", "Accessibility window geometry does not identify exactly one selected window; selected CG bounds \(bounds), AX candidates \(axWindows.map { String(describing: windowBounds($0)) })") }
    selected = matches[0]
  }
  if let action = request.action, let root = selected {
    var element = root
    for index in action.path ?? [] {
      var selectedChild: CFArray?
      let count = childCount(element)
      guard let available = count.value else {
        try fail("element-count-unavailable", "Cannot validate selected accessibility path because child count failed with AXError \(count.error ?? -1)")
      }
      guard index >= 0 && index < available,
        AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, index, 1, &selectedChild) == .success,
        let item = (selectedChild as? [AXUIElement])?.first else { try fail("element-missing", "Selected accessibility path no longer exists") }
      element = item
    }
    var owner: pid_t = 0
    guard AXUIElementGetPid(element, &owner) == .success && owner == request.pid else { try fail("element-owner-mismatch", "Selected element belongs to another process") }
    let outcome: AXError
    switch action.kind {
    case "click": outcome = AXUIElementPerformAction(element, kAXPressAction as CFString)
    case "scroll": outcome = AXUIElementPerformAction(element, (action.direction == "increment" ? kAXIncrementAction : kAXDecrementAction) as CFString)
    case "key-entry": outcome = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, (action.text ?? "") as CFString)
    default: try fail("unsupported-action", "Only selected-element press, increment/decrement and text-value entry are admitted")
    }
    guard outcome == .success else { try fail("action-failed", "Accessibility action failed with AXError \(outcome.rawValue)") }
  }
  var nodes: [[String: Any]] = []; var truncated = false; var gaps: [String] = []
  if request.accessibility, let root = selected {
    var pending: [(AXUIElement, [Int])] = [(root, [])]
    while let (element, path) = pending.popLast() {
      if nodes.count >= request.max_nodes { truncated = true; break }
      let childCountResult = childCount(element)
      var actions: CFArray?
      AXUIElementCopyActionNames(element, &actions)
      let observedValue = captureAccessibilityValue(attribute(element, kAXValueAttribute))
      if let gap = observedValue.gap { gaps.append("\(gap) at path \(path)"); truncated = true }
      nodes.append(["path": path, "role": text(element, kAXRoleAttribute), "title": text(element, kAXTitleAttribute), "value": observedValue.value, "actions": actions as? [String] ?? [], "children_count": childCountResult.value.map { $0 as Any } ?? NSNull()])
      guard let totalChildren = childCountResult.value else {
        truncated = true
        gaps.append("AX child count unavailable at path \(path): AXError \(childCountResult.error ?? -1)")
        continue
      }
      if path.count >= 32 { if totalChildren > 0 { truncated = true }; continue }
      let available = max(0, request.max_nodes - nodes.count - pending.count)
      let count = min(available, totalChildren)
      let batch = children(element, count: count)
      if !batch.complete { truncated = true }
      if totalChildren > count { truncated = true }
      for (index, item) in batch.values.enumerated().reversed() {
        pending.append((item, path + [index]))
      }
    }
  }
  var screenshot: Any = NSNull()
  if request.screenshot {
    guard #available(macOS 14, *) else { try fail("unsupported-host", "Selected-window screenshots require macOS 14 or later") }
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    guard let scWindow = content.windows.first(where: { $0.windowID == request.window_id && $0.owningApplication?.processID == request.pid }) else {
      try fail("capture-window-missing", "Selected window disappeared before capture")
    }
    guard bounds.width > 0 && bounds.height > 0 && bounds.width <= 100000 && bounds.height <= 100000 else { try fail("window-bounds", "Selected window has invalid or oversized geometry") }
    let filter = SCContentFilter(desktopIndependentWindow: scWindow)
    let configuration = SCStreamConfiguration()
    let scale = min(1, 2048 / max(bounds.width, bounds.height))
    configuration.width = max(1, Int(bounds.width * scale)); configuration.height = max(1, Int(bounds.height * scale))
    configuration.showsCursor = false
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
      try fail("capture-failed", "Selected-window PNG encoding failed")
    }
    screenshot = ["mime_type": "image/png", "base64": png.base64EncodedString(), "sha256": SHA256.hash(data: png).map({ String(format: "%02x", $0) }).joined(), "width": image.width, "height": image.height]
  }
  return ["window": ["pid": request.pid, "window_id": request.window_id, "executable": request.executable, "launch_time": launch, "title": window[kCGWindowName as String] as? String ?? ""], "nodes": nodes, "truncated": truncated, "screenshot": screenshot, "gaps": request.accessibility ? gaps : ["Accessibility capture was disabled"]]
}
Task { @MainActor in
  do {
    let request = try JSONDecoder().decode(Request.self, from: Data(CommandLine.arguments[1].utf8))
    let result = try await observe(request)
    let output = try serializeHelperOutput(["ok": true, "result": result])
    FileHandle.standardOutput.write(output)
  } catch {
    let failure = error as? BoundaryFailure
    let output: [String: Any] = ["ok": false, "code": failure?.code ?? "capture-failed", "message": failure?.message ?? error.localizedDescription]
    if let data = try? serializeHelperOutput(output) { FileHandle.standardOutput.write(data) }
  }
  exit(0)
}
RunLoop.main.run()
