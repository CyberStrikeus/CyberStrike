#include "authority.hpp"

namespace rea {

class Attributes {
  std::vector<unsigned char> storage_;
public:
  explicit Attributes(DWORD count) {
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(nullptr, count, 0, &size);
    storage_.resize(size);
    require(InitializeProcThreadAttributeList(get(), count, 0, &size), "Initialize process attributes failed");
  }
  ~Attributes() { DeleteProcThreadAttributeList(get()); }
  LPPROC_THREAD_ATTRIBUTE_LIST get() { return reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage_.data()); }
  void add(DWORD_PTR key, void* value, SIZE_T size) {
    require(UpdateProcThreadAttribute(get(), 0, key, value, size, nullptr, nullptr),
            "Windows atomic process attribute is unavailable");
  }
};

// A nonzero memory limit is a commit limit for the whole job; zero keeps only
// kill-on-owner-close. The policy read back must match exactly.
static Handle createJob(ULONGLONG memoryLimit = 0) {
  Handle job(CreateJobObjectW(nullptr, nullptr));
  require(job.valid(), "Create owned Job Object failed");
  const DWORD flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | (memoryLimit != 0 ? JOB_OBJECT_LIMIT_JOB_MEMORY : 0);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION policy{};
  policy.BasicLimitInformation.LimitFlags = flags;
  policy.JobMemoryLimit = static_cast<SIZE_T>(memoryLimit);
  require(SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &policy, sizeof(policy)),
          "Apply kill-on-owner-close Job Object policy failed");
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION actual{};
  require(QueryInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &actual, sizeof(actual), nullptr),
          "Read Job Object policy failed");
  require(actual.BasicLimitInformation.LimitFlags == flags,
          "Job Object policy permits unexpected breakaway", L"", ERROR_ACCESS_DENIED);
  require(memoryLimit == 0 || static_cast<ULONGLONG>(actual.JobMemoryLimit) == memoryLimit,
          "Job Object memory limit was not applied exactly", L"", ERROR_INVALID_PARAMETER);
  return job;
}

// Associate a private completion port before any process joins the job, so
// the job's commit-limit notification cannot be missed.
static Handle createNotifications(HANDLE job) {
  Handle port(CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 1));
  require(port.valid(), "Create owned Job Object notification port failed");
  JOBOBJECT_ASSOCIATE_COMPLETION_PORT association{};
  association.CompletionKey = job;
  association.CompletionPort = port.get();
  require(SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &association, sizeof(association)),
          "Associate owned Job Object notification port failed");
  return port;
}

// JavaScript numbers cross the boundary as doubles; accept only an exact
// positive safe integer that is a whole number of pages, so read-back is exact.
static ULONGLONG jobMemoryLimit(napi_env env, napi_value value) {
  const double requested = numeric(env, value);
  require(requested >= 1 && requested <= 9007199254740991.0 &&
              static_cast<double>(static_cast<ULONGLONG>(requested)) == requested,
          "Job memory limit must be a positive safe integer", L"", ERROR_INVALID_PARAMETER);
  SYSTEM_INFO system{};
  GetSystemInfo(&system);
  const auto limit = static_cast<ULONGLONG>(requested);
  require(system.dwPageSize != 0 && limit % system.dwPageSize == 0,
          "Job memory limit must be a whole number of pages", L"", ERROR_INVALID_PARAMETER);
  return limit;
}

// An affinity mask is meaningful only inside one processor group, so only a
// process occupying exactly one group has a group a child can inherit. A
// process whose threads span groups, or whose membership cannot be read, has no
// single group.
static bool singleProcessorGroup(HANDLE process, USHORT& group) {
  USHORT count = 1;
  std::array<USHORT, 1> groups{};
  if (!GetProcessGroupAffinity(process, &count, groups.data()) || count != 1) return false;
  group = groups[0];
  return true;
}

static void pipe(Handle& read, Handle& write, bool parentReads = true) {
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE rawRead, rawWrite;
  require(CreatePipe(&rawRead, &rawWrite, &attributes, 0), "Create owned process output pipe failed");
  read.reset(rawRead); write.reset(rawWrite);
  require(SetHandleInformation(parentReads ? read.get() : write.get(), HANDLE_FLAG_INHERIT, 0), "Protect parent process pipe handle inheritance failed");
}

