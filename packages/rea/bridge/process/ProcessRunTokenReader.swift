import Darwin
import Foundation

struct RunTokenObservation: Encodable {
  let pid: Int32
  let state: String
  let run_id: String?
  let reason: String?
}

struct ProcessIdentityObservation: Encodable {
  let pid: Int32
  let state: String
  let identity: String?
  let effective_uid: UInt32?
  let lifecycle: String?
  let relation: ProcessRelationObservation?
  let reason: String?
}

struct ProcessRelationObservation: Encodable {
  let state: String
  let parent_pid: Int32
  let process_group_id: Int32
}

struct ProcessMetadata {
  let identity: String
  let effectiveUid: UInt32
  let lifecycle: String
  let parentPid: Int32
  let processGroupId: Int32
  let pointerSize: Int
}

struct ProcessSnapshot {
  let metadata: [Int32: ProcessMetadata]
  let failure: String?
}

typealias ProcessTableSysctlCall = (
  _ mib: inout [Int32],
  _ output: UnsafeMutableRawPointer?,
  _ size: inout Int
) -> Int32

private func readProcessSnapshot() -> ProcessSnapshot {
  readProcessSnapshot { mib, output, size in
    sysctl(&mib, u_int(mib.count), output, &size, nil, 0)
  }
}

func readProcessSnapshot(
  sysctlCall: ProcessTableSysctlCall
) -> ProcessSnapshot {
  for _ in 0..<3 {
    var mib = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    var size = 0
    guard sysctlCall(&mib, nil, &size) == 0 else {
      let failure = errno
      return ProcessSnapshot(metadata: [:], failure: "process_table_failed_\(failure)")
    }
    guard size >= MemoryLayout<kinfo_proc>.size,
          size % MemoryLayout<kinfo_proc>.stride == 0 else {
      return ProcessSnapshot(metadata: [:], failure: "process_table_failed_\(errno)")
    }
    var processes = [kinfo_proc](
      repeating: kinfo_proc(),
      count: size / MemoryLayout<kinfo_proc>.stride
    )
    let result = processes.withUnsafeMutableBufferPointer { buffer in
      let output = buffer.baseAddress.map { UnsafeMutableRawPointer($0) }
      return sysctlCall(&mib, output, &size)
    }
    guard result == 0 else {
      let failure = errno
      if failure == ENOMEM { continue }
      return ProcessSnapshot(metadata: [:], failure: "process_table_failed_\(failure)")
    }
    guard size % MemoryLayout<kinfo_proc>.stride == 0 else {
      return ProcessSnapshot(metadata: [:], failure: "process_table_failed_\(errno)")
    }
    let processCount = size / MemoryLayout<kinfo_proc>.stride
    let metadata = Dictionary(
      processes.prefix(processCount).map { process in
        let start = process.kp_proc.p_starttime
        return (
          process.kp_proc.p_pid,
          ProcessMetadata(
            identity: "\(start.tv_sec):\(start.tv_usec)",
            effectiveUid: process.kp_eproc.e_ucred.cr_uid,
            lifecycle: process.kp_proc.p_stat == SZOMB ? "zombie" : "non-zombie",
            parentPid: process.kp_eproc.e_ppid,
            processGroupId: process.kp_eproc.e_pgid,
            pointerSize: process.kp_proc.p_flag & P_LP64 != 0 ? 8 : 4
          )
        )
      },
      uniquingKeysWith: { first, _ in first }
    )
    return ProcessSnapshot(metadata: metadata, failure: nil)
  }
  return ProcessSnapshot(metadata: [:], failure: "process_table_failed_\(ENOMEM)")
}

func readProcessIdentities(pids: [Int32]) -> [ProcessIdentityObservation] {
  readProcessIdentities(pids: pids, snapshot: readProcessSnapshot())
}

