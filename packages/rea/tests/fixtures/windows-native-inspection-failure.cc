// Only the separate conformance artifact uses this translation unit. The
// shipped addon always compiles filesystem.cc directly, without interposition.
#include "../../native/windows/src/authority.hpp"
#include <atomic>

static BOOL fixtureDisposition(HANDLE handle, FILE_INFO_BY_HANDLE_CLASS kind,
                               LPVOID value, DWORD size) {
  // A real NTFS runtime is created normally. Fail its first rollback
  // disposition so the verifier can observe the owner after post-create
  // validation fails, independent of host filesystem behavior.
  static std::atomic_flag failed = ATOMIC_FLAG_INIT;
  if (kind == FileDispositionInfo && !failed.test_and_set()) {
    SetLastError(ERROR_ACCESS_DENIED);
    return FALSE;
  }
  return SetFileInformationByHandle(handle, kind, value, size);
}

static DWORD inspectionSecurityInfo(HANDLE handle, SE_OBJECT_TYPE kind,
                                    SECURITY_INFORMATION information,
                                    PSID* owner, PSID* group, PACL* dacl, PACL* sacl,
                                    PSECURITY_DESCRIPTOR* descriptor) {
  // Force validation to fail only after FILE_CREATE has allocated the root.
  static std::atomic_flag failed = ATOMIC_FLAG_INIT;
  wchar_t enabled[2];
  if (GetEnvironmentVariableW(L"REA_NATIVE_CREATION_FAILURE", enabled, 2) > 0 &&
      !failed.test_and_set()) return ERROR_ACCESS_DENIED;
  return GetSecurityInfo(handle, kind, information, owner, group, dacl, sacl, descriptor);
}

#define SetFileInformationByHandle fixtureDisposition
#define GetSecurityInfo inspectionSecurityInfo
#include "../../native/windows/src/filesystem.cc"