std::unique_ptr<Process> spawnProcess(const std::wstring& command, const std::wstring& commandLine,
                                    const std::wstring& cwd, const std::vector<std::wstring>& environment,
                                    bool protocolStdin, ULONGLONG memoryLimit) {
  const auto executable = ordinaryDriveSeparators(command);
  require(executable.size() >= 3 && executable[1] == L':' && executable[2] == L'\\',
          "Owned Windows process requires an absolute executable path", command, ERROR_INVALID_PARAMETER);
  auto result = std::make_unique<Process>();
  result->job = createJob(memoryLimit);
  if (memoryLimit != 0) {
    result->notifications = createNotifications(result->job.get());
    result->memoryLimit = memoryLimit;
  }
  Handle stdoutWrite, stderrWrite;
  pipe(result->stdoutRead, stdoutWrite); pipe(result->stderrRead, stderrWrite);
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  Handle input;
  if (protocolStdin) pipe(input, result->stdinWrite, false);
  else {
    input.reset(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    require(input.valid(), "Open owned process null input failed");
  }
  Attributes attributes(2);
  HANDLE job = result->job.get();
  attributes.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &job, sizeof(job));
  std::array<HANDLE, 3> inherited{input.get(), stdoutWrite.get(), stderrWrite.get()};
  attributes.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited.data(), sizeof(inherited));
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = input.get();
  startup.StartupInfo.hStdOutput = stdoutWrite.get();
  startup.StartupInfo.hStdError = stderrWrite.get();
  startup.lpAttributeList = attributes.get();
  // Windows environment names use ordinal case-insensitive comparison, not
  // locale collation or JavaScript's expanding Unicode uppercase conversion.
  auto orderedEnvironment = environment;
  auto keyLength = [&](const std::wstring& entry) {
    const auto end = entry.find(L'=', entry.front() == L'=' ? 1 : 0);
    require(end != std::wstring::npos && end > 0, "Invalid child environment name", command,
            ERROR_INVALID_PARAMETER);
    return static_cast<int>(end);
  };
  for (const auto& entry : orderedEnvironment) {
    require(!entry.empty(), "Empty child environment entry", command, ERROR_INVALID_PARAMETER);
    keyLength(entry);
  }
  auto compareNames = [&](const std::wstring& left, const std::wstring& right) {
    const auto result = CompareStringOrdinal(left.data(), keyLength(left), right.data(), keyLength(right), TRUE);
    require(result != 0, "Compare Windows environment names failed", command);
    return result;
  };
  std::stable_sort(orderedEnvironment.begin(), orderedEnvironment.end(),
                   [&](const std::wstring& left, const std::wstring& right) {
                     return compareNames(left, right) == CSTR_LESS_THAN;
                   });
  std::vector<std::wstring> uniqueEnvironment;
  for (auto& entry : orderedEnvironment) {
    if (!uniqueEnvironment.empty() && compareNames(uniqueEnvironment.back(), entry) == CSTR_EQUAL)
      uniqueEnvironment.back() = std::move(entry);
    else uniqueEnvironment.push_back(std::move(entry));
  }
  std::vector<wchar_t> variables;
  for (const auto& entry : uniqueEnvironment) {
    variables.insert(variables.end(), entry.begin(), entry.end()); variables.push_back(L'\0');
  }
  variables.push_back(L'\0');
  if (uniqueEnvironment.empty()) variables.push_back(L'\0');
  std::vector<wchar_t> line(commandLine.begin(), commandLine.end()); line.push_back(L'\0');
  PROCESS_INFORMATION process{};
  require(CreateProcessW(executable.c_str(), line.data(), nullptr, nullptr, TRUE,
                         CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW,
                         variables.data(), cwd.empty() ? nullptr : cwd.c_str(), &startup.StartupInfo, &process),
          "Create process atomically inside owned Job Object failed", command);
  result->process.reset(process.hProcess);
  Handle thread(process.hThread);
  result->pid = process.dwProcessId;
  // An elevated token may default file ownership to Administrators. Normalize
  // only the suspended child's default owner so its runtime files belong to the
  // current user; the caller's token and privileges are not modified.
  HANDLE rawToken;
  require(OpenProcessToken(result->process.get(), TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, &rawToken),
          "Open suspended process default-owner token failed", command);
  Handle token(rawToken);
  DWORD tokenSize = 0;
  GetTokenInformation(token.get(), TokenUser, nullptr, 0, &tokenSize);
  std::vector<unsigned char> tokenUser(tokenSize);
  require(GetTokenInformation(token.get(), TokenUser, tokenUser.data(), tokenSize, &tokenSize),
          "Read suspended process user identity failed", command);
  TOKEN_OWNER owner{reinterpret_cast<TOKEN_USER*>(tokenUser.data())->User.Sid};
  require(SetTokenInformation(token.get(), TokenOwner, &owner, sizeof(owner)),
          "Set suspended process file owner failed", command);
  // A mask names processors inside one processor group, and Windows assigns a
  // new process to a group of its own choosing, so a mask belonging to another
  // group is rejected (ERROR_INVALID_PARAMETER). An unconstrained caller, whose
  // mask is its group's whole active set, asks for no bound the child's own
  // group cannot give, so such a child keeps that group's default and the spawn
  // proceeds. A narrower mask is a deliberate CPU constraint that a child in
  // another group cannot express, and silently widening it would hand the
  // provider tree the whole group, so that spawn fails naming the constraint.
  DWORD_PTR affinity = 0, systemAffinity = 0;
  require(GetProcessAffinityMask(GetCurrentProcess(), &affinity, &systemAffinity),
          "Read caller process affinity failed", command);
  USHORT callerGroup = 0, childGroup = 0;
  const bool sharedGroup = singleProcessorGroup(GetCurrentProcess(), callerGroup) &&
                           singleProcessorGroup(result->process.get(), childGroup) &&
                           callerGroup == childGroup;
  if (affinity != 0 && sharedGroup)
    require(SetProcessAffinityMask(result->process.get(), affinity), "Preserve caller process affinity failed", command);
  else
    require(affinity == 0 || affinity == systemAffinity,
            "Caller CPU affinity cannot bound an owned process in another processor group", command,
            ERROR_INVALID_PARAMETER);
  const DWORD priority = GetPriorityClass(GetCurrentProcess());
  require(priority != 0 && SetPriorityClass(result->process.get(), priority),
          "Preserve caller process priority failed", command);
  BOOL assigned = FALSE;
  if (!IsProcessInJob(result->process.get(), result->job.get(), &assigned) || !assigned) {
    TerminateJobObject(result->job.get(), 1);
    throw Failure("Suspended process has no owned Job Object membership", command, ERROR_ACCESS_DENIED);
  }
  require(ResumeThread(thread.get()) != MAXDWORD, "Resume job-owned process failed", command);
  return result;
}