func readProcessIdentities(
  pids: [Int32],
  snapshot: ProcessSnapshot
) -> [ProcessIdentityObservation] {
  return pids.map { pid in
    guard pid > 0 else {
      return unavailableIdentity(pid: pid, reason: "invalid_process_id")
    }
    guard let metadata = snapshot.metadata[pid] else {
      if let failure = snapshot.failure {
        return unavailableIdentity(pid: pid, reason: failure)
      }
      // This records absence from this successful KERN_PROC_ALL snapshot only.
      // Unlike the Linux procfs path, it has no PID-specific kill(0)
      // corroboration; callers must not treat it as universal or future exit
      // proof.
      return ProcessIdentityObservation(
        pid: pid,
        state: "absent",
        identity: nil,
        effective_uid: nil,
        lifecycle: nil,
        relation: nil,
        reason: "not-in-snapshot"
      )
    }
    return ProcessIdentityObservation(
      pid: pid,
      state: "readable",
      identity: metadata.identity,
      effective_uid: metadata.effectiveUid,
      lifecycle: metadata.lifecycle,
      relation: ProcessRelationObservation(
        state: "observed",
        parent_pid: metadata.parentPid,
        process_group_id: metadata.processGroupId
      ),
      reason: nil
    )
  }
}

private func unavailableIdentity(pid: Int32, reason: String) -> ProcessIdentityObservation {
  ProcessIdentityObservation(
    pid: pid,
    state: "unavailable",
    identity: nil,
    effective_uid: nil,
    lifecycle: nil,
    relation: nil,
    reason: reason
  )
}

enum ProcargsMalformedStage: String, CaseIterable {
  case header
  case argumentCount = "argument_count"
  case executablePath = "executable_path"
  case pointerSize = "pointer_size"
  case pathPadding = "path_padding"
  case arguments
  case terminator
  case trailingEntries = "trailing_entries"
}

enum RunTokenReadError: Error {
  case invalidBuffer
  case invalidBufferAt(ProcargsMalformedStage)
  case duplicateToken
  case invalidTokenEncoding
  case environmentUnavailable
  case appleVectorUnavailable
  case ambiguousEnvironmentBoundary
}

struct ParsedRunToken {
  let runId: String?
  let environmentEntryCount: Int
}

@_silgen_name("csops")
private func csops(
  _ pid: Int32,
  _ ops: UInt32,
  _ addr: UnsafeMutableRawPointer?,
  _ size: Int
) -> Int32

private let csOpsStatus: UInt32 = 0
private let csPlatformBinary: UInt32 = 0x0400_0000
private let csRestrict: UInt32 = 0x0000_0800

/** Read the target's current code-signing flags when csops permits inspection. */
private func codeSigningFlags(pid: Int32) -> UInt32? {
  var flags: UInt32 = 0
  let result = withUnsafeMutablePointer(to: &flags) { pointer in
    csops(pid, csOpsStatus, UnsafeMutableRawPointer(pointer), MemoryLayout<UInt32>.size)
  }
  return result == 0 ? flags : nil
}

/** Derive one process-token observation from parser facts and native flags. */
func processRunTokenObservation(
  pid: Int32,
  parse: Result<ParsedRunToken, RunTokenReadError>,
  codeSigningFlags: () -> UInt32?
) -> RunTokenObservation {
  switch parse {
  case .success(let parsed):
    if let runId = parsed.runId {
      return RunTokenObservation(pid: pid, state: "readable", run_id: runId, reason: nil)
    }
    // A non-empty environment without REA's token proves this candidate is
    // unrelated. CS_RESTRICT cannot turn that readable fact into uncertainty.
    if parsed.environmentEntryCount > 0 {
      return RunTokenObservation(pid: pid, state: "readable", run_id: nil, reason: nil)
    }
    let flags = codeSigningFlags()
    if let flags, (flags & csPlatformBinary) != 0 {
      return unavailable(pid: pid, reason: "platform_binary_environment_withheld")
    }
    if let flags, (flags & csRestrict) != 0 {
      return unavailable(pid: pid, reason: "restricted_process_environment_withheld")
    }
    return RunTokenObservation(pid: pid, state: "readable", run_id: nil, reason: nil)
  case .failure(let failure):
    switch failure {
    case .environmentUnavailable:
      let flags = codeSigningFlags()
      if let flags, (flags & csPlatformBinary) != 0 {
        return unavailable(pid: pid, reason: "platform_binary_environment_withheld")
      }
      if let flags, (flags & csRestrict) != 0 {
        return unavailable(pid: pid, reason: "restricted_process_environment_withheld")
      }
      return unavailable(pid: pid, reason: "environment_unavailable")
    case .ambiguousEnvironmentBoundary:
      if let flags = codeSigningFlags(), (flags & csRestrict) != 0 {
        return unavailable(pid: pid, reason: "restricted_process_environment_withheld")
      }
      return unavailable(pid: pid, reason: "ambiguous_environment_boundary")
    case .duplicateToken:
      return unavailable(pid: pid, reason: "duplicate_run_token")
    case .invalidTokenEncoding:
      return unavailable(pid: pid, reason: "invalid_run_token_encoding")
    case .appleVectorUnavailable:
      return unavailable(pid: pid, reason: "apple_vector_unavailable")
    case .invalidBuffer:
      return unavailable(pid: pid, reason: "malformed_procargs")
    case .invalidBufferAt(let stage):
      return unavailable(pid: pid, reason: "malformed_procargs_\(stage.rawValue)")
    }
  }
}

