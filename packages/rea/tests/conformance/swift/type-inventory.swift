protocol Scoring { func score(_ x: Int) -> Int }
struct Pair { var a: Int; var b: Int }
struct Scorer: Scoring {
  @inline(never) func score(_ x: Int) -> Int { x + 29 }
}
@inline(never)
func swiftIndirect(_ s: any Scoring, _ x: Int) -> Int { s.score(x) }
@inline(never)
func swiftPair(_ p: Pair) -> Int { p.a + 3 * p.b }
print(swiftIndirect(Scorer(), CommandLine.arguments.count) + swiftPair(Pair(a: 1, b: 2)))
