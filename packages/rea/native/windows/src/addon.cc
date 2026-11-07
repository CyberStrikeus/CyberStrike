#include "authority.hpp"

#include <delayimp.h>
#include <cstdio>

namespace rea {

static const napi_type_tag RESOURCE_TAG = {0x45fcbf0b49e84fe3ULL, 0x9e3e5074130de843ULL};

void check(napi_status status) {
  if (status != napi_ok) throw Failure("Invalid native boundary value", L"", ERROR_INVALID_PARAMETER);
}
napi_value object(napi_env env) { napi_value value; check(napi_create_object(env, &value)); return value; }
napi_value null(napi_env env) { napi_value value; check(napi_get_null(env, &value)); return value; }
napi_value string(napi_env env, const std::string& text) {
  napi_value value; check(napi_create_string_utf8(env, text.data(), text.size(), &value)); return value;
}
napi_value string(napi_env env, const std::wstring& text) {
  static_assert(sizeof(wchar_t) == sizeof(char16_t));
  napi_value value;
  check(napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(text.data()), text.size(), &value));
  return value;
}
napi_value number(napi_env env, double numeric) {
  napi_value value; check(napi_create_double(env, numeric, &value)); return value;
}
napi_value boolean(napi_env env, bool flag) {
  napi_value value; check(napi_get_boolean(env, flag, &value)); return value;
}
void set(napi_env env, napi_value target, const char* key, napi_value value) {
  check(napi_set_named_property(env, target, key, value));
}
std::wstring wide(napi_env env, napi_value value) {
  size_t size = 0;
  check(napi_get_value_string_utf16(env, value, nullptr, 0, &size));
  require(size <= 32767, "Windows value exceeds the native string limit", L"", ERROR_INVALID_PARAMETER);
  std::vector<char16_t> buffer(size + 1);
  check(napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &size));
  std::wstring result(reinterpret_cast<const wchar_t*>(buffer.data()), size);
  require(result.find(L'\0') == std::wstring::npos, "Windows value contains NUL", L"", ERROR_INVALID_PARAMETER);
  return result;
}
double numeric(napi_env env, napi_value value) {
  double result; check(napi_get_value_double(env, value, &result)); return result;
}
std::vector<napi_value> array(napi_env env, napi_value value) {
  bool valid; check(napi_is_array(env, value, &valid));
  require(valid, "Native arguments must be an array", L"", ERROR_INVALID_PARAMETER);
  uint32_t length; check(napi_get_array_length(env, value, &length));
  std::vector<napi_value> result(length);
  for (uint32_t index = 0; index < length; ++index)
    check(napi_get_element(env, value, index, &result[index]));
  return result;
}
static void finalize(napi_env, void* data, void*) { delete static_cast<Resource*>(data); }
napi_value wrap(napi_env env, std::unique_ptr<Resource> value) {
  auto result = object(env);
  check(napi_type_tag_object(env, result, &RESOURCE_TAG));
  check(napi_wrap(env, result, value.get(), finalize, nullptr, nullptr));
  value.release();
  return result;
}
void publishRuntimeHandle(napi_env env, napi_value observation, std::unique_ptr<Runtime>& value) {
  auto handle = object(env);
  check(napi_type_tag_object(env, handle, &RESOURCE_TAG));
  // Complete the result before transferring cleanup ownership. Any earlier
  // N-API failure leaves the unpublished runtime in its environment owner.
  set(env, observation, "handle", handle);
  check(napi_wrap(env, handle, value.get(), finalize, nullptr, nullptr));
  value.release();
}
Resource& resource(napi_env env, napi_value value, Kind kind) {
  bool tagged = false;
  check(napi_check_object_type_tag(env, value, &RESOURCE_TAG, &tagged));
  require(tagged, "Native handle does not belong to REA", L"", ERROR_INVALID_HANDLE);
  void* pointer = nullptr; check(napi_unwrap(env, value, &pointer));
  auto& result = *static_cast<Resource*>(pointer);
  require(result.kind == kind && !result.closed, "Native handle is closed or has the wrong kind", L"", ERROR_INVALID_HANDLE);
  return result;
}