static napi_value readOutput(napi_env env, Handle& read, bool& ended) {
  constexpr size_t kMaximumReadPerPoll = 1024 * 1024;
  std::array<unsigned char, 65536> chunk;
  std::vector<unsigned char> bytes;
  // A close-blocked pipe is EOF. Its number may have been reused, so this
  // poll must not pass it to PeekNamedPipe or ReadFile. process_close still
  // owns that value.
  if (!read.valid() || read.closeBlocked()) ended = true;
  else {
    while (bytes.size() < kMaximumReadPerPoll) {
      DWORD available = 0;
      if (!PeekNamedPipe(read.get(), nullptr, 0, nullptr, &available, nullptr)) {
        require(GetLastError() == ERROR_BROKEN_PIPE,
                "Observe owned process output failed");
        // Broken pipe is EOF for the bytes already queued. A failed close keeps
        // this handle for process_close instead of dropping those bytes.
        read.release();
        ended = true;
        break;
      }
      if (available == 0) break;
      const auto requested = static_cast<DWORD>(std::min<size_t>(
          {available, chunk.size(), kMaximumReadPerPoll - bytes.size()}));
      DWORD count = 0;
      require(ReadFile(read.get(), chunk.data(), requested, &count, nullptr) &&
                  count > 0,
              "Read owned process output failed");
      bytes.insert(bytes.end(), chunk.begin(), chunk.begin() + count);
    }
  }
  napi_value result;
  check(napi_create_buffer_copy(env, bytes.size(), bytes.data(), nullptr, &result));
  return result;
}

static DWORD activeProcesses(Process& process) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION state{};
  require(QueryInformationJobObject(process.job.get(), JobObjectBasicAccountingInformation, &state, sizeof(state), nullptr),
          "Observe owned Job Object settlement failed");
  return state.ActiveProcesses;
}

