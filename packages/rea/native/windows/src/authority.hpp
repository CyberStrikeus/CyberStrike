#pragma once

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <node_api.h>

#include "handle_close.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace rea {

// Translate ordinary DOS drive separators without resolving components or
// changing extended, device, UNC, relative, or drive-relative namespaces.
inline std::wstring ordinaryDriveSeparators(std::wstring path) {
  if (path.size() >= 3 && path[1] == L':' &&
      ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) &&
      (path[2] == L'\\' || path[2] == L'/'))
    std::replace(path.begin(), path.end(), L'/', L'\\');
  return path;
}

struct Failure : std::runtime_error {
  DWORD win32;
  std::wstring path;
  std::string constraint;
  std::string cleanupConstraint;
  DWORD cleanupWin32 = ERROR_SUCCESS;
  std::wstring cleanupPath;
  // Affirmative proof for a failed runtime-parent admission; omission is unknown.
  bool runtimeDirectoryUnallocated = false;
  Failure(std::string constraint, std::wstring path = L"", DWORD code = GetLastError())
      : std::runtime_error(constraint), win32(code), path(std::move(path)),
        constraint(std::move(constraint)) {}
};

inline void require(bool condition, const char* constraint, const std::wstring& path = L"") {
  if (!condition) {
    const auto code = GetLastError();
    throw Failure(constraint, path, code);
  }
}
inline void require(bool condition, const char* constraint, const std::wstring& path, DWORD code) {
  if (!condition) throw Failure(constraint, path, code);
}

class Handle {
  OwnedHandle<HANDLE> owned_;

 public:
  Handle() noexcept : owned_(INVALID_HANDLE_VALUE) {}
  explicit Handle(HANDLE value) noexcept : owned_(INVALID_HANDLE_VALUE) { adopt(value, false); }
  ~Handle() noexcept;
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : owned_(std::move(other.owned_)) {}
  Handle& operator=(Handle&& other) noexcept;
  HANDLE get() const noexcept { return owned_.get(); }
  bool valid() const noexcept { return owned_.valid(); }
  bool fullyReleased() const noexcept { return owned_.fullyReleased(); }
  // A failed close leaves the numeric value blocked. It must not be used for
  // I/O or closed again; only a not-in-table probe may drop it.
  bool closeBlocked() const noexcept { return owned_.closeBlocked(); }
  void adopt(HANDLE value, bool blockClose) noexcept;
  HandleCloseDecision release() noexcept;
  void reset(HANDLE next = INVALID_HANDLE_VALUE) noexcept;
};

struct RetainedNativeHandle {
  HANDLE value;
  bool blockClose;
};

struct RetainedNativeHandles {
  std::mutex mutex;
  std::vector<RetainedNativeHandle> handles;
};

// Leaked for the process lifetime. Handle destructors can run during exit,
// after an ordinary function-local static would already have been destroyed.
inline RetainedNativeHandles& retainedNativeHandles() {
  static auto* const retained = new RetainedNativeHandles();
  return *retained;
}

inline HANDLE normalizedNativeHandle(HANDLE value) noexcept {
  return value == nullptr ? INVALID_HANDLE_VALUE : value;
}

inline CloseAttempt closeNativeHandle(HANDLE value) noexcept {
  if (CloseHandle(value) != FALSE) return {true, 0};
  return {false, GetLastError()};
}

inline LivenessProbe probeNativeHandle(HANDLE value) noexcept {
  DWORD flags = 0;
  if (GetHandleInformation(value, &flags) != FALSE) return {HandleLiveness::Open, 0};
  const DWORD error = GetLastError();
  if (error == ERROR_INVALID_HANDLE) return {HandleLiveness::NotInTable, error};
  return {HandleLiveness::Unavailable, error};
}

// Last owner for a value whose C++ handle is dying. A failed record keeps the
// kernel object until process exit instead of closing an unconfirmed number.
inline void retainNativeHandle(HANDLE value, bool blockClose) noexcept {
  value = normalizedNativeHandle(value);
  if (value == INVALID_HANDLE_VALUE) return;
  try {
    auto& retained = retainedNativeHandles();
    const std::lock_guard<std::mutex> lock(retained.mutex);
    retained.handles.push_back(RetainedNativeHandle{value, blockClose});
  } catch (...) {
    // The number stays open until process exit. Closing it here could reuse it.
  }
}

inline void Handle::adopt(HANDLE value, bool blockClose) noexcept {
  value = normalizedNativeHandle(value);
  if (value == INVALID_HANDLE_VALUE) return;
  if (!owned_.park(value, blockClose)) retainNativeHandle(value, blockClose);
}

inline HandleCloseDecision Handle::release() noexcept {
  return owned_.release(&closeNativeHandle, &probeNativeHandle);
}

inline void Handle::reset(HANDLE next) noexcept {
  owned_.reset(normalizedNativeHandle(next), &closeNativeHandle, &probeNativeHandle,
               &retainNativeHandle);
}

inline Handle::~Handle() noexcept {
  owned_.abandon(&closeNativeHandle, &probeNativeHandle, &retainNativeHandle);
}

