import Foundation
import CoreFoundation

struct AccessibilityValue {
  let value: Any
  let gap: String?
}

/** Preserve JSON scalars; report successful reads that JSON cannot represent faithfully. */
func captureAccessibilityValue(_ source: Any?) -> AccessibilityValue {
  guard let source else { return AccessibilityValue(value: NSNull(), gap: nil) }
  if let text = source as? String { return AccessibilityValue(value: text, gap: nil) }
  if let number = source as? NSNumber {
    if CFGetTypeID(number) == CFBooleanGetTypeID() {
      return AccessibilityValue(value: number.boolValue, gap: nil)
    }
    let value = number.doubleValue
    let encoding = String(cString: number.objCType)
    let floating = encoding == "f" || encoding == "d"
    if number is NSDecimalNumber || !value.isFinite || (value == 0 && value.sign == .minus) || (!floating && abs(value) > 9_007_199_254_740_991) {
      return AccessibilityValue(value: NSNull(), gap: "AXValue number \(number.stringValue) cannot be represented faithfully as a JSON number")
    }
    return AccessibilityValue(value: number, gap: nil)
  }
  return AccessibilityValue(value: NSNull(), gap: "AXValue type \(type(of: source)) is not a supported JSON scalar")
}
