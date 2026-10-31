import Foundation

struct ChildBatch<Element> {
  let values: [Element]
  let complete: Bool
}

struct ChildCount {
  let value: Int?
  let error: Int32?
}

func serializeHelperOutput(_ value: Any) throws -> Data {
  try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
}

func captureChildCount(status: Int32, success: Int32, value: Int) -> ChildCount {
  guard status == success else { return ChildCount(value: nil, error: status) }
  return ChildCount(value: value, error: nil)
}

func captureChildValues<Element>(requestedCount: Int, copy: () -> [Element]?) -> ChildBatch<Element> {
  guard requestedCount > 0 else { return ChildBatch(values: [], complete: true) }
  let returned = copy() ?? []
  let values = Array(returned.prefix(requestedCount))
  return ChildBatch(values: values, complete: values.count == requestedCount)
}
