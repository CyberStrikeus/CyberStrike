#include "authority.hpp"
#include <sddl.h>
#include <winternl.h>
#include <cstddef>

namespace rea {

static std::wstring hex(const unsigned char* bytes, size_t count) {
  constexpr wchar_t digits[] = L"0123456789abcdef";
  std::wstring result;
  for (size_t index = 0; index < count; ++index) {
    result += digits[bytes[index] >> 4]; result += digits[bytes[index] & 15];
  }
  return result;
}

static std::wstring localPath(std::wstring path) {
  path = ordinaryDriveSeparators(std::move(path));
  if (path.rfind(L"\\\\?\\", 0) == 0) path.erase(0, 4);
  require(path.size() >= 3 && path[1] == L':' && path[2] == L'\\' &&
          ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')),
          "Only absolute local NTFS drive paths are supported", path, ERROR_NOT_SUPPORTED);
  require(path.find(L'/', 0) == std::wstring::npos && path.find(L':', 2) == std::wstring::npos,
          "Alternate streams and non-local path syntax are unsupported", path, ERROR_NOT_SUPPORTED);
  require(GetDriveTypeW(path.substr(0, 3).c_str()) == DRIVE_FIXED,
          "Only fixed local NTFS volumes are supported", path, ERROR_NOT_SUPPORTED);
  if (path.size() > 3 && path.back() == L'\\') path.pop_back();
  require(path.size() == 3 || path.back() != L'\\', "Repeated path separators are unsupported", path, ERROR_NOT_SUPPORTED);
  size_t begin = 3;
  while (begin < path.size()) {
    const auto end = path.find(L'\\', begin);
    const auto component = path.substr(begin, end == std::wstring::npos ? end : end - begin);
    require(!component.empty() && component != L"." && component != L".." &&
            component.back() != L'.' && component.back() != L' ',
            "Ambiguous Windows path component is unsupported", path, ERROR_NOT_SUPPORTED);
    if (end == std::wstring::npos) break;
    begin = end + 1;
  }
  return path;
}

static Handle openComponent(const std::wstring& path, DWORD access, bool directory, DWORD sharing = FILE_SHARE_READ) {
  // Attribute-only opens do not participate in Windows share-access checks.
  // Directory guards need FILE_LIST_DIRECTORY to prevent replacement and
  // in-place reparse conversion while descendant paths are being consumed.
  Handle handle(CreateFileW((L"\\\\?\\" + path).c_str(), access | FILE_READ_ATTRIBUTES | READ_CONTROL |
                           (directory ? FILE_LIST_DIRECTORY : 0),
                           sharing, nullptr, OPEN_EXISTING,
                           FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
  require(handle.valid(), "Open Windows path component failed", path);
  FILE_ATTRIBUTE_TAG_INFO info{};
  require(GetFileInformationByHandleEx(handle.get(), FileAttributeTagInfo, &info, sizeof(info)),
          "Read Windows path attributes failed", path);
  if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
    throw Failure("Reparse path component is unsupported (tag " + std::to_string(info.ReparseTag) + ")",
                  path, ERROR_NOT_SUPPORTED);
  require(((info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) == directory,
          directory ? "Expected a directory path component" : "Target is not a regular file", path,
          directory ? ERROR_PATH_NOT_FOUND : ERROR_DIRECTORY);
  require(GetFileType(handle.get()) == FILE_TYPE_DISK, "Windows object is not a disk file", path, ERROR_NOT_SUPPORTED);
  return handle;
}

std::unique_ptr<File> openFile(const std::wstring& requested, DWORD access, bool directory,
                               DWORD finalSharing) {
  auto result = std::make_unique<File>(localPath(requested));
  result->requestedPath = requested;
  const auto& path = result->path;
  require(directory || path.size() > 3, "Target is not a regular file", requested, ERROR_DIRECTORY);
  // The volume root cannot be replaced or deleted. Match the later root
  // reopen's write sharing here so a root writer cannot block admission.
  result->handles.push_back(openComponent(path.substr(0, 3), 0, true,
                                          FILE_SHARE_READ | FILE_SHARE_WRITE));
  wchar_t filesystem[64]{};
  DWORD flags = 0;
  require(GetVolumeInformationByHandleW(result->handles.front().get(), nullptr, 0, nullptr, nullptr,
                                       &flags, filesystem, 64), "Read volume semantics failed", path);
  require(std::wstring(filesystem) == L"NTFS" && (flags & FILE_PERSISTENT_ACLS) != 0,
          "Backing volume must be NTFS with persistent ACLs", path, ERROR_NOT_SUPPORTED);
  size_t offset = 3;
  while (offset < path.size()) {
    auto end = path.find(L'\\', offset);
    const bool final = end == std::wstring::npos;
    auto child = openComponent(path.substr(0, end), final ? access : 0, !final || directory,
                               final ? finalSharing : FILE_SHARE_READ);
    // Once the next component is pinned against deletion, its parent cannot
    // become empty and NTFS cannot convert that parent into a reparse point.
    // Relax only ancestor write sharing so unrelated child renames can proceed.
    // Independent evidence: tests/fixtures/windows/processBoundary.cc attempts
    // FSCTL_SET_REPARSE_POINT on the nonempty pinned ancestor and observes denial.
    // SUBST aliases and mounted-folder/reparse namespace variants are outside
    // the admitted P0 evidence; requested and final handle paths remain distinct.
    const auto parentPath = offset == 3 ? path.substr(0, 3) : path.substr(0, offset - 1);
    result->handles.back() = openComponent(parentPath, 0, true, FILE_SHARE_READ | FILE_SHARE_WRITE);
    result->handles.push_back(std::move(child));
    if (final) break;
    offset = end + 1;
  }
  return result;
}

napi_value identity(napi_env env, HANDLE handle, const std::wstring& path) {
  FILE_ID_INFO info{};
  require(GetFileInformationByHandleEx(handle, FileIdInfo, &info, sizeof(info)),
          "Stable 128-bit Windows file identity is unavailable", path);
  std::array<wchar_t, 32768> finalPath;
  const auto length = GetFinalPathNameByHandleW(handle, finalPath.data(), finalPath.size(), FILE_NAME_NORMALIZED);
  require(length > 0 && length < finalPath.size(), "Read final handle path failed", path);
  LARGE_INTEGER size{};
  FILE_STANDARD_INFO standard{};
  require(GetFileInformationByHandleEx(handle, FileStandardInfo, &standard, sizeof(standard)),
          "Read handle metadata failed", path);
  size = standard.EndOfFile;
  require(size.QuadPart >= 0 && size.QuadPart <= 9007199254740991LL, "File size exceeds exact numeric representation", path,
          ERROR_NOT_SUPPORTED);
  auto result = object(env);
  set(env, result, "requestedPath", string(env, path));
  set(env, result, "finalPath", string(env, std::wstring(finalPath.data(), length)));
  set(env, result, "filesystem", string(env, std::string("NTFS")));
  std::array<unsigned char, 8> serial;
  for (size_t index = 0; index < serial.size(); ++index)
    serial[index] = static_cast<unsigned char>(info.VolumeSerialNumber >> ((7 - index) * 8));
  set(env, result, "volumeSerial", string(env, hex(serial.data(), serial.size())));
  set(env, result, "fileId", string(env, hex(info.FileId.Identifier, 16)));
  set(env, result, "size", number(env, static_cast<double>(size.QuadPart)));
  set(env, result, "directory", boolean(env, standard.Directory != FALSE));
  return result;
}

struct Security {
  std::vector<unsigned char> user;
  std::array<unsigned char, SECURITY_MAX_SID_SIZE> system{};
  std::vector<unsigned char> acl;
  SECURITY_DESCRIPTOR descriptor{};
  PSID userSid() const { return reinterpret_cast<const TOKEN_USER*>(user.data())->User.Sid; }
  Security() {
    Handle token;
    HANDLE raw;
    require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw), "Read current user token failed");
    token.reset(raw);
    DWORD size = 0;
    GetTokenInformation(token.get(), TokenUser, nullptr, 0, &size);
    user.resize(size);
    require(GetTokenInformation(token.get(), TokenUser, user.data(), size, &size), "Read current user SID failed");
    DWORD systemSize = system.size();
    require(CreateWellKnownSid(WinLocalSystemSid, nullptr, system.data(), &systemSize), "Create SYSTEM SID failed");
    acl.resize(sizeof(ACL) + 2 * (sizeof(ACCESS_ALLOWED_ACE) - sizeof(DWORD)) + GetLengthSid(userSid()) + systemSize);
    auto access = reinterpret_cast<PACL>(acl.data());
    require(InitializeAcl(access, acl.size(), ACL_REVISION), "Initialize private DACL failed");
    for (PSID sid : {userSid(), static_cast<PSID>(system.data())})
      require(AddAccessAllowedAceEx(access, ACL_REVISION, OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
                                   FILE_ALL_ACCESS, sid), "Populate private DACL failed");
    require(InitializeSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION) &&
            SetSecurityDescriptorOwner(&descriptor, userSid(), FALSE) &&
            SetSecurityDescriptorDacl(&descriptor, TRUE, access, FALSE) &&
            SetSecurityDescriptorControl(&descriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED),
            "Create protected security descriptor failed");
  }
};

static Handle createRelative(HANDLE parent, const std::wstring& name, DWORD access, bool directory,
                             Security& security, const std::wstring& path) {
  require(!name.empty() && name.find_first_of(L"\\/:\"<>|?*") == std::wstring::npos && name.size() < 32768,
          "Private object requires one filename component", path, ERROR_INVALID_PARAMETER);
  UNICODE_STRING coordinate{};
  coordinate.Buffer = const_cast<wchar_t*>(name.data());
  coordinate.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t));
  coordinate.MaximumLength = coordinate.Length;
  OBJECT_ATTRIBUTES attributes;
  InitializeObjectAttributes(&attributes, &coordinate, OBJ_CASE_INSENSITIVE, parent, &security.descriptor);
  IO_STATUS_BLOCK observation{};
  HANDLE raw = INVALID_HANDLE_VALUE;
  const auto status = NtCreateFile(&raw, access | SYNCHRONIZE, &attributes, &observation, nullptr,
                                   FILE_ATTRIBUTE_NORMAL,
                                   directory ? FILE_SHARE_READ | FILE_SHARE_DELETE : FILE_SHARE_READ,
                                   FILE_CREATE,
                                   FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT |
                                   (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE), nullptr, 0);
  if (status < 0) throw Failure("Create private object relative to its admitted parent failed", path,
                                RtlNtStatusToDosError(status));
  Handle result(raw);
  require(result.valid() && observation.Information == FILE_CREATED,
          "Private creation did not return a new object handle", path, ERROR_ACCESS_DENIED);
  return result;
}