inline Handle& Handle::operator=(Handle&& other) noexcept {
  if (this == &other) return *this;
  const auto incoming = other.owned_.take();
  owned_.release(&closeNativeHandle, &probeNativeHandle);
  const auto keep = [&](HANDLE value, bool blockClose) noexcept {
    if (value == INVALID_HANDLE_VALUE || value == nullptr) return;
    if (!owned_.park(value, blockClose)) retainNativeHandle(value, blockClose);
  };
  keep(incoming.value, incoming.blockValue);
  keep(incoming.extra, incoming.blockExtra);
  return *this;
}

inline void requireReleased(Handle& handle, const char* constraint,
                            const std::wstring& path = L"") {
  const HandleCloseDecision decision = handle.release();
  if (handle.fullyReleased()) return;
  const DWORD code = decision.closeError != 0       ? decision.closeError
                     : decision.evidenceError != 0 ? decision.evidenceError
                                                   : ERROR_GEN_FAILURE;
  throw Failure(constraint, path, code);
}

// Closes values detached by a dying owner. Survivors stay in the retainer.
inline void retryRetainedNativeHandles() noexcept {
  std::vector<RetainedNativeHandle> pending;
  try {
    auto& retained = retainedNativeHandles();
    const std::lock_guard<std::mutex> lock(retained.mutex);
    pending.swap(retained.handles);
  } catch (...) {
    return;
  }
  for (const RetainedNativeHandle& item : pending) {
    // The destructor releases the value once and parks it again on failure.
    Handle handle;
    handle.adopt(item.value, item.blockClose);
  }
}

enum class Kind { File, Runtime, Process };
struct Resource {
  const Kind kind;
  bool closed = false;
  explicit Resource(Kind value) : kind(value) {}
  virtual ~Resource() = default;
};
struct File : Resource {
  std::wstring requestedPath;
  std::wstring path;
  std::vector<Handle> handles;
  explicit File(std::wstring path) : Resource(Kind::File), requestedPath(path), path(std::move(path)) {}
  HANDLE get() const { return handles.back().get(); }
};
struct Runtime : Resource {
  std::wstring path;
  std::vector<Handle> parents;
  Handle directory;
  std::vector<Handle> immutableFiles;
  // Handles whose close stayed unconfirmed after snapshot or owner teardown.
  // runtime close retries these before deleting the private tree.
  std::vector<Handle> unreleased;
  bool closing = false;
  // The private tree and root directory handle have been released. Later
  // closes resume with the parent handles and do not duplicate that root.
  bool treeReleased = false;
  // Main-thread admission is single-flight; only the accepted copy owns the
  // atomic cancellation flag consumed by its async worker. ERROR_BUSY rejects
  // another copy before it can reset that flag or replace pending ownership.
  bool snapshotPending = false;
  std::atomic_bool snapshotCancelled{false};
  Runtime() : Resource(Kind::Runtime) {}
};
// A failed, not-yet-published runtime remains owned by its N-API environment
// until a later admission or environment teardown can retry cleanup by handle.
struct RuntimeContext { std::unique_ptr<Runtime> pending; };
struct Process : Resource {
  Handle job, process, stdoutRead, stderrRead, stdinWrite;
  // Present only for a job with a commit limit; receives the job's notifications.
  Handle notifications;
  ULONGLONG memoryLimit = 0;
  bool memoryLimitReached = false;
  bool inputPending = false;
  DWORD pid = 0;
  Process() : Resource(Kind::Process) {}
};

void check(napi_status status);
napi_value failureValue(napi_env env, const Failure& failure);
napi_value object(napi_env env);
napi_value string(napi_env env, const std::string& value);
napi_value string(napi_env env, const std::wstring& value);
napi_value number(napi_env env, double value);
napi_value boolean(napi_env env, bool value);
napi_value null(napi_env env);
void set(napi_env env, napi_value object, const char* key, napi_value value);
std::wstring wide(napi_env env, napi_value value);
double numeric(napi_env env, napi_value value);
std::vector<napi_value> array(napi_env env, napi_value value);
napi_value wrap(napi_env env, std::unique_ptr<Resource> resource);
void publishRuntimeHandle(napi_env env, napi_value observation, std::unique_ptr<Runtime>& runtime);
Resource& resource(napi_env env, napi_value value, Kind kind);

std::unique_ptr<File> openFile(const std::wstring& path, DWORD access = GENERIC_READ,
                             bool directory = false,
                             DWORD finalSharing = FILE_SHARE_READ);
napi_value identity(napi_env env, HANDLE handle, const std::wstring& path);
void createRuntime(const std::wstring& parent, const std::wstring& prefix,
                   std::unique_ptr<Runtime>& owner);
void cleanupFailedRuntime(std::unique_ptr<Runtime>& owner, Failure& primary);
void closeRuntime(Runtime& runtime);
napi_value filesystemCall(napi_env env, const std::wstring& operation,
                          const std::vector<napi_value>& args, RuntimeContext& context);
std::unique_ptr<Process> spawnProcess(const std::wstring& command, const std::wstring& commandLine,
                                    const std::wstring& cwd, const std::vector<std::wstring>& environment,
                                    bool protocolStdin = false, ULONGLONG memoryLimit = 0);
napi_value processCall(napi_env env, const std::wstring& operation,
                       const std::vector<napi_value>& args);
napi_value inspect(napi_env env, std::unique_ptr<Runtime>& pending);

} // namespace rea