private func readRunToken(pid: Int32, pointerSize: Int) -> RunTokenObservation {
  var mib = [CTL_KERN, KERN_PROCARGS2, Int32(pid)]
  var size = 0
  guard sysctl(&mib, u_int(mib.count), nil, &size, nil, 0) == 0, size >= MemoryLayout<Int32>.size else {
    return unavailable(pid: pid, reason: "sysctl_failed_\(errno)")
  }
  var bytes = [UInt8](repeating: 0, count: size)
  let result = bytes.withUnsafeMutableBytes { buffer in
    sysctl(&mib, u_int(mib.count), buffer.baseAddress, &size, nil, 0)
  }
  guard result == 0 else {
    return unavailable(pid: pid, reason: "sysctl_failed_\(errno)")
  }
  bytes = Array(bytes.prefix(size))
  let parse: Result<ParsedRunToken, RunTokenReadError>
  do {
    parse = .success(try parseProcessEnvironment(in: bytes, pointerSize: pointerSize))
  } catch let failure as RunTokenReadError {
    parse = .failure(failure)
  } catch {
    parse = .failure(.invalidBuffer)
  }
  return processRunTokenObservation(
    pid: pid,
    parse: parse,
    codeSigningFlags: { codeSigningFlags(pid: pid) }
  )
}

func readRunTokens(pids: [Int32]) -> [RunTokenObservation] {
  let before = readProcessSnapshot()
  let observations = pids.map { pid -> RunTokenObservation in
    guard let metadata = before.metadata[pid] else {
      return unavailable(pid: pid, reason: before.failure ?? "process_not_in_snapshot")
    }
    return readRunToken(pid: pid, pointerSize: metadata.pointerSize)
  }
  let after = readProcessSnapshot()
  return zip(pids, observations).map { pid, observation in
    guard let initial = before.metadata[pid], let current = after.metadata[pid] else {
      return unavailable(pid: pid, reason: after.failure ?? "process_not_in_snapshot")
    }
    guard initial.identity == current.identity,
          initial.pointerSize == current.pointerSize else {
      return unavailable(pid: pid, reason: "process_identity_changed_during_token_read")
    }
    return observation
  }
}