napi_value failureValue(napi_env env, const Failure& failure) {
    wchar_t* message = nullptr;
    FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                   nullptr, failure.win32, 0, reinterpret_cast<wchar_t*>(&message), 0, nullptr);
    std::wstring detail = message == nullptr ? L"" : message;
    if (message != nullptr) LocalFree(message);
    const std::wstring constraint(failure.constraint.begin(), failure.constraint.end());
    std::wstring renderedMessage = constraint + (failure.path.empty() ? L"" : L" [" + failure.path + L"]") +
                                   L" (Win32 " + std::to_wstring(failure.win32) + L"): " + detail;
    if (!failure.cleanupConstraint.empty()) {
      const std::wstring cleanup(failure.cleanupConstraint.begin(), failure.cleanupConstraint.end());
      renderedMessage += L"; cleanup also failed: " + cleanup +
                         (failure.cleanupPath.empty() ? L"" : L" [" + failure.cleanupPath + L"]") +
                         L" (Win32 " + std::to_wstring(failure.cleanupWin32) + L")";
    }
    auto text = string(env, renderedMessage);
    napi_value error; napi_create_error(env, nullptr, text, &error);
    const char* code = failure.win32 == ERROR_FILE_NOT_FOUND || failure.win32 == ERROR_PATH_NOT_FOUND ? "ENOENT"
                     : failure.win32 == ERROR_ACCESS_DENIED ? "EACCES" : "ERR_REA_WINDOWS_NATIVE";
    set(env, error, "code", string(env, std::string(code)));
    set(env, error, "constraint", string(env, failure.constraint));
    set(env, error, "requestedPath", string(env, failure.path));
    set(env, error, "win32Code", number(env, failure.win32));
    set(env, error, "win32Message", string(env, detail));
    if (!failure.cleanupConstraint.empty()) {
      set(env, error, "cleanupConstraint", string(env, failure.cleanupConstraint));
      set(env, error, "cleanupRequestedPath", string(env, failure.cleanupPath));
      set(env, error, "cleanupWin32Code", number(env, failure.cleanupWin32));
    }
    if (failure.runtimeDirectoryUnallocated)
      set(env, error, "runtimeAllocation", string(env, std::string("not-started")));
    return error;
}

static void cleanupRuntimeContext(void* data) noexcept {
  std::unique_ptr<RuntimeContext> context(static_cast<RuntimeContext*>(data));
  if (!context->pending) return;
  try { closeRuntime(*context->pending); }
  catch (const Failure& failure) {
    // Environment teardown cannot retain an owner or return an error. Report
    // terminal cleanup failure instead of claiming the directory was removed.
    std::fprintf(stderr, "REA Windows runtime cleanup failed (Win32 %lu) path=\"",
                 static_cast<unsigned long>(failure.win32));
    // Emit reversible UTF-16 escapes without allocation or CRT locale conversion.
    for (wchar_t unit : failure.path) {
      if (unit == L'"' || unit == L'\\') std::fputc('\\', stderr);
      if (unit >= 0x20 && unit <= 0x7e) std::fputc(static_cast<int>(unit), stderr);
      else std::fprintf(stderr, "\\u%04x", static_cast<unsigned>(unit));
    }
    std::fprintf(stderr, "\"\n");
  }
  catch (const std::exception& failure) {
    std::fprintf(stderr, "REA Windows runtime cleanup failed: %s\n", failure.what());
  }
  catch (...) {
    std::fprintf(stderr, "REA Windows runtime cleanup failed: unknown native exception\n");
  }
}

static napi_value call(napi_env env, napi_callback_info info) {
  try {
    std::array<napi_value, 2> args;
    size_t count = args.size();
    void* data = nullptr;
    check(napi_get_cb_info(env, info, &count, args.data(), nullptr, &data));
    require(count == 2, "Native call requires operation and arguments", L"", ERROR_INVALID_PARAMETER);
    const auto operation = wide(env, args[0]);
    const auto values = array(env, args[1]);
    auto& context = *static_cast<RuntimeContext*>(data);
    if (operation == L"inspect") {
      require(values.empty(), "Inspect takes no arguments", L"", ERROR_INVALID_PARAMETER);
      return inspect(env, context.pending);
    }
    if (operation.rfind(L"process_", 0) == 0) return processCall(env, operation, values);
    return filesystemCall(env, operation, values, context);
  } catch (const Failure& failure) {
    auto error = failureValue(env, failure);
    napi_throw(env, error);
    return nullptr;
  } catch (const std::exception& failure) {
    napi_throw_error(env, "ERR_REA_WINDOWS_NATIVE", failure.what());
    return nullptr;
  }
}

static napi_value initialize(napi_env env, napi_value exports) {
  auto context = std::make_unique<RuntimeContext>();
  if (napi_add_env_cleanup_hook(env, cleanupRuntimeContext, context.get()) != napi_ok) return nullptr;
  // The environment owns callback data before a function can expose it. Failed
  // initialization still leaves a valid context for the registered cleanup hook.
  auto* data = context.release();
  napi_value function;
  if (napi_create_function(env, "call", NAPI_AUTO_LENGTH, call, data, &function) != napi_ok) return nullptr;
  if (napi_set_named_property(env, exports, "call", function) != napi_ok) return nullptr;
  return exports;
}

} // namespace rea

NAPI_MODULE(NODE_GYP_MODULE_NAME, rea::initialize)

// Node-API symbols are delay-imported from "node.exe". Resolve them against the
// host executable so Node.js, Bun, and other Node-API hosts load the addon
// regardless of their executable file name.
static FARPROC WINAPI reaHostHook(unsigned event, PDelayLoadInfo info) {
  if (event != dliNotePreLoadLibrary || _stricmp(info->szDll, "node.exe") != 0) return nullptr;
  return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
}

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = reaHostHook;
