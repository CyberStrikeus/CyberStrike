"""Bounded native call observation executed inside LLDB's embedded Python.

REA imports this module into `lldb --batch` and runs `rea_trace <config.json>`.
It launches one owned process, stops at the requested functions and
Objective-C methods, records each entry from registers and memory reads only,
continues, and kills the process once it exits, the event or aggregate resource
limit is reached, or the duration elapses. Target output is drained through
bounded FIFOs. No expression is evaluated and no target code runs on the
tracer's behalf. The result is written as JSON to the configured path.
"""

import errno
import hashlib
import json
import os
import select
import threading
import time

import lldb

ARGUMENT_REGISTERS = {
    "arm64": ["x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7"],
    "arm64e": ["x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7"],
    "x86_64": ["rdi", "rsi", "rdx", "rcx", "r8", "r9"],
    "x86_64h": ["rdi", "rsi", "rdx", "rcx", "r8", "r9"],
}
MAX_SELECTOR_BYTES = 1024
MAX_REPORTED_LOCATIONS = 64
MAX_OTHER_STOPS = 256
MAX_TRACE_BYTES = 8 * 1024 * 1024
MAX_TRACE_FRAMES = 65_536
MAX_OBSERVATION_JOURNAL_BYTES = MAX_TRACE_BYTES
MAX_BREAKPOINT_LOCATION_BYTES = 8 * 1024 * 1024
MAX_TARGET_OUTPUT_BYTES = 1024 * 1024
OUTPUT_DRAIN_BYTES_PER_PASS = 1024 * 1024
OUTPUT_EOF_WAIT_SECONDS = 1.0
OUTPUT_READER_JOIN_SECONDS = 0.5
LISTENER_NAME = "rea-native-call-observation"


def _can_retain_trace(current_bytes, current_frames, event_bytes, event_frames):
    """Whether a complete event fits both aggregate trace budgets."""
    return (
        current_bytes + event_bytes <= MAX_TRACE_BYTES
        and current_frames + event_frames <= MAX_TRACE_FRAMES
    )