// Drain queued job notifications without waiting. The commit-limit message is
// posted when an allocation fails, before the process can exit. An observed
// exit must be followed by another drain before its diagnostics are published.
static void observeNotifications(Process& process) {
  if (!process.notifications.valid()) return;
  DWORD message = 0;
  ULONG_PTR key = 0;
  LPOVERLAPPED detail = nullptr;
  while (GetQueuedCompletionStatus(process.notifications.get(), &message, &key, &detail, 0)) {
    if (key == reinterpret_cast<ULONG_PTR>(process.job.get()) && message == JOB_OBJECT_MSG_JOB_MEMORY_LIMIT)
      process.memoryLimitReached = true;
  }
  const auto error = GetLastError();
  require(detail == nullptr && error == WAIT_TIMEOUT, "Observe owned Job Object notifications failed", L"", error);
}

static ULONGLONG peakJobMemory(Process& process) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION state{};
  require(QueryInformationJobObject(process.job.get(), JobObjectExtendedLimitInformation, &state, sizeof(state), nullptr),
          "Observe owned Job Object memory failed");
  return static_cast<ULONGLONG>(state.PeakJobMemoryUsed);
}

static napi_value callerToken(napi_env env) {
  HANDLE raw;
  require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE, &raw), "Read caller token failed");
  Handle token(raw);
  DWORD size;
  TOKEN_ELEVATION elevation{};
  require(GetTokenInformation(token.get(), TokenElevation, &elevation, sizeof(elevation), &size), "Read caller elevation failed");
  std::vector<unsigned char> user(4096), owner(4096), integrity(4096);
  require(GetTokenInformation(token.get(), TokenUser, user.data(), user.size(), &size) &&
          GetTokenInformation(token.get(), TokenOwner, owner.data(), owner.size(), &size) &&
          GetTokenInformation(token.get(), TokenIntegrityLevel, integrity.data(), integrity.size(), &size),
          "Read caller token observations failed");
  HANDLE rawImpersonation;
  require(DuplicateToken(token.get(), SecurityIdentification, &rawImpersonation), "Observe caller group membership failed");
  Handle impersonation(rawImpersonation);
  std::array<unsigned char, SECURITY_MAX_SID_SIZE> administrators;
  DWORD administratorSize = administrators.size();
  require(CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, administrators.data(), &administratorSize),
          "Create administrator group identity failed");
  BOOL administrator = FALSE, assigned = FALSE;
  require(CheckTokenMembership(impersonation.get(), administrators.data(), &administrator), "Read caller administrator membership failed");
  require(IsProcessInJob(GetCurrentProcess(), nullptr, &assigned), "Read caller job membership failed");
  const auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(integrity.data())->Label.Sid;
  auto result = object(env);
  set(env, result, "elevated", boolean(env, elevation.TokenIsElevated != 0));
  set(env, result, "administrator", boolean(env, administrator != FALSE));
  set(env, result, "integrityLevel", number(env, *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1)));
  set(env, result, "defaultOwnerIsUser", boolean(env, EqualSid(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,
                                                              reinterpret_cast<TOKEN_OWNER*>(owner.data())->Owner)));
  set(env, result, "inJob", boolean(env, assigned != FALSE));
  return result;
}

struct InputWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  napi_ref processReference = nullptr;
  Process* process;
  Handle pipe;
  std::vector<unsigned char> bytes;
  size_t written = 0;
  std::unique_ptr<Failure> failure;
  explicit InputWork(Process& process) : process(&process) {}
};

static void writeInput(napi_env, void* pointer) {
  auto& work = *static_cast<InputWork*>(pointer);
  try {
    // Anonymous pipe writes may block. Keep them off the JS thread so output
    // polling and job termination remain live while a child stops reading.
    while (work.written < work.bytes.size()) {
      DWORD written = 0;
      const auto count = static_cast<DWORD>(std::min<size_t>(65536, work.bytes.size() - work.written));
      require(WriteFile(work.pipe.get(), work.bytes.data() + work.written, count, &written, nullptr),
              "Write owned process input failed");
      require(written > 0, "Owned process input write made no progress", L"", ERROR_WRITE_FAULT);
      work.written += written;
    }
  } catch (const Failure& failure) {
    work.failure = std::make_unique<Failure>(failure);
  } catch (const std::exception& failure) {
    work.failure = std::make_unique<Failure>(failure.what(), L"", ERROR_GEN_FAILURE);
  }
}