void cleanupFailedRuntime(std::unique_ptr<Runtime>& owner, Failure& primary) {
  if (!owner || !owner->directory.valid()) {
    owner.reset();
    return;
  }
  try {
    closeRuntime(*owner);
    owner.reset();
  } catch (const Failure& cleanup) {
    primary.cleanupConstraint = cleanup.constraint;
    primary.cleanupWin32 = cleanup.win32;
    primary.cleanupPath = cleanup.path;
  } catch (const std::exception& cleanup) {
    primary.cleanupConstraint = cleanup.what();
    primary.cleanupWin32 = ERROR_GEN_FAILURE;
    primary.cleanupPath = owner->path;
  } catch (...) {
    primary.cleanupConstraint = "Unknown runtime cleanup failure";
    primary.cleanupWin32 = ERROR_GEN_FAILURE;
    primary.cleanupPath = owner->path;
  }
}

// Lookup relative to an already-owned directory; path is diagnostic only.
static Handle openRelative(HANDLE parent, const std::wstring& name, DWORD access,
                           DWORD sharing, ULONG kind, const std::wstring& path) {
  require(!name.empty() && name.find_first_of(L"\\/:\"<>|?*") == std::wstring::npos && name.size() < 32768,
          "Private lookup requires one filename component", path, ERROR_INVALID_PARAMETER);
  UNICODE_STRING coordinate{};
  coordinate.Buffer = const_cast<wchar_t*>(name.data());
  coordinate.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t));
  coordinate.MaximumLength = coordinate.Length;
  OBJECT_ATTRIBUTES attributes;
  InitializeObjectAttributes(&attributes, &coordinate, OBJ_CASE_INSENSITIVE, parent, nullptr);
  IO_STATUS_BLOCK observation{};
  HANDLE raw = INVALID_HANDLE_VALUE;
  const auto status = NtCreateFile(&raw, access | SYNCHRONIZE, &attributes, &observation,
                                   nullptr, FILE_ATTRIBUTE_NORMAL, sharing, FILE_OPEN,
                                   FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT | kind, nullptr, 0);
  if (status < 0)
    throw Failure("Open private object relative to its directory handle failed", path,
                  RtlNtStatusToDosError(status));
  Handle result(raw);
  require(result.valid(), "Private lookup returned an invalid handle", path);
  return result;
}

