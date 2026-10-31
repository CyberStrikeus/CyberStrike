import Foundation

struct RunTokenResponse: Encodable {
  let results: [RunTokenObservation]
}

struct ProcessIdentityResponse: Encodable {
  let results: [ProcessIdentityObservation]
}

@main
struct ProcessRunTokenReaderMain {
  static func main() {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let identityMode = arguments.first == "--identities"
    let pidArguments = identityMode ? Array(arguments.dropFirst()) : arguments
    let pids = pidArguments.compactMap(Int32.init)
    guard pids.count == pidArguments.count else {
      fputs("invalid process ID input\n", stderr)
      exit(64)
    }
    do {
      let output: Data
      if identityMode {
        output = try JSONEncoder().encode(ProcessIdentityResponse(results: readProcessIdentities(pids: pids)))
      } else {
        output = try JSONEncoder().encode(RunTokenResponse(results: readRunTokens(pids: pids)))
      }
      FileHandle.standardOutput.write(output)
    } catch {
      fputs("could not encode process token observations\n", stderr)
      exit(70)
    }
  }
}