static void completeInput(napi_env env, napi_status status, void* pointer) {
  std::unique_ptr<InputWork> work(static_cast<InputWork*>(pointer));
  work->process->inputPending = false;
  if (work->failure) napi_reject_deferred(env, work->deferred, failureValue(env, *work->failure));
  else if (status != napi_ok)
    napi_reject_deferred(env, work->deferred, failureValue(env, Failure("Owned process input worker was cancelled", L"", ERROR_OPERATION_ABORTED)));
  else napi_resolve_deferred(env, work->deferred, number(env, work->written));
  napi_delete_reference(env, work->processReference);
  napi_delete_async_work(env, work->work);
}

static napi_value inputWrite(napi_env env, napi_value owner, Process& process, napi_value input) {
  require(process.stdinWrite.valid() && !process.stdinWrite.closeBlocked(),
          "Owned process has no writable input", L"", ERROR_BROKEN_PIPE);
  require(!process.inputPending, "Owned process input already has a pending write", L"", ERROR_BUSY);
  auto work = std::make_unique<InputWork>(process);
  void* bytes = nullptr;
  size_t size = 0;
  bool buffer = false;
  check(napi_is_buffer(env, input, &buffer));
  require(buffer, "Owned process input must be a Buffer", L"", ERROR_INVALID_PARAMETER);
  check(napi_get_buffer_info(env, input, &bytes, &size));
  if (size > 0) work->bytes.assign(static_cast<unsigned char*>(bytes), static_cast<unsigned char*>(bytes) + size);
  HANDLE pipe;
  require(DuplicateHandle(GetCurrentProcess(), process.stdinWrite.get(), GetCurrentProcess(), &pipe,
                          0, FALSE, DUPLICATE_SAME_ACCESS), "Retain owned process input handle failed");
  work->pipe.reset(pipe);
  napi_value promise;
  check(napi_create_promise(env, &work->deferred, &promise));
  check(napi_create_reference(env, owner, 1, &work->processReference));
  try {
    check(napi_create_async_work(env, nullptr, string(env, std::string("REA owned process input")),
                               writeInput, completeInput, work.get(), &work->work));
    check(napi_queue_async_work(env, work->work));
    process.inputPending = true;
  } catch (...) {
    if (work->work) napi_delete_async_work(env, work->work);
    napi_delete_reference(env, work->processReference);
    throw;
  }
  work.release();
  return promise;
}