static void verifyPrivate(HANDLE handle, const std::wstring& path, bool root) {
  Security expected;
  PSID owner = nullptr;
  PACL acl = nullptr;
  PSECURITY_DESCRIPTOR raw = nullptr;
  const DWORD code = GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                                     &owner, nullptr, &acl, nullptr, &raw);
  if (code != ERROR_SUCCESS) throw Failure("Read private DACL by handle failed", path, code);
  const auto descriptor = std::unique_ptr<void, decltype(&LocalFree)>(raw, LocalFree);
  require(owner != nullptr && EqualSid(owner, expected.userSid()), "Private object owner is not the current user", path,
          ERROR_ACCESS_DENIED);
  SECURITY_DESCRIPTOR_CONTROL control;
  DWORD revision;
  require(GetSecurityDescriptorControl(raw, &control, &revision), "Read DACL control flags failed", path);
  require(acl != nullptr && (control & SE_DACL_PRESENT) != 0 && (!root || (control & SE_DACL_PROTECTED) != 0),
          "Private object requires a present protected DACL", path, ERROR_ACCESS_DENIED);
  require(acl->AceCount == 2, "Private DACL contains unexpected trustees", path, ERROR_ACCESS_DENIED);
  bool user = false, system = false;
  for (DWORD index = 0; index < acl->AceCount; ++index) {
    void* rawAce;
    require(GetAce(acl, index, &rawAce), "Read private DACL entry failed", path);
    const auto ace = static_cast<ACCESS_ALLOWED_ACE*>(rawAce);
    require(ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE && ace->Mask == FILE_ALL_ACCESS &&
            (ace->Header.AceFlags & INHERIT_ONLY_ACE) == 0 &&
            (!root || (ace->Header.AceFlags & (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)) ==
                      (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)),
            "Private DACL contains unsupported rights or ACE type", path, ERROR_ACCESS_DENIED);
    PSID sid = const_cast<DWORD*>(&ace->SidStart);
    if (EqualSid(sid, expected.userSid())) user = true;
    else if (EqualSid(sid, expected.system.data())) system = true;
    else throw Failure("Private DACL permits an unrelated principal", path, ERROR_ACCESS_DENIED);
  }
  require(user && system, "Private DACL must allow only current user and SYSTEM", path, ERROR_ACCESS_DENIED);
}

static std::unique_ptr<File> openPrivateBridgeDirectory(const std::wstring& path) {
  // The retained runtime root handle carries DELETE authority for owned
  // cleanup. Windows checks sharing in both directions, so this read-only
  // inspection handle must share DELETE even though it requests no such right.
  auto directory = openFile(path, FILE_LIST_DIRECTORY, true,
                            FILE_SHARE_READ | FILE_SHARE_DELETE);
  verifyPrivate(directory->get(), path, true);
  return directory;
}

static Handle openPrivateBridgeDescriptor(HANDLE parent, const std::wstring& name,
                                          const std::wstring& path) {
  require(!name.empty() && name.find_first_of(L"\\/:\"<>|?*") == std::wstring::npos &&
          name != L"." && name != L".." && name.size() <= 255,
          "Private descriptor requires one filename component", path, ERROR_INVALID_PARAMETER);
  UNICODE_STRING coordinate{};
  coordinate.Buffer = const_cast<wchar_t*>(name.data());
  coordinate.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t));
  coordinate.MaximumLength = coordinate.Length;
  OBJECT_ATTRIBUTES attributes;
  InitializeObjectAttributes(&attributes, &coordinate, OBJ_CASE_INSENSITIVE, parent, nullptr);
  IO_STATUS_BLOCK observation{};
  HANDLE raw = INVALID_HANDLE_VALUE;
  // Immutable runtime files retain their original writer handle so later
  // opens cannot acquire write or delete access. This read-only handle must
  // share those granted rights for Windows' symmetric share check to pass.
  const auto status = NtCreateFile(&raw, GENERIC_READ | READ_CONTROL | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                   &attributes, &observation, nullptr, FILE_ATTRIBUTE_NORMAL,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN,
                                   FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT |
                                       FILE_NON_DIRECTORY_FILE,
                                   nullptr, 0);
  if (status < 0)
    throw Failure("Open Cutter bridge descriptor relative to its verified directory failed", path,
                  RtlNtStatusToDosError(status));
  Handle descriptor(raw);
  require(descriptor.valid() && observation.Information == FILE_OPENED,
          "Cutter bridge descriptor was not opened as an existing file", path, ERROR_ACCESS_DENIED);
  FILE_STANDARD_INFO standard{};
  require(GetFileInformationByHandleEx(descriptor.get(), FileStandardInfo, &standard, sizeof(standard)),
          "Read Cutter bridge descriptor metadata failed", path);
  require(!standard.Directory && standard.EndOfFile.QuadPart >= 0 &&
              standard.EndOfFile.QuadPart <= 64 * 1024,
          "Cutter bridge descriptor exceeds its byte limit or is not a file", path, ERROR_FILE_TOO_LARGE);
  FILE_ATTRIBUTE_TAG_INFO fileAttributes{};
  require(GetFileInformationByHandleEx(descriptor.get(), FileAttributeTagInfo, &fileAttributes, sizeof(fileAttributes)),
          "Read Cutter bridge descriptor attributes failed", path);
  require((fileAttributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0,
          "Cutter bridge descriptor cannot be a reparse point", path, ERROR_REPARSE_TAG_INVALID);
  verifyPrivate(descriptor.get(), path, false);
  return descriptor;
}