func parseProcessEnvironment(
  in bytes: [UInt8],
  pointerSize: Int = MemoryLayout<UnsafeRawPointer>.size
) throws -> ParsedRunToken {
  guard bytes.count >= MemoryLayout<Int32>.size else { throw RunTokenReadError.invalidBufferAt(.header) }
  let argc = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self).littleEndian }
  guard argc >= 0, Int(argc) <= bytes.count else { throw RunTokenReadError.invalidBufferAt(.argumentCount) }
  var offset = MemoryLayout<Int32>.size
  guard let executablePath = readString(in: bytes, offset: &offset) else {
    throw RunTokenReadError.invalidBufferAt(.executablePath)
  }
  guard pointerSize == 4 || pointerSize == 8 else { throw RunTokenReadError.invalidBufferAt(.pointerSize) }
  let pathRecordSize = Array("executable_path=".utf8).count + executablePath.count + 1
  let padding = (pointerSize - pathRecordSize % pointerSize) % pointerSize
  guard offset + padding <= bytes.count,
        bytes[offset..<(offset + padding)].allSatisfy({ $0 == 0 }) else {
    throw RunTokenReadError.invalidBufferAt(.pathPadding)
  }
  offset += padding
  let tokenPrefix = Array("REA_PROCESS_RUN_ID=".utf8)
  var tokenInArgument = false
  for _ in 0..<argc {
    guard let argument = readString(in: bytes, offset: &offset, allowEmpty: true) else {
      throw RunTokenReadError.invalidBufferAt(.arguments)
    }
    tokenInArgument = tokenInArgument || argument.starts(with: tokenPrefix)
  }
  guard bytes.last == 0 else { throw RunTokenReadError.invalidBufferAt(.terminator) }
  if offset == bytes.count {
    throw RunTokenReadError.environmentUnavailable
  }
  var trailingEntries: [ArraySlice<UInt8>] = []
  var zeroedAppleVectorStart: Int?
  while offset < bytes.count {
    if bytes[offset] == 0 {
      let start = offset
      while offset < bytes.count, bytes[offset] == 0 {
        offset += 1
      }
      if offset - start > 1 {
        zeroedAppleVectorStart = zeroedAppleVectorStart ?? trailingEntries.count
      }
      continue
    }
    guard let entry = readString(in: bytes, offset: &offset) else {
      throw RunTokenReadError.invalidBufferAt(.trailingEntries)
    }
    trailingEntries.append(entry)
  }
  // XNU appends its Apple vector after the environment. libc clears the
  // initial `pfz=` record after startup, leaving a multi-NUL run in its place.
  // A caller can also set `pfz`, so prefer the final intact sentinel when it
  // remains available and otherwise stop at the cleared record.
  let intactAppleVectorStart = trailingEntries.lastIndex(where: {
    $0.starts(with: Array("pfz=".utf8))
  })
  let preferZeroedBoundary = zeroedAppleVectorStart.flatMap { zeroedStart in
    intactAppleVectorStart.map { intactStart in intactStart < zeroedStart } ?? true
  } ?? false
  let appleVectorStart = preferZeroedBoundary
    ? zeroedAppleVectorStart
    : intactAppleVectorStart
  guard let appleVectorStart else {
    throw RunTokenReadError.appleVectorUnavailable
  }
  if trailingEntries[appleVectorStart...].contains(where: {
    $0.starts(with: tokenPrefix)
  }) {
    throw RunTokenReadError.ambiguousEnvironmentBoundary
  }
  let environmentEntries = trailingEntries[..<appleVectorStart]
  var found: String?
  for entry in environmentEntries {
    if entry.starts(with: tokenPrefix) {
      guard found == nil else { throw RunTokenReadError.duplicateToken }
      let value = entry.dropFirst(tokenPrefix.count)
      guard let decoded = String(bytes: value, encoding: .utf8) else {
        throw RunTokenReadError.invalidTokenEncoding
      }
      found = decoded
    }
  }
  // A changed process title can overwrite the original argument boundaries,
  // causing a real environment entry to be consumed as an argument. A real
  // argument can have this form too, so it proves neither ownership nor absence.
  if tokenInArgument {
    throw RunTokenReadError.ambiguousEnvironmentBoundary
  }
  return ParsedRunToken(runId: found, environmentEntryCount: environmentEntries.count)
}

private func readString(
  in bytes: [UInt8],
  offset: inout Int,
  allowEmpty: Bool = false
) -> ArraySlice<UInt8>? {
  guard offset < bytes.count, let end = bytes[offset...].firstIndex(of: 0),
        allowEmpty || end > offset else { return nil }
  let string = bytes[offset..<end]
  offset = end + 1
  return string
}

private func unavailable(pid: Int32, reason: String) -> RunTokenObservation {
  RunTokenObservation(pid: pid, state: "unavailable", run_id: nil, reason: reason)
}
