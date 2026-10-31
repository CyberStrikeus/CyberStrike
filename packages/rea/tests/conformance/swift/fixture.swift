import Darwin

protocol REAProtocol { func execute() -> Int }
struct REARecord { let value: Int }
enum REAState { case ready, finished }
final class REAService: REAProtocol {
  @inline(never) func execute() -> Int { print("REA_SWIFT_EXECUTE"); return 42 }
}
extension REARecord { @inline(never) func doubled() -> Int { value * 2 } }
let service = REAService()
exit(service.execute() == 42 ? 0 : 1)