static napi_value verifyCutterBridgeDirectory(napi_env env, const std::vector<napi_value>& args) {
  require(args.size() == 1, "Cutter bridge directory verification requires one path", L"",
          ERROR_INVALID_PARAMETER);
  const auto path = wide(env, args[0]);
  const auto directory = openPrivateBridgeDirectory(path);
  auto result = object(env);
  set(env, result, "privateDacl", boolean(env, true));
  set(env, result, "identity", identity(env, directory->get(), path));
  return result;
}

static napi_value readCutterBridgeDescriptor(napi_env env, const std::vector<napi_value>& args) {
  require(args.size() == 3, "Cutter bridge descriptor read requires directory, name, and byte limit", L"",
          ERROR_INVALID_PARAMETER);
  const auto path = wide(env, args[0]);
  const auto name = wide(env, args[1]);
  const double maximum = numeric(env, args[2]);
  require(maximum >= 1 && maximum <= 64 * 1024 && maximum == static_cast<size_t>(maximum),
          "Cutter bridge descriptor limit is outside the supported range", path, ERROR_INVALID_PARAMETER);
  auto directory = openPrivateBridgeDirectory(path);
  auto descriptor = openPrivateBridgeDescriptor(directory->get(), name, path + L"\\" + name);
  FILE_STANDARD_INFO standard{};
  require(GetFileInformationByHandleEx(descriptor.get(), FileStandardInfo, &standard, sizeof(standard)),
          "Read Cutter bridge descriptor size failed", path);
  require(standard.EndOfFile.QuadPart <= maximum,
          "Cutter bridge descriptor exceeds the requested byte limit", path, ERROR_FILE_TOO_LARGE);
  std::vector<unsigned char> bytes(static_cast<size_t>(standard.EndOfFile.QuadPart));
  size_t offset = 0;
  while (offset < bytes.size()) {
    DWORD count = 0;
    const DWORD requested = static_cast<DWORD>(std::min<size_t>(bytes.size() - offset, MAXDWORD));
    require(ReadFile(descriptor.get(), bytes.data() + offset, requested, &count, nullptr) && count > 0,
            "Read Cutter bridge descriptor through its verified handle failed", path);
    offset += count;
  }
  napi_value result;
  const void* source = bytes.empty() ? static_cast<const void*>("") : bytes.data();
  check(napi_create_buffer_copy(env, bytes.size(), source, nullptr, &result));
  return result;
}

