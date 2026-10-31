// Test-only launcher: reuse a non-elevated shell token belonging to the current user.
// No accounts, host policies, profiles, or caller privileges are changed.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <tlhelp32.h>
#include <cstdio>
#include <string>
#include <vector>

static std::wstring quote(const std::wstring& value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (const auto character : value) {
    if (character == L'\\') { ++slashes; continue; }
    result.append(slashes * (character == L'\"' ? 2 : 1), L'\\');
    slashes = 0;
    if (character == L'\"') result += L'\\';
    result += character;
  }
  result.append(slashes * 2, L'\\');
  return result + L"\"";
}

int wmain(int count, wchar_t** args) {
  if (count < 3) return 64;
  HANDLE current = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY, &current)) return 65;
  std::vector<unsigned char> callerUser(4096); DWORD callerUserSize;
  if (!GetTokenInformation(current, TokenUser, callerUser.data(), callerUser.size(), &callerUserSize)) return 66;
  HANDLE primary = nullptr;
  const auto snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  PROCESSENTRY32W entry{}; entry.dwSize = sizeof(entry);
  if (snapshot != INVALID_HANDLE_VALUE && Process32FirstW(snapshot, &entry)) do {
    if (_wcsicmp(entry.szExeFile, L"explorer.exe") != 0) continue;
    HANDLE candidate = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
    HANDLE token = nullptr;
    if (candidate && OpenProcessToken(candidate, TOKEN_QUERY | TOKEN_DUPLICATE, &token)) {
      TOKEN_ELEVATION elevation{}; DWORD size;
      std::vector<unsigned char> user(4096);
      if (GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size) && !elevation.TokenIsElevated &&
          GetTokenInformation(token, TokenUser, user.data(), user.size(), &size) &&
          EqualSid(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,
                   reinterpret_cast<TOKEN_USER*>(callerUser.data())->User.Sid))
        DuplicateTokenEx(token, MAXIMUM_ALLOWED, nullptr, SecurityImpersonation, TokenPrimary, &primary);
      CloseHandle(token);
    }
    if (candidate) CloseHandle(candidate);
    if (primary) break;
  } while (Process32NextW(snapshot, &entry));
  if (snapshot != INVALID_HANDLE_VALUE) CloseHandle(snapshot);
  CloseHandle(current);
  if (!primary) { std::fprintf(stderr, "No non-elevated shell token belonging to the current user.\n"); return 67; }
  unsigned char medium[SECURITY_MAX_SID_SIZE]; DWORD mediumSize = sizeof(medium);
  if (!CreateWellKnownSid(WinMediumLabelSid, nullptr, medium, &mediumSize)) return 71;
  TOKEN_MANDATORY_LABEL label{{medium, SE_GROUP_INTEGRITY}};
  if (!SetTokenInformation(primary, TokenIntegrityLevel, &label, sizeof(label) + GetLengthSid(medium))) {
    std::fprintf(stderr, "Medium-integrity fixture token failed: %lu\n", GetLastError()); CloseHandle(primary); return 72;
  }
  std::wstring line;
  for (int index = 1; index < count; ++index) { if (index > 1) line += L' '; line += quote(args[index]); }
  std::vector<wchar_t> buffer(line.begin(), line.end()); buffer.push_back(0);
  std::vector<unsigned char> user(4096); DWORD userSize;
  if (!GetTokenInformation(primary, TokenUser, user.data(), user.size(), &userSize)) return 73;
  wchar_t* userSid = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid, &userSid)) return 74;
  const std::wstring sddl = L"O:" + std::wstring(userSid) + L"D:P(A;;GA;;;" + userSid + L")(A;;GA;;;SY)S:(ML;;NW;;;ME)";
  LocalFree(userSid);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) return 75;
  PACL acl = nullptr; BOOL present, defaulted;
  if (!GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted) || !present) return 78;
  TOKEN_DEFAULT_DACL defaultDacl{acl};
  TOKEN_OWNER owner{reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid};
  if (!SetTokenInformation(primary, TokenDefaultDacl, &defaultDacl, sizeof(defaultDacl)) ||
      !SetTokenInformation(primary, TokenOwner, &owner, sizeof(owner))) return 79;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
  const auto stationName = L"rea-fixture-" + std::to_wstring(GetCurrentProcessId());
  const auto originalStation = GetProcessWindowStation();
  const auto station = CreateWindowStationW(stationName.c_str(), 0, WINSTA_ALL_ACCESS, &security);
  if (!station || !SetProcessWindowStation(station)) return 76;
  const auto desktop = CreateDesktopW(L"fixture", nullptr, nullptr, 0, GENERIC_ALL, &security);
  SetProcessWindowStation(originalStation); LocalFree(descriptor);
  if (!desktop) return 77;
  auto desktopName = stationName + L"\\fixture";
  STARTUPINFOW startup{}; startup.cb = sizeof(startup);
  startup.lpDesktop = desktopName.data();
  PROCESS_INFORMATION process{};
  auto environment = GetEnvironmentStringsW();
  wchar_t workingDirectory[32768]; GetCurrentDirectoryW(32768, workingDirectory);
  const BOOL started = CreateProcessWithTokenW(primary, 0, args[1], buffer.data(),
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS,
      environment, workingDirectory, &startup, &process);
  const DWORD failure = GetLastError();
  FreeEnvironmentStringsW(environment); CloseHandle(primary);
  if (!started) { std::fprintf(stderr, "Non-admin fixture launch failed: %lu\n", failure); return 68; }
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION policy{};
  policy.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &policy, sizeof(policy)) ||
      !AssignProcessToJobObject(job, process.hProcess) || !SetProcessAffinityMask(process.hProcess, 3)) {
    TerminateProcess(process.hProcess, 69); CloseHandle(process.hThread); CloseHandle(process.hProcess);
    if (job) CloseHandle(job); return 69;
  }
  ResumeThread(process.hThread); CloseHandle(process.hThread);
  const DWORD waited = WaitForSingleObject(process.hProcess, 900000);
  DWORD code = 70;
  if (waited == WAIT_OBJECT_0) GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(job); CloseHandle(process.hProcess);
  CloseDesktop(desktop); CloseWindowStation(station);
  return static_cast<int>(code);
}