napi_value processCall(napi_env env, const std::wstring& operation, const std::vector<napi_value>& args) {
  if (operation == L"process_caller_token") {
    require(args.empty(), "Caller token observation takes no arguments", L"", ERROR_INVALID_PARAMETER);
    return callerToken(env);
  }
  if (operation == L"process_spawn") {
    require(args.size() >= 4 && args.size() <= 6, "Wrong native process launch argument count", L"", ERROR_INVALID_PARAMETER);
    bool protocolStdin = false;
    if (args.size() >= 5) check(napi_get_value_bool(env, args[4], &protocolStdin));
    const ULONGLONG memoryLimit = args.size() == 6 ? jobMemoryLimit(env, args[5]) : 0;
    std::vector<std::wstring> environment;
    for (const auto& entry : array(env, args[3])) environment.push_back(wide(env, entry));
    auto process = spawnProcess(wide(env, args[0]), wide(env, args[1]), wide(env, args[2]), environment, protocolStdin,
                                memoryLimit);
    auto result = object(env);
    set(env, result, "pid", number(env, process->pid));
    set(env, result, "jobAssigned", boolean(env, true));
    set(env, result, "killOnOwnerClose", boolean(env, true));
    if (process->memoryLimit != 0)
      set(env, result, "jobMemoryLimitBytes", number(env, static_cast<double>(process->memoryLimit)));
    set(env, result, "handle", wrap(env, std::move(process)));
    return result;
  }
  if (operation == L"process_stdin_write") {
    require(args.size() == 2, "Wrong native process input argument count", L"", ERROR_INVALID_PARAMETER);
    return inputWrite(env, args[0], static_cast<Process&>(resource(env, args[0], Kind::Process)), args[1]);
  }
  require(args.size() == 1, "Wrong native process handle argument count", L"", ERROR_INVALID_PARAMETER);
  auto& process = static_cast<Process&>(resource(env, args[0], Kind::Process));
  if (operation == L"process_stdin_close") {
    requireReleased(process.stdinWrite, "Close owned process stdin failed");
    return null(env);
  }
  if (operation == L"process_poll") {
    auto result = object(env);
    bool stdoutEnded = false, stderrEnded = false;
    set(env, result, "stdout", readOutput(env, process.stdoutRead, stdoutEnded));
    set(env, result, "stderr", readOutput(env, process.stderrRead, stderrEnded));
    set(env, result, "stdoutEnded", boolean(env, stdoutEnded));
    set(env, result, "stderrEnded", boolean(env, stderrEnded));
    observeNotifications(process);
    const auto exited = WaitForSingleObject(process.process.get(), 0);
    require(exited == WAIT_OBJECT_0 || exited == WAIT_TIMEOUT, "Observe owned process exit failed");
    DWORD code = 0;
    if (exited == WAIT_OBJECT_0) {
      // The child may have reached its limit and exited after the first drain.
      observeNotifications(process);
      require(GetExitCodeProcess(process.process.get(), &code), "Read owned process exit code failed");
    }
    set(env, result, "exitCode", exited == WAIT_OBJECT_0 ? number(env, code) : null(env));
    set(env, result, "activeProcesses", number(env, activeProcesses(process)));
    if (process.memoryLimit != 0) {
      set(env, result, "memoryLimitReached", boolean(env, process.memoryLimitReached));
      set(env, result, "peakJobMemoryBytes", number(env, static_cast<double>(peakJobMemory(process))));
    }
    return result;
  }
  if (operation == L"process_alive") return number(env, activeProcesses(process));
  if (operation == L"process_terminate") {
    const auto active = activeProcesses(process);
    if (active > 0) require(TerminateJobObject(process.job.get(), 1), "Terminate owned Job Object failed");
    return boolean(env, active > 0);
  }
  if (operation == L"process_close") {
    // Closing the job is the crash-safe authority; no PID enumeration is used.
    // A failed close leaves that handle on this process so a later close can
    // retry it. Handles that already closed stay released, so the retry
    // resumes at the first handle still owned. Callers that have observed
    // settlement must retry this close alone; kill and poll still need the job.
    retryRetainedNativeHandles();
    requireReleased(process.job, "Close owned Job Object failed");
    requireReleased(process.process, "Close owned process failed");
    requireReleased(process.stdoutRead, "Close owned process stdout failed");
    requireReleased(process.stderrRead, "Close owned process stderr failed");
    requireReleased(process.stdinWrite, "Close owned process stdin failed");
    requireReleased(process.notifications, "Close owned process notifications failed");
    process.closed = true;
    return null(env);
  }
  throw Failure("Unknown native process operation", L"", ERROR_INVALID_PARAMETER);
}

napi_value inspect(napi_env env, std::unique_ptr<Runtime>& pending) {
  // Settle the previous owner before admitting another probe. Failed cleanup
  // retains its handles, including when identity construction itself failed.
  if (pending) { closeRuntime(*pending); pending.reset(); }
  wchar_t temp[32768];
  const auto length = GetTempPathW(32768, temp);
  require(length > 0 && length < 32768, "Read temporary directory coordinate failed");
  createRuntime(std::wstring(temp, length), L"rea-native-probe-", pending);
  napi_value filesystem;
  try {
    filesystem = identity(env, pending->directory.get(), pending->path);
  } catch (Failure& primary) {
    cleanupFailedRuntime(pending, primary);
    throw;
  } catch (const std::exception& error) {
    Failure primary(error.what(), pending ? pending->path : L"", ERROR_GEN_FAILURE);
    cleanupFailedRuntime(pending, primary);
    throw primary;
  }
  closeRuntime(*pending);
  pending.reset();
  auto job = createJob();
  Attributes attributes(1);
  HANDLE raw = job.get();
  attributes.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &raw, sizeof(raw));
  // Establish the commit-limit policy and its notification port on this host.
  auto limited = createJob(64ULL * 1024 * 1024);
  auto notifications = createNotifications(limited.get());
  auto result = object(env);
  set(env, result, "abiVersion", number(env, 1));
  set(env, result, "nodeApiVersion", number(env, 8));
  set(env, result, "architecture", string(env, std::string("x64")));
  set(env, result, "filesystem", filesystem);
  set(env, result, "privateDacl", boolean(env, true));
  set(env, result, "privateBridgeDescriptorAccess", boolean(env, true));
  set(env, result, "atomicJobAssignment", boolean(env, true));
  set(env, result, "killOnOwnerClose", boolean(env, true));
  set(env, result, "protocolStdin", boolean(env, true));
  set(env, result, "jobMemoryLimit", boolean(env, true));
  return result;
}

} // namespace rea