def _estimated_json_size(value):
    """Estimate JSON size without encoding potentially oversized values."""
    if isinstance(value, str):
        # json.dumps defaults to ensure_ascii=True; supplementary characters
        # can become two six-byte Unicode escapes.
        return len(value) * 12 + 2
    if value is None or isinstance(value, (bool, int, float)):
        return 32
    if isinstance(value, dict):
        return 2 + sum(
            len(key) * 6 + 4 + _estimated_json_size(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return 2 + sum(_estimated_json_size(item) + 1 for item in value)
    return 64


def _fits_trace_budget(value, remaining_bytes):
    return _estimated_json_size(value) <= remaining_bytes


class _ObservationJournal:
    """Flush a bounded JSONL prefix so observations survive tracer failure."""

    def __init__(self, handle, max_bytes=MAX_OBSERVATION_JOURNAL_BYTES):
        self.handle = handle
        self.max_bytes = max_bytes
        self.bytes = 0

    def append(self, record):
        encoded = (json.dumps(record) + "\n").encode("utf-8")
        if self.bytes + len(encoded) > self.max_bytes:
            return False
        self.handle.write(encoded)
        self.handle.flush()
        self.bytes += len(encoded)
        return True


def _set_launch_flags(launch):
    launch.SetLaunchFlags(
        launch.GetLaunchFlags()
        | lldb.eLaunchFlagDebug
        | lldb.eLaunchFlagStopAtEntry
    )


def _hash_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as target_file:
        while True:
            chunk = target_file.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _file_identity(path):
    info = os.stat(path)
    return str(info.st_dev), str(info.st_ino)


def _module_identity(target):
    module = target.FindModule(target.GetExecutable())
    if not module.IsValid():
        return None, None, None
    spec = module.GetFileSpec()
    path = str(spec) if spec.IsValid() else None
    identity = None
    if path:
        try:
            identity = _file_identity(path)
        except OSError:
            pass
    return path, identity, module.GetUUIDString() or None


def _wait_for_identity_ack(config):
    """Hold the target at entry while the host adapter captures its start identity."""
    path = config.get("identity_ack_path")
    if not path:
        return
    while True:
        try:
            with open(path, "r") as handle:
                return handle.read(32).strip()
        except FileNotFoundError:
            time.sleep(0.025)


class _OutputPipe:
    """Drain a target FIFO while retaining only its bounded output prefix."""

    def __init__(self, fifo_path, capture_path, max_bytes):
        os.mkfifo(fifo_path, 0o600)
        self.path = fifo_path
        try:
            self.fd = os.open(fifo_path, os.O_RDONLY | os.O_NONBLOCK)
        except Exception:
            os.unlink(fifo_path)
            raise
        try:
            self.capture = open(capture_path, "wb")
        except Exception:
            os.close(self.fd)
            os.unlink(fifo_path)
            raise
        self.max_bytes = max_bytes
        self.bytes = 0
        self.truncated = False
        self.closed = False
        self.stop_reader = threading.Event()
        self.reader_thread = None
        self.reader_error = None
        self.launched = False
        self.eof = threading.Event()
        self.complete = False

    def start(self):
        if self.reader_thread is None:
            self.reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
            self.reader_thread.start()

    def _reader_loop(self):
        try:
            while not self.stop_reader.is_set():
                readable, _, _ = select.select([self.fd], [], [], 0.05)
                if not readable:
                    continue
                if self.drain(OUTPUT_DRAIN_BYTES_PER_PASS) == 0:
                    # A FIFO read end is readable at EOF before the target opens it.
                    time.sleep(0.01)
        except Exception as error:
            self.reader_error = error
            self.stop_reader.set()

    def mark_launched(self):
        self.launched = True

    def drain(self, max_bytes=OUTPUT_DRAIN_BYTES_PER_PASS):
        consumed = 0
        while consumed < max_bytes:
            try:
                chunk = os.read(self.fd, min(65_536, max_bytes - consumed))
            except OSError as error:
                if error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    return consumed
                raise
            if not chunk:
                if self.launched:
                    self.eof.set()
                return consumed
            consumed += len(chunk)
            self.bytes += len(chunk)
            remaining = max(0, self.max_bytes - self.capture.tell())
            if remaining:
                self.capture.write(chunk[:remaining])
            if len(chunk) > remaining:
                self.truncated = True

    def close(self, expected_exit=False):
        if self.closed:
            return
        if expected_exit and self.launched:
            self.eof.wait(OUTPUT_EOF_WAIT_SECONDS)
        self.stop_reader.set()
        if self.reader_thread is not None:
            self.reader_thread.join(OUTPUT_READER_JOIN_SECONDS)
        stopped = self.reader_thread is None or not self.reader_thread.is_alive()
        if stopped:
            try:
                self.drain(OUTPUT_DRAIN_BYTES_PER_PASS)
            finally:
                try:
                    self.capture.close()
                finally:
                    os.close(self.fd)
                    self.closed = True
        else:
            # A daemon reader may still be unwinding a blocked filesystem write.
            # Leave its handles alone rather than racing that thread at shutdown.
            self.closed = True
        self.complete = bool(
            stopped
            and (not self.launched or (expected_exit and self.eof.is_set()))
            and self.reader_error is None
        )
        if not self.complete:
            self.truncated = True


def _hex(value):
    return "0x%x" % value


def _location(address, target):
    """Load and file address, module and symbol of one code address."""
    module = address.GetModule()
    symbol = address.GetSymbol()
    file_address = address.GetFileAddress()
    location = {
        "load_address": _hex(address.GetLoadAddress(target)),
        "file_address": None
        if file_address == lldb.LLDB_INVALID_ADDRESS
        else _hex(file_address),
        "module": module.GetFileSpec().GetFilename() if module.IsValid() else None,
        "module_path": str(module.GetFileSpec()) if module.IsValid() else None,
        "symbol": symbol.GetName() if symbol.IsValid() else None,
    }
    return location


def _no_files():
    return lldb.SBFileSpecList()


def _create_breakpoints(target, spec):
    """LLDB breakpoints for one request; a class-qualified method may need two."""
    if spec["kind"] == "function":
        modules = lldb.SBFileSpecList()
        if spec.get("module"):
            modules.Append(lldb.SBFileSpec(spec["module"], False))
        return [
            target.BreakpointCreateByName(
                spec["name"], lldb.eFunctionNameTypeAuto, modules, _no_files()
            )
        ]
    class_name = spec.get("class_name")
    method_type = spec.get("method_type", "any")
    if class_name is None:
        return [
            target.BreakpointCreateByName(
                spec["selector"], lldb.eFunctionNameTypeSelector, _no_files(), _no_files()
            )
        ]
    prefixes = {"instance": ["-"], "class": ["+"], "any": ["-", "+"]}[method_type]
    return [
        target.BreakpointCreateByName(
            "%s[%s %s]" % (prefix, class_name, spec["selector"]),
            lldb.eFunctionNameTypeFull,
            _no_files(),
            _no_files(),
        )
        for prefix in prefixes
    ]


def _dynamic_class(target, pointer):
    """Class of an Objective-C receiver from LLDB's runtime reader, without running code."""
    if pointer == 0:
        return None
    data = lldb.SBData.CreateDataFromUInt64Array(
        target.GetByteOrder(), target.GetAddressByteSize(), [pointer]
    )
    value = target.CreateValueFromData(
        "receiver", data, target.GetBasicType(lldb.eBasicTypeObjCID)
    )
    dynamic = value.GetDynamicValue(lldb.eDynamicDontRunTarget)
    name = dynamic.GetTypeName() if dynamic.IsValid() else None
    if not name or name in ("id", "objc_object *"):
        return None
    return name[:-2] if name.endswith(" *") else name


def _wanted(spec, symbol):
    """Selector-only requests may admit only instance or only class methods."""
    if spec["kind"] != "objc-method" or spec.get("class_name") is not None:
        return True
    method_type = spec.get("method_type", "any")
    if method_type == "any":
        return True
    return symbol.startswith("-[" if method_type == "instance" else "+[")


def _read_register(frame, name):
    error = lldb.SBError()
    value = frame.FindRegister(name)
    if not value.IsValid():
        raise RuntimeError("LLDB breakpoint register %s is unavailable" % name)
    number = value.GetValueAsUnsigned(error)
    if error.Fail():
        raise RuntimeError(
            "LLDB breakpoint register %s could not be read: %s" % (name, error)
        )
    return number


def _record(context, thread, frame, index, sequence, location, remaining_bytes):
    target, process, config = context["target"], context["process"], context["config"]
    symbol = location["symbol"] or ""
    if not _wanted(config["breakpoints"][index], symbol):
        return None
    names = ARGUMENT_REGISTERS.get(config["architecture"], [])
    objc_method = symbol.startswith("-[") or symbol.startswith("+[")
    values = {
        name: _read_register(frame, name)
        for name in names[: max(config["argument_registers"], 2 if objc_method else 0)]
    }
    registers = [
        {"name": name, "value": _hex(values[name])}
        for name in names[: config["argument_registers"]]
    ]
    receiver_class = None
    selector = None
    if objc_method:
        error = lldb.SBError()
        text = process.ReadCStringFromMemory(
            values[names[1]],
            MAX_SELECTOR_BYTES,
            error,
        )
        selector = text if error.Success() and text else None
        if symbol.startswith("-["):
            receiver_class = _dynamic_class(target, values[names[0]])
    estimated_base = (
        _estimated_json_size(location)
        + _estimated_json_size(receiver_class)
        + _estimated_json_size(selector)
        + 2048
    )
    if estimated_base > remaining_bytes:
        raise ValueError("trace event exceeds aggregate byte budget")
    record = {
        "sequence": sequence,
        "elapsed_ms": round((time.monotonic() - context["started"]) * 1000, 3),
        "thread_id": thread.GetThreadID(),
        "breakpoint_index": index,
        "receiver_class": receiver_class,
        "selector": selector,
        "registers": registers,
        "backtrace": [],
    }
    record.update(location)
    return record


# One trace runs in each owned LLDB subprocess. Its callbacks execute at the
# breakpoint before LLDB resumes, unlike snapshots of later public stop events.
_TRACE_CONTEXT = None


def _handle_breakpoint(context, frame, index):
    """Read one hit while LLDB's breakpoint callback owns the stopped frame."""
    if not frame.IsValid() or frame.GetPC() == lldb.LLDB_INVALID_ADDRESS:
        raise RuntimeError("LLDB breakpoint callback did not supply a readable frame")
    thread = frame.GetThread()
    events = context["events"]
    location = _location(frame.GetPCAddress(), context["target"])
    symbol = location["symbol"] or ""
    if not _wanted(context["config"]["breakpoints"][index], symbol):
        return None
    frame_count = max(
        0,
        min(thread.GetNumFrames() - 1, context["config"]["backtrace_frames"]),
    )
    event_frame_count = 1 + frame_count
    if not _can_retain_trace(
        context["retained_trace_bytes"],
        context["retained_frames"],
        0,
        event_frame_count,
    ):
        return "resource-limit"
    try:
        remaining_bytes = MAX_TRACE_BYTES - context["retained_trace_bytes"]
        record = _record(
            context, thread, frame, index, len(events), location, remaining_bytes
        )
    except ValueError:
        return "resource-limit"
    if record is not None:
        if not _fits_trace_budget(record, remaining_bytes):
            return "resource-limit"
        record_bytes = len(json.dumps(record).encode("utf-8"))
        if context["retained_trace_bytes"] + record_bytes > MAX_TRACE_BYTES:
            return "resource-limit"
        for depth in range(1, frame_count + 1):
            try:
                location = _location(
                    thread.GetFrameAtIndex(depth).GetPCAddress(), context["target"]
                )
            except ValueError:
                return "resource-limit"
            if (
                _estimated_json_size(location) + record_bytes + 1
                > MAX_TRACE_BYTES - context["retained_trace_bytes"]
            ):
                return "resource-limit"
            location_bytes = len(json.dumps(location).encode("utf-8"))
            addition = location_bytes + (1 if record["backtrace"] else 0)
            if (
                context["retained_trace_bytes"]
                + record_bytes
                + addition
                > MAX_TRACE_BYTES
            ):
                return "resource-limit"
            record["backtrace"].append(location)
            record_bytes += addition
        journal = context.get("observation_journal")
        if journal is not None and not journal.append(
            {"kind": "event", "event": record}
        ):
            return "resource-limit"
        events.append(record)
        context["retained_frames"] += event_frame_count
        context["retained_trace_bytes"] += record_bytes
    if len(events) >= context["config"]["max_events"]:
        return "event-limit"
    return None


def breakpoint_hit(frame, location, internal_dict):
    """LLDB callback: capture before resuming, and stop on a limit or failure."""
    context = _TRACE_CONTEXT
    if context is None or context["outcome"] is not None or context["failure"] is not None:
        return True
    try:
        index = context["breakpoint_index"][location.GetBreakpoint().GetID()]
        context["outcome"] = _handle_breakpoint(context, frame, index)
    except Exception as error:
        context["failure"] = "%s: %s" % (type(error).__name__, error)
        return True
    return context["outcome"] is not None


def _handle_stop(context, other_stops):
    """Retain non-breakpoint stop observations; callbacks already capture hits."""
    for thread in context["process"]:
        if thread.GetStopReason() in (lldb.eStopReasonSignal, lldb.eStopReasonException):
            stop_description = thread.GetStopDescription(256)
            journal = context.get("observation_journal")
            if journal is not None and not journal.append(
                {"kind": "other-stop", "reason": stop_description}
            ):
                return "resource-limit"
            other_stops.append(stop_description)
            if len(other_stops) >= MAX_OTHER_STOPS:
                return "stop-limit"
    return None


def _breakpoint_report(target, created, config):
    report = []
    retained_location_bytes = 0
    locations_truncated = False
    for index, breakpoints in enumerate(created):
        locations = []
        count = 0
        for breakpoint in breakpoints:
            for position in range(breakpoint.GetNumLocations()):
                address = breakpoint.GetLocationAtIndex(position).GetAddress()
                location = _location(address, target)
                if not _wanted(config["breakpoints"][index], location["symbol"] or ""):
                    continue
                count += 1
                if len(locations) < MAX_REPORTED_LOCATIONS:
                    remaining_bytes = (
                        MAX_BREAKPOINT_LOCATION_BYTES - retained_location_bytes
                    )
                    if not _fits_trace_budget(location, remaining_bytes):
                        locations_truncated = True
                        continue
                    location_bytes = len(json.dumps(location).encode("utf-8"))
                    addition = location_bytes + (1 if locations else 0)
                    if addition > remaining_bytes:
                        locations_truncated = True
                        continue
                    locations.append(location)
                    retained_location_bytes += addition
        report.append({"index": index, "location_count": count, "locations": locations})
    return report, locations_truncated


def _launch_info(target, config, listener):
    launch = lldb.SBLaunchInfo(config["arguments"])
    launch.SetListener(listener)
    _set_launch_flags(launch)
    environment = target.GetEnvironment()
    for key, value in config["environment"].items():
        environment.Set(key, value, True)
    launch.SetEnvironment(environment, False)
    if config.get("working_directory"):
        launch.SetWorkingDirectory(config["working_directory"])
    launch.AddOpenFileAction(0, "/dev/null", True, False)
    launch.AddOpenFileAction(1, config["stdout_path"], False, True)
    launch.AddOpenFileAction(2, config["stderr_path"], False, True)
    return launch


def _wait_for_exit(listener, process, seconds):
    event = lldb.SBEvent()
    deadline = time.monotonic() + seconds
    while process.GetState() != lldb.eStateExited and time.monotonic() < deadline:
        listener.WaitForEvent(1, event)


def _failed_launch_description(process):
    if process.GetState() != lldb.eStateExited or process.GetExitStatus() != -1:
        return None
    description = process.GetExitDescription()
    if isinstance(description, str) and description.lower().startswith(("attach failed", "launch failed")):
        return description
    return None


def _retire_failed_launch(process, config, listener, stdout, stderr):
    """Reconcile an SBProcess returned alongside a failed Launch error."""
    if not process.IsValid():
        stdout.close()
        stderr.close()
        return False

    pid = process.GetProcessID()
    if pid > 0:
        # Even an already-exited process needs its PID published so the host
        # can distinguish a completed launch failure from an unknown target.
        with open(config["pid_path"], "w") as handle:
            handle.write(str(pid))

    if process.GetState() != lldb.eStateExited:
        stdout.mark_launched()
        stderr.mark_launched()
        if pid > 0:
            # Hold a surviving target until the host has captured its start
            # identity. If that proof is unavailable, Kill still addresses
            # this exact SBProcess created by the current launch request.
            _wait_for_identity_ack(config)
        process.Kill()
        _wait_for_exit(listener, process, 5)

    exit_observed = process.GetState() == lldb.eStateExited
    expected_exit = exit_observed
    stdout.close(expected_exit=expected_exit)
    stderr.close(expected_exit=expected_exit)
    return exit_observed


def trace(debugger, config):
    global _TRACE_CONTEXT
    debugger.SetAsync(True)
    # Stop at the symbol itself, where argument registers still hold the ABI
    # arguments, even when line tables would let LLDB skip the prologue.
    lldb.SBDebugger.SetInternalVariable(
        "target.skip-prologue", "false", debugger.GetInstanceName()
    )
    try:
        before_digest = _hash_file(config["executable"])
        before_identity = _file_identity(config["executable"])
    except OSError as error:
        return {
            "status": "target-integrity-error",
            "error": str(error),
            "target_process_created": False,
        }
    if before_digest != config["expected_sha256"]:
        return {
            "status": "target-integrity-error",
            "error": "selected executable digest changed before LLDB target creation",
            "target_process_created": False,
        }
    error = lldb.SBError()
    target = debugger.CreateTarget(
        config["executable"], config["architecture"], None, False, error
    )
    if not target.IsValid():
        return {
            "status": "target-error",
            "error": error.GetCString(),
            "target_process_created": False,
        }
    module_path_before, module_file_identity_before, module_uuid_before = (
        _module_identity(target)
    )
    if (
        module_file_identity_before is not None
        and module_file_identity_before != before_identity
    ):
        return {
            "status": "target-integrity-error",
            "error": "LLDB executable module resolved to a different pre-launch file identity",
            "target_process_created": False,
        }
    created = [_create_breakpoints(target, spec) for spec in config["breakpoints"]]
    breakpoint_index = {}
    for index, breakpoints in enumerate(created):
        for breakpoint in breakpoints:
            breakpoint_index[breakpoint.GetID()] = index
    listener = lldb.SBListener(LISTENER_NAME)
    output_budget = config.get("max_output_bytes", MAX_TARGET_OUTPUT_BYTES)
    stdout = _OutputPipe(
        config["stdout_path"], config["stdout_capture_path"], output_budget
    )
    try:
        stderr = _OutputPipe(
            config["stderr_path"], config["stderr_capture_path"], output_budget
        )
    except Exception:
        stdout.close()
        raise
    stdout.start()
    stderr.start()
    observation_journal = None
    started = time.monotonic()
    process = None
    try:
        observation_path = config.get("observation_path")
        if observation_path:
            observation_journal = _ObservationJournal(
                open(observation_path, "wb")
            )
        process = target.Launch(_launch_info(target, config, listener), error)
        process_created = process.IsValid()
        if not error.Success() or not process_created:
            exit_observed = _retire_failed_launch(
                process, config, listener, stdout, stderr
            )
            return {
                "status": "launch-error",
                "error": error.GetCString(),
                "target_process_created": process_created,
                **(
                    {"target_process_exit_observed": True}
                    if exit_observed
                    else {}
                ),
            }
        launch_failure = _failed_launch_description(process)
        if launch_failure is not None:
            exit_observed = _retire_failed_launch(
                process, config, listener, stdout, stderr
            )
            return {
                "status": "launch-error",
                "error": launch_failure,
                "target_process_created": True,
                **(
                    {"target_process_exit_observed": True}
                    if exit_observed
                    else {}
                ),
            }
        stdout.mark_launched()
        stderr.mark_launched()
        # Publish the PID before any post-launch file or module inspection. The
        # process is stopped at entry and remains there until identity_ack.
        with open(config["pid_path"], "w") as handle:
            handle.write(str(process.GetProcessID()))
        identity_ack = _wait_for_identity_ack(config)
        if identity_ack != "readable":
            process.Kill()
            _wait_for_exit(listener, process, 5)
            expected_exit = process.GetState() == lldb.eStateExited
            stdout.close(expected_exit=expected_exit)
            stderr.close(expected_exit=expected_exit)
            return {
                "status": "target-identity-unavailable",
                "error": "host could not establish the launched process identity; target was stopped",
                "target_process_created": True,
            }
        try:
            after_digest = _hash_file(config["executable"])
            after_identity = _file_identity(config["executable"])
        except OSError as identity_error:
            process.Kill()
            stdout.close(expected_exit=process.GetState() == lldb.eStateExited)
            stderr.close(expected_exit=process.GetState() == lldb.eStateExited)
            return {
                "status": "target-integrity-error",
                "error": str(identity_error),
                "target_process_created": True,
            }
        if after_digest != config["expected_sha256"] or after_identity != before_identity:
            process.Kill()
            _wait_for_exit(listener, process, 5)
            stdout.close(expected_exit=process.GetState() == lldb.eStateExited)
            stderr.close(expected_exit=process.GetState() == lldb.eStateExited)
            return {
                "status": "target-integrity-error",
                "error": "selected executable digest or file identity changed during LLDB launch",
                "target_process_created": True,
            }
        module_path_after, module_file_identity_after, module_uuid_after = (
            _module_identity(target)
        )
        if (
            module_file_identity_after is not None
            and module_file_identity_after != before_identity
        ):
            process.Kill()
            _wait_for_exit(listener, process, 5)
            stdout.close(expected_exit=process.GetState() == lldb.eStateExited)
            stderr.close(expected_exit=process.GetState() == lldb.eStateExited)
            return {
                "status": "target-integrity-error",
                "error": "LLDB executable module resolved to a different file identity",
                "target_process_created": True,
            }
        if (
            module_uuid_before is not None
            and module_uuid_after is not None
            and module_uuid_before != module_uuid_after
        ):
            process.Kill()
            _wait_for_exit(listener, process, 5)
            stdout.close(expected_exit=process.GetState() == lldb.eStateExited)
            stderr.close(expected_exit=process.GetState() == lldb.eStateExited)
            return {
                "status": "target-integrity-error",
                "error": "LLDB executable module identity changed during launch",
                "target_process_created": True,
            }
        context = {
            "target": target,
            "process": process,
            "config": config,
            "started": started,
            "breakpoint_index": breakpoint_index,
            "retained_frames": 0,
            "retained_trace_bytes": 0,
            "observation_journal": observation_journal,
        }
        events = []
        context.update({"events": events, "outcome": None, "failure": None})
        _TRACE_CONTEXT = context
        for breakpoints in created:
            for breakpoint in breakpoints:
                breakpoint.SetScriptCallbackFunction("rea_lldb_tracer.breakpoint_hit")
        other_stops = []
        outcome = None
        deadline = started + config["duration_ms"] / 1000
        event = lldb.SBEvent()
        while outcome is None:
            if stdout.reader_error is not None:
                raise RuntimeError("stdout capture failed: %s" % stdout.reader_error)
            if stderr.reader_error is not None:
                raise RuntimeError("stderr capture failed: %s" % stderr.reader_error)
            if time.monotonic() >= deadline:
                outcome = "duration-elapsed"
                break
            if not listener.WaitForEvent(1, event):
                continue
            if not lldb.SBProcess.EventIsProcessEvent(event):
                continue
            state = lldb.SBProcess.GetStateFromEvent(event)
            if state == lldb.eStateExited:
                outcome = "exited"
            elif state == lldb.eStateStopped and not lldb.SBProcess.GetRestartedFromEvent(event):
                if context["failure"] is not None:
                    raise RuntimeError(context["failure"])
                outcome = context["outcome"] or _handle_stop(context, other_stops)
                if outcome is None:
                    process.Continue()
        pid = process.GetProcessID()
        exit_status = None
        exit_description = None
        if outcome == "exited":
            exit_status = process.GetExitStatus()
            exit_description = process.GetExitDescription()
        else:
            process.Kill()
            _wait_for_exit(listener, process, 5)
        process_exited = process.GetState() == lldb.eStateExited
        stdout.close(expected_exit=process_exited)
        stderr.close(expected_exit=process_exited)
        # SBTarget.Launch may succeed before debugserver reports an asynchronous
        # attach failure as an exited SBProcess. Its -1 status is not a target
        # exit code; preserve the debugger's concrete launch denial.
        launch_failure = _failed_launch_description(process)
        if launch_failure is not None:
            return {
                "status": "launch-error",
                "error": launch_failure,
                "target_process_created": True,
            }
        launch_identity_stable = (
            module_path_before is not None
            and module_path_after == module_path_before
            and module_file_identity_before == before_identity
            and module_file_identity_after == module_file_identity_before
            and module_uuid_before is not None
            and module_uuid_after == module_uuid_before
        )
        breakpoint_report, breakpoint_locations_truncated = _breakpoint_report(
            target, created, config
        )
        return {
            "status": "traced",
            "version": lldb.SBDebugger.GetVersionString().splitlines()[0],
            "pid": pid,
            "outcome": outcome,
            "exit_status": exit_status,
            "exit_description": exit_description,
            "killed": outcome != "exited",
            "terminated": process.GetState() == lldb.eStateExited,
            "elapsed_ms": round((time.monotonic() - started) * 1000, 3),
            "breakpoints": breakpoint_report,
            "breakpoint_locations_truncated": breakpoint_locations_truncated,
            "events": events,
            "resource_limit_reached": outcome == "resource-limit",
            "target_output": {
                "stdout_bytes": stdout.bytes,
                "stderr_bytes": stderr.bytes,
                "stdout_truncated": stdout.truncated,
                "stderr_truncated": stderr.truncated,
                "stdout_complete": stdout.complete,
                "stderr_complete": stderr.complete,
            },
            "target_identity": {
                "selected_file_sha256": after_digest,
                "loaded_image_sha256": None,
                "file_device": after_identity[0],
                "file_inode": after_identity[1],
                "module_path": module_path_after,
                "module_uuid": module_uuid_after,
                # This records matching path/module identity observations. LLDB
                # does not expose the exact mapped bytes, so it never proves a digest.
                "stable": launch_identity_stable,
            },
            "other_stops": other_stops,
        }

    finally:
        _TRACE_CONTEXT = None
        if observation_journal is not None:
            try:
                observation_journal.handle.close()
            except Exception:
                pass
        if process is not None:
            try:
                if process.IsValid() and process.GetState() != lldb.eStateExited:
                    process.Kill()
                    _wait_for_exit(listener, process, 5)
            except Exception:
                pass
        for output_pipe in (stdout, stderr):
            try:
                output_pipe.close(
                    expected_exit=(
                        process is not None
                        and process.IsValid()
                        and process.GetState() == lldb.eStateExited
                    )
                )
            except Exception:
                pass


def run(debugger, command, result, internal_dict):
    """LLDB command entry point: `rea_trace <config.json>`."""
    with open(command.strip()) as handle:
        config = json.load(handle)
    try:
        output = trace(debugger, config)
    except Exception as error:  # Reported as a tracer failure, never re-raised into LLDB.
        output = {"status": "tracer-error", "error": "%s: %s" % (type(error).__name__, error)}
    with open(config["result_path"], "w") as handle:
        json.dump(output, handle)


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -f rea_lldb_tracer.run rea_trace")
