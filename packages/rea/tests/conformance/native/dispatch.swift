public protocol ReaWitnessFixtureProtocol { func fixtureValue() -> Int }
public struct ReaWitnessFixture: ReaWitnessFixtureProtocol {
  public init() {}
  public func fixtureValue() -> Int { 17 }
}
@_cdecl("rea_witness_fixture_entry")
public func fixtureEntry() -> Int { ReaWitnessFixture().fixtureValue() }

public class ReaVtableFixture {
  public init() {}
  public func fixtureValue() -> Int { 23 }
}

public enum ReaDeclFixtureEnum { case first, second(Int) }
public struct ReaDeclFixtureOuter {
  public struct Inner { public init() {} }
}
public struct ReaDeclFixtureGeneric<Value> {
  public var value: Value
  public init(_ value: Value) { self.value = value }
}
public actor ReaDeclFixtureActor {
  public init() {}
}


// Distinct same-leaf protocols and conforming types exercise both parent chains.
public enum ReaNestedA {
  public protocol Requirement { func nestedValue() -> Int }
  public struct Implementation: Requirement {
    public init() {}
    public func nestedValue() -> Int { 31 }
  }
}
public enum ReaNestedB {
  public protocol Requirement { func nestedValue() -> Int }
  public struct Implementation: Requirement {
    public init() {}
    public func nestedValue() -> Int { 37 }
  }
}