void createRuntime(const std::wstring& parentPath, const std::wstring& prefix,
                   std::unique_ptr<Runtime>& owner) {
  // A previous failed admission retains the original root handle. Retry that
  // owner before allowing this environment to allocate another runtime.
  if (owner) { closeRuntime(*owner); owner.reset(); }
  std::unique_ptr<File> parent;
  try { parent = openFile(parentPath, 0, true); }
  catch (Failure& failure) {
    failure.runtimeDirectoryUnallocated = true;
    throw;
  }
  require(!prefix.empty() && prefix.find_first_of(L"\\/:\"<>|?*") == std::wstring::npos,
          "Runtime prefix must be one filename component", parentPath, ERROR_INVALID_PARAMETER);
  std::array<unsigned char, 16> random;
  require(BCryptGenRandom(nullptr, random.data(), random.size(), BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0,
          "Generate runtime identity failed", parentPath, ERROR_GEN_FAILURE);
  Security security;
  auto result = std::make_unique<Runtime>();
  const auto name = prefix + hex(random.data(), random.size());
  result->path = parent->path + (parent->path.back() == L'\\' ? L"" : L"\\") + name;
  result->parents = std::move(parent->handles);
  owner = std::move(result);
  try {
    owner->directory = createRelative(owner->parents.back().get(), name,
                                      DELETE | FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | READ_CONTROL,
                                      true, security, owner->path);
    // FILE_CREATE proves ownership and pins the parent nonempty independently
    // of admission validation. A failed validation must not retain a strict
    // parent lease that prevents renaming the still-owned child before retry.
    owner->parents.back() = openComponent(parent->path, 0, true, FILE_SHARE_READ | FILE_SHARE_WRITE);
    verifyPrivate(owner->directory.get(), owner->path, true);
  } catch (Failure& primary) {
    cleanupFailedRuntime(owner, primary);
    throw;
  } catch (const std::exception& error) {
    Failure primary(error.what(), owner->path, ERROR_GEN_FAILURE);
    cleanupFailedRuntime(owner, primary);
    throw primary;
  }
}

static std::wstring relativePath(Runtime& root, const std::wstring& relative) {
  require(!relative.empty() && relative[0] != L'\\' && relative.find(L':') == std::wstring::npos,
          "Runtime coordinate must be a relative path", relative, ERROR_INVALID_PARAMETER);
  return localPath(root.path + L"\\" + relative);
}

static std::unique_ptr<File> runtimeDirectory(Runtime& root, const std::wstring& path) {
  auto result = std::make_unique<File>(path);
  HANDLE duplicate;
  require(DuplicateHandle(GetCurrentProcess(), root.directory.get(), GetCurrentProcess(), &duplicate, 0, FALSE,
                          DUPLICATE_SAME_ACCESS), "Duplicate private directory handle failed", path);
  result->handles.emplace_back(duplicate);
  size_t offset = root.path.size() + 1;
  while (offset < path.size()) {
    const auto end = path.find(L'\\', offset);
    const auto name = path.substr(offset, end == std::wstring::npos ? end : end - offset);
    auto child = openRelative(result->get(), name,
                              FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | READ_CONTROL,
                              FILE_SHARE_READ, FILE_DIRECTORY_FILE, path.substr(0, end));
    FILE_ATTRIBUTE_TAG_INFO info{};
    require(GetFileInformationByHandleEx(child.get(), FileAttributeTagInfo, &info, sizeof(info)),
            "Read private directory tag failed", path);
    require((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0,
            "Reparse private directory is unsupported", path, ERROR_NOT_SUPPORTED);
    result->handles.push_back(std::move(child));
    if (end == std::wstring::npos) break;
    offset = end + 1;
  }
  return result;
}

static void directory(Runtime& root, const std::wstring& relative) {
  const auto path = relativePath(root, relative);
  const auto parentPath = path.substr(0, path.find_last_of(L'\\'));
  auto parent = runtimeDirectory(root, parentPath);
  verifyPrivate(parent->get(), parentPath, parentPath == root.path);
  Security security;
  try {
    auto created = createRelative(parent->get(), path.substr(path.find_last_of(L'\\') + 1),
                                  FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | READ_CONTROL,
                                  true, security, path);
    verifyPrivate(created.get(), path, false);
  } catch (const Failure& failure) {
    if (failure.win32 != ERROR_ALREADY_EXISTS && failure.win32 != ERROR_FILE_EXISTS) throw;
    auto existing = runtimeDirectory(root, path);
    verifyPrivate(existing->get(), path, false);
  }
}

static Handle createPrivateFile(Runtime& root, const std::wstring& relative,
                                DWORD access = DELETE | GENERIC_WRITE | GENERIC_READ | READ_CONTROL) {
  const auto path = relativePath(root, relative);
  const auto parentPath = path.substr(0, path.find_last_of(L'\\'));
  auto parent = runtimeDirectory(root, parentPath);
  verifyPrivate(parent->get(), parentPath, parentPath == root.path);
  Security security;
  auto file = createRelative(parent->get(), path.substr(path.find_last_of(L'\\') + 1),
                              access, false, security, path);
  verifyPrivate(file.get(), path, false);
  return file;
}

static void writeBytes(HANDLE file, const void* bytes, DWORD count, const std::wstring& path) {
  DWORD written;
  require(WriteFile(file, bytes, count, &written, nullptr) && written == count, "Write private file failed", path);
}

static void dispose(HANDLE handle, const std::wstring& path) {
  FILE_BASIC_INFO info{};
  require(GetFileInformationByHandleEx(handle, FileBasicInfo, &info, sizeof(info)), "Read cleanup attributes failed", path);
  if ((info.FileAttributes & FILE_ATTRIBUTE_READONLY) != 0) {
    info.FileAttributes &= ~FILE_ATTRIBUTE_READONLY;
    // Zero means "leave attributes unchanged" to FileBasicInfo. A file whose
    // sole attribute was READONLY needs NORMAL to actually clear that marker.
    if (info.FileAttributes == 0) info.FileAttributes = FILE_ATTRIBUTE_NORMAL;
    require(SetFileInformationByHandle(handle, FileBasicInfo, &info, sizeof(info)), "Clear owned readonly attribute failed", path);
  }
  FILE_DISPOSITION_INFO deletion{TRUE};
  require(SetFileInformationByHandle(handle, FileDispositionInfo, &deletion, sizeof(deletion)), "Delete owned object by handle failed", path);
}

static void parkUnresolved(Runtime& root, Handle& handle) noexcept {
  if (handle.fullyReleased()) return;
  handle.release();
  if (handle.fullyReleased()) return;
  try {
    root.unreleased.push_back(std::move(handle));
  } catch (...) {
    // The owning Handle remains live. Its destructor retains the same value.
  }
}

static void parkUnresolved(Runtime& root, std::vector<Handle>& handles) noexcept {
  for (auto& handle : handles) parkUnresolved(root, handle);
  handles.clear();
}

static void disposeSnapshot(Runtime& root, Handle& file, const std::wstring& path) {
  // Snapshot readers do not share DELETE access. Release the writer only for
  // failed-copy cleanup, with its parent pinned and its identity recorded.
  // A failed close keeps this writer; opening a second handle would drop it.
  auto parent = runtimeDirectory(root, path.substr(0, path.find_last_of(L'\\')));
  FILE_ID_INFO expected{};
  require(GetFileInformationByHandleEx(file.get(), FileIdInfo, &expected, sizeof(expected)),
          "Read incomplete snapshot identity failed", path);
  requireReleased(file, "Close incomplete snapshot writer failed", path);
  auto cleanup = openRelative(parent->get(), path.substr(path.find_last_of(L'\\') + 1),
                              DELETE | GENERIC_READ | FILE_WRITE_ATTRIBUTES,
                              FILE_SHARE_READ, FILE_NON_DIRECTORY_FILE, path);
  FILE_ID_INFO observed{};
  require(GetFileInformationByHandleEx(cleanup.get(), FileIdInfo, &observed, sizeof(observed)),
          "Read snapshot cleanup identity failed", path);
  require(expected.VolumeSerialNumber == observed.VolumeSerialNumber &&
          std::equal(std::begin(expected.FileId.Identifier), std::end(expected.FileId.Identifier),
                     std::begin(observed.FileId.Identifier)),
          "Incomplete snapshot identity changed before cleanup", path, ERROR_ACCESS_DENIED);
  verifyPrivate(cleanup.get(), path, false);
  dispose(cleanup.get(), path);
}

void closeRuntime(Runtime& root) {
  retryRetainedNativeHandles();
  if (root.closed) return;
  root.closing = true;
  // Windows keeps the bearer descriptor and snapshot leases until this owner
  // cleanup. POSIX removes its consumed descriptor earlier. Abrupt owner death
  // closes process jobs but cannot run this walk, so private files can remain.
  for (auto& handle : root.unreleased)
    requireReleased(handle, "Close retained runtime handle failed", root.path);
  root.unreleased.clear();
  // Writers share only FILE_SHARE_READ, which blocks a later delete open.
  // Release them before the walk. A failed close stays on this owner and does
  // not open a second delete handle.
  for (auto& handle : root.immutableFiles)
    requireReleased(handle, "Close retained runtime file failed", root.path);
  root.immutableFiles.clear();
  // Once the root directory handle is released, another walk would duplicate
  // an invalid handle and never reach surviving parents.
  if (!root.treeReleased) {
  // Enumerate and open children through the retained directory handles. Paths
  // below are diagnostic labels only: renames and ancestor junction replacement
  // cannot redirect cleanup into an unrelated tree.
  struct Frame {
    Handle directory;
    std::wstring path;
    // One NTFS component is at most 255 UTF-16 units; 1 KiB fits a record
    // without retaining a large batch at every directory depth.
    alignas(FILE_ID_BOTH_DIR_INFO) std::array<unsigned char, 1024> entries{};
    size_t offset = 0;
    bool buffered = false;
    bool restart = true;
    Frame(Handle handle, std::wstring path) : directory(std::move(handle)), path(std::move(path)) {}
    bool next(std::wstring& name) {
      for (;;) {
        if (!buffered) {
          const auto kind = restart ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo;
          restart = false;
          if (!GetFileInformationByHandleEx(directory.get(), kind, entries.data(),
                                            static_cast<DWORD>(entries.size()))) {
            const auto code = GetLastError();
            if (code == ERROR_NO_MORE_FILES) return false;
            throw Failure("Enumerate runtime cleanup by handle failed", path, code);
          }
          offset = 0;
          buffered = true;
        }
        require(offset <= entries.size() - offsetof(FILE_ID_BOTH_DIR_INFO, FileName),
                "Cleanup directory record is truncated", path, ERROR_INVALID_DATA);
        const auto* entry = reinterpret_cast<const FILE_ID_BOTH_DIR_INFO*>(entries.data() + offset);
        require(entry->FileNameLength % sizeof(wchar_t) == 0 &&
                entry->FileNameLength <= entries.size() - offset - offsetof(FILE_ID_BOTH_DIR_INFO, FileName),
                "Cleanup directory filename is truncated", path, ERROR_INVALID_DATA);
        name.assign(entry->FileName, entry->FileNameLength / sizeof(wchar_t));
        if (entry->NextEntryOffset == 0) buffered = false;
        else {
          require(entry->NextEntryOffset % alignof(FILE_ID_BOTH_DIR_INFO) == 0 &&
                  entry->NextEntryOffset >= offsetof(FILE_ID_BOTH_DIR_INFO, FileName) + entry->FileNameLength &&
                  entry->NextEntryOffset <= entries.size() - offset - offsetof(FILE_ID_BOTH_DIR_INFO, FileName),
                  "Cleanup directory record offset is invalid", path, ERROR_INVALID_DATA);
          offset += entry->NextEntryOffset;
        }
        if (name != L"." && name != L"..") return true;
      }
    }
  };
  std::vector<std::unique_ptr<Frame>> frames;
  HANDLE duplicate;
  require(DuplicateHandle(GetCurrentProcess(), root.directory.get(), GetCurrentProcess(), &duplicate, 0, FALSE,
                          DUPLICATE_SAME_ACCESS), "Duplicate runtime cleanup handle failed", root.path);
  frames.push_back(std::make_unique<Frame>(Handle(duplicate), root.path));
  while (!frames.empty()) {
    auto& frame = *frames.back();
    std::wstring name;
    if (!frame.next(name)) {
      dispose(frame.directory.get(), frame.path);
      requireReleased(frame.directory, "Close runtime directory handle failed", frame.path);
      frames.pop_back();
      continue;
    }
    const auto path = frame.path + L"\\" + name;
    auto child = openRelative(frame.directory.get(), name,
                              DELETE | FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES,
                              FILE_SHARE_READ | FILE_SHARE_DELETE, 0, path);
    FILE_ATTRIBUTE_TAG_INFO info{};
    require(GetFileInformationByHandleEx(child.get(), FileAttributeTagInfo, &info, sizeof(info)), "Read cleanup object tag failed", path);
    if ((info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0 && (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0)
      frames.push_back(std::make_unique<Frame>(std::move(child), path));
    else {
      dispose(child.get(), path);
      requireReleased(child, "Close runtime child handle failed", path);
    }
  }
  // Failed walks retain the root's identity leases for a later cleanup retry.
  requireReleased(root.directory, "Close runtime root handle failed", root.path);
  root.treeReleased = true;
  }
  for (auto& parent : root.parents)
    requireReleased(parent, "Close runtime parent handle failed", root.path);
  root.parents.clear();
  root.closed = true;
}

struct SnapshotWork {
  napi_env env;
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  napi_ref rootReference = nullptr;
  Runtime* root;
  std::unique_ptr<File> source;
  Handle destination;
  std::wstring path;
  std::wstring digest;
  std::unique_ptr<Failure> failure;
  SnapshotWork(napi_env env, Runtime& root) : env(env), root(&root) {}
};

static void copySnapshot(napi_env, void* pointer) {
  auto& work = *static_cast<SnapshotWork*>(pointer);
  try {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0,
            "Initialize snapshot SHA-256 failed", work.source->path, ERROR_GEN_FAILURE);
    struct Algorithm { BCRYPT_ALG_HANDLE handle; ~Algorithm() { BCryptCloseAlgorithmProvider(handle, 0); } } owner{algorithm};
    BCRYPT_HASH_HANDLE hash = nullptr;
    require(BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) == 0,
            "Create snapshot SHA-256 state failed", work.source->path, ERROR_GEN_FAILURE);
    struct Hash { BCRYPT_HASH_HANDLE handle; ~Hash() { BCryptDestroyHash(handle); } } hashOwner{hash};
    std::array<unsigned char, 65536> buffer;
    while (true) {
      require(!work.root->snapshotCancelled.load(), "Admitted snapshot was cancelled", work.path, ERROR_OPERATION_ABORTED);
      DWORD count;
      require(ReadFile(work.source->get(), buffer.data(), buffer.size(), &count, nullptr),
              "Read admitted source handle failed", work.source->path);
      if (count == 0) break;
      writeBytes(work.destination.get(), buffer.data(), count, work.path);
      require(BCryptHashData(hash, buffer.data(), count, 0) == 0,
              "Hash admitted snapshot bytes failed", work.source->path, ERROR_GEN_FAILURE);
    }
    std::array<unsigned char, 32> digest;
    require(BCryptFinishHash(hash, digest.data(), digest.size(), 0) == 0,
            "Finish snapshot SHA-256 failed", work.source->path, ERROR_GEN_FAILURE);
    require(FlushFileBuffers(work.destination.get()), "Flush private snapshot failed", work.path);
    work.digest = hex(digest.data(), digest.size());
  } catch (const Failure& failure) {
    work.failure = std::make_unique<Failure>(failure);
  } catch (const std::exception& failure) {
    work.failure = std::make_unique<Failure>(failure.what(), work.path, ERROR_GEN_FAILURE);
  }
}

static void completeSnapshot(napi_env env, napi_status status, void* pointer) {
  std::unique_ptr<SnapshotWork> work(static_cast<SnapshotWork*>(pointer));
  work->root->snapshotPending = false;
  const auto reject = [&](const Failure& failure) {
    try {
      disposeSnapshot(*work->root, work->destination, work->path);
      napi_reject_deferred(env, work->deferred, failureValue(env, failure));
    } catch (const Failure& cleanupFailure) {
      Failure combined = failure;
      combined.cleanupConstraint = cleanupFailure.constraint;
      combined.cleanupWin32 = cleanupFailure.win32;
      combined.cleanupPath = cleanupFailure.path;
      napi_reject_deferred(env, work->deferred, failureValue(env, combined));
    }
  };
  try {
    if (work->failure) throw *work->failure;
    require(status == napi_ok && !work->root->snapshotCancelled.load(), "Native snapshot worker was cancelled", work->path, ERROR_OPERATION_ABORTED);
    auto result = object(env);
    set(env, result, "sha256", string(env, work->digest));
    set(env, result, "source", identity(env, work->source->get(), work->source->requestedPath));
    set(env, result, "snapshot", identity(env, work->destination.get(), work->path));
    work->root->immutableFiles.push_back(std::move(work->destination));
    // The digest is the byte outcome. Source handles that fail close stay on
    // the runtime and are retried by runtime close; they do not erase the copy.
    if (work->source != nullptr) parkUnresolved(*work->root, work->source->handles);
    check(napi_resolve_deferred(env, work->deferred, result));
  } catch (const Failure& failure) {
    reject(failure);
  } catch (const std::exception& failure) {
    reject(Failure(failure.what(), work->path, ERROR_GEN_FAILURE));
  }
  if (work->source != nullptr) parkUnresolved(*work->root, work->source->handles);
  parkUnresolved(*work->root, work->destination);
  napi_delete_reference(env, work->rootReference);
  napi_delete_async_work(env, work->work);
}

static napi_value snapshot(napi_env env, napi_value rootValue, Runtime& root,
                           const std::wstring& sourcePath, const std::wstring& relative) {
  auto work = std::make_unique<SnapshotWork>(env, root);
  work->source = openFile(sourcePath);
  work->path = relativePath(root, relative);
  // Retain the write lease with read-only sharing, but omit DELETE authority:
  // Java's RandomAccessFile reader shares read/write, not delete access.
  work->destination = createPrivateFile(root, relative, GENERIC_WRITE | GENERIC_READ | READ_CONTROL);
  napi_value promise;
  check(napi_create_promise(env, &work->deferred, &promise));
  check(napi_create_reference(env, rootValue, 1, &work->rootReference));
  const auto label = string(env, std::string("REA admitted Windows snapshot"));
  root.snapshotCancelled.store(false);
  try {
    check(napi_create_async_work(env, nullptr, label, copySnapshot, completeSnapshot, work.get(), &work->work));
    check(napi_queue_async_work(env, work->work));
  } catch (...) {
    if (work->work) napi_delete_async_work(env, work->work);
    napi_delete_reference(env, work->rootReference);
    throw;
  }
  root.snapshotPending = true;
  work.release();
  return promise;
}

napi_value filesystemCall(napi_env env, const std::wstring& operation,
                          const std::vector<napi_value>& args, RuntimeContext& context) {
  if (operation == L"cutter_bridge_verify_directory") return verifyCutterBridgeDirectory(env, args);
  if (operation == L"cutter_bridge_read_descriptor") return readCutterBridgeDescriptor(env, args);
  const auto expected = operation == L"open" || operation == L"close" || operation == L"runtime_close" || operation == L"runtime_snapshot_cancel" ? 1
                      : operation == L"runtime_create" || operation == L"runtime_mkdir" || operation == L"runtime_open" ? 2 : 3;
  require(args.size() == static_cast<size_t>(expected), "Wrong native filesystem argument count", L"", ERROR_INVALID_PARAMETER);
  if (operation == L"open") {
    auto file = openFile(wide(env, args[0]));
    auto result = identity(env, file->get(), file->requestedPath);
    set(env, result, "handle", wrap(env, std::move(file)));
    return result;
  }
  if (operation == L"close") {
    retryRetainedNativeHandles();
    auto& file = static_cast<File&>(resource(env, args[0], Kind::File));
    // Leave a failed handle on this File. The private runtime keeps that
    // wrapper and retries this close before runtime_close.
    for (auto& handle : file.handles)
      requireReleased(handle, "Close admitted file handle failed", file.path);
    file.handles.clear();
    file.closed = true;
    return null(env);
  }
  if (operation == L"read") {
    auto& file = static_cast<File&>(resource(env, args[0], Kind::File));
    const auto position = numeric(env, args[1]);
    const auto length = numeric(env, args[2]);
    require(position >= 0 && position <= 9007199254740991.0 && position == static_cast<int64_t>(position) &&
            length >= 0 && length <= 65536 && length == static_cast<DWORD>(length),
            "Read coordinates exceed the native chunk boundary", file.path, ERROR_INVALID_PARAMETER);
    LARGE_INTEGER offset; offset.QuadPart = static_cast<int64_t>(position);
    require(SetFilePointerEx(file.get(), offset, nullptr, FILE_BEGIN), "Seek admitted file handle failed", file.path);
    std::array<unsigned char, 65536> buffer;
    DWORD count;
    require(ReadFile(file.get(), buffer.data(), static_cast<DWORD>(length), &count, nullptr), "Read admitted file handle failed", file.path);
    napi_value result;
    check(napi_create_buffer_copy(env, count, buffer.data(), nullptr, &result));
    return result;
  }
  if (operation == L"runtime_create") {
    createRuntime(wide(env, args[0]), wide(env, args[1]), context.pending);
    try {
      auto result = identity(env, context.pending->directory.get(), context.pending->path);
      set(env, result, "path", string(env, context.pending->path));
      set(env, result, "privateDacl", boolean(env, true));
      publishRuntimeHandle(env, result, context.pending);
      return result;
    } catch (Failure& primary) {
      cleanupFailedRuntime(context.pending, primary);
      throw;
    } catch (const std::exception& error) {
      Failure primary(error.what(), context.pending ? context.pending->path : L"", ERROR_GEN_FAILURE);
      cleanupFailedRuntime(context.pending, primary);
      throw primary;
    }
  }
  auto& root = static_cast<Runtime&>(resource(env, args[0], Kind::Runtime));
  require(!root.closing || operation == L"runtime_close", "Runtime cleanup is pending", root.path, ERROR_BUSY);
  if (operation == L"runtime_snapshot_cancel") { root.snapshotCancelled.store(true); return null(env); }
  require(!root.snapshotPending, "Runtime snapshot is still pending", root.path, ERROR_BUSY);
  // Reject overlapping operations before snapshot() resets cancellation. The
  // one accepted worker and WindowsPrivateRuntime retain the same root lease.
  if (operation == L"runtime_close") { closeRuntime(root); return null(env); }
  if (operation == L"runtime_mkdir") { directory(root, wide(env, args[1])); return null(env); }
  if (operation == L"runtime_open") {
    const auto path = relativePath(root, wide(env, args[1]));
    auto file = runtimeDirectory(root, path.substr(0, path.find_last_of(L'\\')));
    file->path = path;
    file->requestedPath = path;
    // Retained output handles have write and DELETE access, so this read open
    // must share both to pass Windows' symmetric share check. Those retained
    // handles still omit FILE_SHARE_WRITE and FILE_SHARE_DELETE, blocking
    // competing writes and delete opens.
    auto child = openRelative(file->get(), path.substr(path.find_last_of(L'\\') + 1),
                              GENERIC_READ | FILE_READ_ATTRIBUTES | READ_CONTROL,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              FILE_NON_DIRECTORY_FILE, path);
    FILE_ATTRIBUTE_TAG_INFO info{};
    require(GetFileInformationByHandleEx(child.get(), FileAttributeTagInfo, &info, sizeof(info)),
            "Read private file tag failed", path);
    require((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0,
            "Reparse private file is unsupported", path, ERROR_NOT_SUPPORTED);
    file->handles.push_back(std::move(child));
    verifyPrivate(file->get(), path, false);
    auto result = identity(env, file->get(), path);
    set(env, result, "handle", wrap(env, std::move(file)));
    return result;
  }
  if (operation == L"runtime_write") {
    bool isBuffer; check(napi_is_buffer(env, args[2], &isBuffer));
    require(isBuffer, "Private write requires a byte buffer", root.path, ERROR_INVALID_PARAMETER);
    void* bytes; size_t length; check(napi_get_buffer_info(env, args[2], &bytes, &length));
    require(length <= MAXDWORD, "Private write exceeds Win32 byte representation", root.path, ERROR_INVALID_PARAMETER);
    auto file = createPrivateFile(root, wide(env, args[1]));
    writeBytes(file.get(), bytes, static_cast<DWORD>(length), root.path);
    require(FlushFileBuffers(file.get()), "Flush private runtime file failed", root.path);
    root.immutableFiles.push_back(std::move(file));
    return null(env);
  }
  if (operation == L"runtime_snapshot") {
    return snapshot(env, args[0], root, wide(env, args[1]), wide(env, args[2]));
  }
  throw Failure("Unknown native filesystem operation", L"", ERROR_INVALID_PARAMETER);
}

} // namespace rea
