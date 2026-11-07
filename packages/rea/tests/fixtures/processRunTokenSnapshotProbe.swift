import Darwin
import Foundation

@main
struct ProcessRunTokenSnapshotProbe {
  static func main() throws {
    var sizeQueries = 0
    var readAttempts = 0
    let retried = readProcessSnapshot { _, output, size in
      guard output != nil else {
        sizeQueries += 1
        size = MemoryLayout<kinfo_proc>.stride
        return 0
      }
      readAttempts += 1
      if readAttempts == 1 {
        errno = ENOMEM
        return -1
      }
      size = 0
      return 0
    }

    let otherError = readProcessSnapshot { _, output, size in
      if output == nil {
        size = MemoryLayout<kinfo_proc>.stride
        return 0
      }
      errno = EACCES
      return -1
    }

    let absentIdentities = readProcessIdentities(
      pids: [42],
      snapshot: ProcessSnapshot(metadata: [:], failure: nil)
    )
    let failedIdentities = readProcessIdentities(
      pids: [42],
      snapshot: ProcessSnapshot(metadata: [:], failure: "process_table_failed_13")
    )
    let invalidIdentity = readProcessIdentities(
      pids: [0],
      snapshot: ProcessSnapshot(metadata: [:], failure: nil)
    )
    let zombieIdentity = readProcessIdentities(
      pids: [42],
      snapshot: ProcessSnapshot(
        metadata: [42: ProcessMetadata(identity: "start:42", effectiveUid: 501, lifecycle: "zombie", parentPid: 7, processGroupId: 9, pointerSize: 8)],
        failure: nil
      )
    )

    let output: [String: Any] = [
      "retriedAfterFreshSize": retried.failure == nil && sizeQueries == 2 && readAttempts == 2,
      "preservedOtherErrno": otherError.failure == "process_table_failed_\(EACCES)",
      "successfulSnapshotMissingPidIsAbsent": absentIdentities.first?.state == "absent" && absentIdentities.first?.reason == "not-in-snapshot",
      "failedSnapshotMissingPidIsUnavailable": failedIdentities.first?.state == "unavailable" && failedIdentities.first?.reason == "process_table_failed_13",
      "invalidPidIsUnavailable": invalidIdentity.first?.state == "unavailable" && invalidIdentity.first?.reason == "invalid_process_id",
      "zombieLifecycleIsSeparateFromIdentity": zombieIdentity.first?.state == "readable" && zombieIdentity.first?.identity == "start:42" && zombieIdentity.first?.lifecycle == "zombie",
      "effectiveUidComesFromNativeIdentity": zombieIdentity.first?.effective_uid == 501,
      "nativeRelationIsSeparateFromIdentity": zombieIdentity.first?.relation?.parent_pid == 7 && zombieIdentity.first?.relation?.process_group_id == 9
    ]
    let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
  }
}
