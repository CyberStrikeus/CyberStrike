// Independent Windows observations for the real native conformance lane.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winioctl.h>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <string>
#include <vector>

int wmain(int count, wchar_t** args) {
  if (count == 2 && std::wstring(args[1]) == L"environment") {
    wchar_t* block = GetEnvironmentStringsW();
    if (!block) return 7;
    std::wstring previous;
    bool sorted = true;
    for (const wchar_t* entry = block; *entry; entry += std::wcslen(entry) + 1) {
      const auto value = std::wstring(entry);
      const auto end = value.find(L'=', value.front() == L'=' ? 1 : 0);
      const auto name = value.substr(0, end);
      if (!previous.empty() && CompareStringOrdinal(previous.data(), previous.size(),
                                                    name.data(), name.size(), TRUE) != CSTR_LESS_THAN)
        sorted = false;
      previous = name;
    }
    FreeEnvironmentStringsW(block);
    auto value = [](const wchar_t* name) {
      wchar_t text[128]{}; GetEnvironmentVariableW(name, text, 128); return std::wstring(text);
    };
    const auto sameUnicodeName = CompareStringOrdinal(L"REA_\u00df", -1, L"REA_SS", -1, TRUE) == CSTR_EQUAL;
    const auto expectedSharp = sameUnicodeName ? L"double" : L"sharp";
    std::printf("{\"ordinallySorted\":%s,\"lastDuplicateSelected\":%s,\"unicodeNamesPreserved\":%s}\n",
      sorted ? "true" : "false", value(L"REA_CASE") == L"last" ? "true" : "false",
      value(L"REA_\u00df") == expectedSharp && value(L"REA_SS") == L"double" ? "true" : "false");
    return 0;
  }
  if ((count == 2 || count == 3) && std::wstring(args[1]) == L"affinity") {
    // Without a process id this observes itself, which is what an owned child
    // reports. With one it observes that process, so a caller's own affinity is
    // read from the process that spawns the child rather than from a separate
    // probe Windows may place in another processor group.
    HANDLE opened = nullptr;
    if (count == 3) {
      opened = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                           static_cast<DWORD>(std::wcstoul(args[2], nullptr, 10)));
      if (!opened) return 9;
    }
    const HANDLE target = opened ? opened : GetCurrentProcess();
    DWORD_PTR affinity = 0, systemAffinity = 0;
    USHORT groupCount = 1;
    USHORT groups[1]{};
    const bool read = GetProcessAffinityMask(target, &affinity, &systemAffinity) != 0;
    const bool single = read && GetProcessGroupAffinity(target, &groupCount, groups) && groupCount == 1;
    if (opened) CloseHandle(opened);
    if (!read) return 8;
    // A mask can set bits above JavaScript's safe-integer range, so masks cross
    // as fixed-width hexadecimal strings and are compared without rounding. The
    // group's own active set distinguishes an unconstrained process from one
    // deliberately pinned to fewer processors.
    auto mask = [](DWORD_PTR value, char* text) {
      std::snprintf(text, 19, "0x%08lX%08lX", static_cast<unsigned long>(value >> 32),
                    static_cast<unsigned long>(value & 0xFFFFFFFFu));
      return text;
    };
    char affinityText[19]{}, systemText[19]{};
    std::printf("{\"affinityMask\":\"%s\",\"systemMask\":\"%s\","
                "\"singleProcessorGroup\":%s,\"processorGroup\":%u}\n",
                mask(affinity, affinityText), mask(systemAffinity, systemText),
                single ? "true" : "false", single ? static_cast<unsigned>(groups[0]) : 0u);
    return 0;
  }
  if (count == 4 && std::wstring(args[1]) == L"reparse-directory") {
    // Only the conformance lane's disposable, nonempty source directory is used.
    const auto substitute = L"\\??\\" + std::wstring(args[3]);
    const auto substituteBytes = static_cast<WORD>(substitute.size() * sizeof(wchar_t));
    struct MountPoint {
      DWORD tag; WORD dataLength, reserved;
      WORD substituteOffset, substituteLength, printOffset, printLength;
    } header{IO_REPARSE_TAG_MOUNT_POINT, static_cast<WORD>(8 + substituteBytes + 4), 0,
             0, substituteBytes, static_cast<WORD>(substituteBytes + 2), 0};
    std::vector<unsigned char> buffer(sizeof(header) + substituteBytes + 4, 0);
    std::memcpy(buffer.data(), &header, sizeof(header));
    std::memcpy(buffer.data() + sizeof(header), substitute.data(), substituteBytes);
    HANDLE directory = CreateFileW(args[2], GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    DWORD observed = directory == INVALID_HANDLE_VALUE ? GetLastError() : ERROR_SUCCESS;
    if (directory != INVALID_HANDLE_VALUE) {
      DWORD bytes;
      if (!DeviceIoControl(directory, FSCTL_SET_REPARSE_POINT, buffer.data(),
                           static_cast<DWORD>(buffer.size()), nullptr, 0, &bytes, nullptr))
        observed = GetLastError();
      CloseHandle(directory);
    }
    std::printf("{\"reparseConversionDenied\":%s,\"win32Code\":%lu}\n",
      observed == ERROR_DIR_NOT_EMPTY || observed == ERROR_SHARING_VIOLATION || observed == ERROR_ACCESS_DENIED
        ? "true" : "false", observed);
    return 0;
  }
  if (count == 3 && std::wstring(args[1]) == L"volume-root-append-lease") {
    // A real directory append right participates in Windows' write-share
    // check. The lease performs no mutation; it stays open while the native
    // admission probe requests the same volume root for directory listing.
    HANDLE root = CreateFileW(args[2], FILE_ADD_SUBDIRECTORY,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (root == INVALID_HANDLE_VALUE) {
      std::printf("{\"writeAccessGranted\":false,\"win32Code\":%lu}\n", GetLastError());
      return 0;
    }
    std::puts("{\"writeAccessGranted\":true}");
    std::fflush(stdout);
    const int release = std::getchar();
    CloseHandle(root);
    return release == 'x' || release == EOF ? 0 : 10;
  }
  if (count > 1 && std::wstring(args[1]) == L"breakaway") {
    wchar_t executable[32768]; GetModuleFileNameW(nullptr, executable, 32768);
    std::wstring line = L"\"" + std::wstring(executable) + L"\" exit";
    STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION child{};
    if (CreateProcessW(executable, line.data(), nullptr, nullptr, FALSE,
                       CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &child)) {
      TerminateProcess(child.hProcess, 1); CloseHandle(child.hThread); CloseHandle(child.hProcess);
      std::puts("{\"breakawayDenied\":false}"); return 1;
    }
    std::printf("{\"breakawayDenied\":%s,\"win32Code\":%lu}\n",
                GetLastError() == ERROR_ACCESS_DENIED ? "true" : "false", GetLastError()); return 0;
  }
  HANDLE token = nullptr; DWORD size;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE, &token)) return 2;
  TOKEN_ELEVATION elevation{};
  if (!GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size)) return 3;
  std::vector<unsigned char> user(4096), owner(4096), integrity(4096);
  if (!GetTokenInformation(token, TokenUser, user.data(), user.size(), &size) ||
      !GetTokenInformation(token, TokenOwner, owner.data(), owner.size(), &size) ||
      !GetTokenInformation(token, TokenIntegrityLevel, integrity.data(), integrity.size(), &size)) return 4;
  HANDLE impersonation = nullptr;
  if (!DuplicateToken(token, SecurityIdentification, &impersonation)) return 5;
  unsigned char administrator[SECURITY_MAX_SID_SIZE]; DWORD administratorSize = sizeof(administrator);
  CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, administrator, &administratorSize);
  BOOL member = TRUE;
  if (!CheckTokenMembership(impersonation, administrator, &member)) return 6;
  auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(integrity.data())->Label.Sid;
  const auto level = *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
  const bool ownerIsUser = EqualSid(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,
                                  reinterpret_cast<TOKEN_OWNER*>(owner.data())->Owner);
  std::printf("{\"elevated\":%s,\"administrator\":%s,\"integrityLevel\":%lu,\"defaultOwnerIsUser\":%s}\n",
              elevation.TokenIsElevated ? "true" : "false", member ? "true" : "false", level,
              ownerIsUser ? "true" : "false");
  CloseHandle(impersonation); CloseHandle(token); return 0;
}
