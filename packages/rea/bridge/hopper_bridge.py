"""Authenticated REA adapter executed on Hopper's dedicated Python thread.

The bootstrap injects ``REA_SOCKET`` and a random ``REA_TOKEN`` before executing
this file with Hopper's supported ``--python`` launcher option. Keep all Hopper
API access on this thread: moving dispatch to a worker can deadlock Hopper.
"""

import json
import hmac
import os
import re
import socket
from typing import Any, Optional, Protocol, Sequence

BAD_ADDRESSES = (-1, 0xFFFFFFFFFFFFFFFF, None)
# The native label setter truncates NSString names at this UTF-16 extent.
HOPPER_SYMBOL_NAME_UTF16_UNITS = 1024
# Request JSON payload budget in bytes, excluding the trailing LF.
# REA_BRIDGE_MAX_REQUEST_BYTES selects it. Unset stays 16777216.
# 7464 is the authenticated Cutter frame of the largest bounded symbol name.
# Cutter's 64-receipt recovery status is smaller with a null path. A path
# that does not fit is null, not an older descriptor path.
# 536870887 is Node's 536870888-character string ceiling minus the framing LF.
# The ceiling is the encoded payload; JSON expansion is measured before it.
# Encoded JSON allowance, in bytes, shared by one instruction list, one
# native-caller list, and one caller-scan page. This release has no runtime override.
CALLER_SCAN_ALLOWANCE_BYTES = 512 * 1024
_BRIDGE_MAX_REQUEST_BYTES_SETTING = "REA_BRIDGE_MAX_REQUEST_BYTES"
DEFAULT_BRIDGE_MAX_REQUEST_BYTES = 16 * 1024 * 1024
MINIMUM_BRIDGE_MAX_REQUEST_BYTES = 7464
MAXIMUM_BRIDGE_MAX_REQUEST_BYTES = 536870887


def _bridge_max_request_bytes_constraint():
    return (
        "REA_BRIDGE_MAX_REQUEST_BYTES must be a positive decimal integer "
        "from %d to %d bytes; the default is %d bytes (16 MiB). "
        "A value below %d bytes cannot carry the largest admitted "
        "symbol-name command, and a larger value is refused so the encoded "
        "payload plus its framing LF stays one string under Node's "
        "single-string ceiling."
        % (
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
            DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
        )
    )


def _parse_bridge_max_request_bytes(raw):
    """Refuse a non-decimal or out-of-range ceiling. Never fall back."""
    constraint = _bridge_max_request_bytes_constraint()
    if isinstance(raw, bool):
        raise RuntimeError(constraint)
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        # ASCII digits only. str.isdigit() accepts numerals such as U+0668
        # that the TypeScript setting rejects.
        if re.fullmatch(r"[1-9][0-9]*", raw) is None:
            raise RuntimeError(constraint)
        value = int(raw)
    else:
        raise RuntimeError(constraint)
    if (
        value < MINIMUM_BRIDGE_MAX_REQUEST_BYTES
        or value > MAXIMUM_BRIDGE_MAX_REQUEST_BYTES
    ):
        raise RuntimeError(constraint)
    return value


def _resolve_bridge_max_request_bytes():
    """Prefer the bootstrap injection, then the process environment, then 16 MiB."""
    injected = globals().get(_BRIDGE_MAX_REQUEST_BYTES_SETTING)
    if injected is not None:
        return _parse_bridge_max_request_bytes(injected), "setting"
    raw = os.environ.get(_BRIDGE_MAX_REQUEST_BYTES_SETTING)
    if raw is None:
        return DEFAULT_BRIDGE_MAX_REQUEST_BYTES, "default"
    return _parse_bridge_max_request_bytes(raw), "setting"


MAX_REQUEST_BYTES, BRIDGE_MAX_REQUEST_BYTES_SOURCE = (
    _resolve_bridge_max_request_bytes()
)


def _bridge_max_request_bytes_recovery():
    return (
        "The effective REA_BRIDGE_MAX_REQUEST_BYTES value is %d bytes "
        "(source %s; default %d, floor %d, maximum %d). "
        "Set REA_BRIDGE_MAX_REQUEST_BYTES in the environment that starts REA "
        "to a decimal integer from %d to %d, then restart REA. "
        "Restart Hopper or Cutter from that same environment so the bridge "
        "uses this ceiling."
        % (
            MAX_REQUEST_BYTES,
            BRIDGE_MAX_REQUEST_BYTES_SOURCE,
            DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
        )
    )
_rea_session_document = None
_search_inventory_cache = {}
_pseudocode_cache = {}
_hopper_api = None


class HopperDocument(Protocol):
    """Typed minimum used by the provider-neutral Hopper API facade."""

    def getDocumentName(self) -> str: ...

    def getExecutableFilePath(self) -> Optional[str]: ...

    def getDatabaseFilePath(self) -> Optional[str]: ...

    def backgroundProcessActive(self) -> bool: ...


class HopperDocumentProvider(Protocol):
    """Hopper's injected global document provider."""

    @classmethod
    def getAllDocuments(cls) -> Sequence[HopperDocument]: ...

    @classmethod
    def getCurrentDocument(cls) -> Optional[HopperDocument]: ...


class HopperApiFacade:
    """Small injected boundary around Hopper globals for standalone tests."""

    def __init__(self, document_provider: HopperDocumentProvider):
        self._document_provider = document_provider

    def documents(self) -> Sequence[HopperDocument]:
        return self._document_provider.getAllDocuments()

    def current_document(self) -> Optional[HopperDocument]:
        return self._document_provider.getCurrentDocument()

    def require_analysis_complete(
        self, document: HopperDocument, operation: str
    ) -> None:
        if document.backgroundProcessActive():
            raise CapabilityUnavailableError(
                "%s requires completed Hopper background analysis" % operation
            )


def _configure_hopper_api(document_provider):
    """Inject Hopper's document provider or a standalone test facade."""
    global _hopper_api, _rea_session_document
    _hopper_api = HopperApiFacade(document_provider)
    _rea_session_document = None


def _api():
    """Resolve Hopper globals lazily so importing this module needs no Hopper."""
    global _hopper_api
    if _hopper_api is not None:
        return _hopper_api
    document_provider = globals().get("Document")
    if document_provider is None:
        raise CapabilityUnavailableError(
            "Hopper Document API is unavailable outside the Hopper runtime"
        )
    _hopper_api = HopperApiFacade(document_provider)
    return _hopper_api


def _session_document():
    """Return the exact document bound to this authenticated REA session."""
    global _rea_session_document
    documents = _api().documents()
    if _rea_session_document is not None:
        # Hopper recreates Python wrappers; equality compares native handles.
        # Retain our bound wrapper so cache identity stays stable across calls.
        return (
            _rea_session_document
            if any(document == _rea_session_document for document in documents)
            else None
        )
    return _bind_session_document(documents)


def _bind_session_document(documents=None):
    """Bind this bridge to Hopper's current document for its target."""
    global _rea_session_document
    api = _api()
    if documents is None:
        documents = api.documents()
    target = os.path.realpath(REA_TARGET_PATH)

    def matches_target(document):
        paths = (document.getExecutableFilePath(), document.getDatabaseFilePath())
        return any(path and os.path.realpath(path) == target for path in paths)

    current = api.current_document()
    if current is not None and matches_target(current):
        _rea_session_document = current
        return current
    matching = [document for document in documents if matches_target(document)]
    if len(matching) == 1:
        _rea_session_document = matching[0]
        return matching[0]
    if len(matching) > 1:
        raise CapabilityUnavailableError(
            "The REA session document is ambiguous; Hopper did not identify the launched document"
        )
    return None


class CapabilityUnavailableError(Exception):
    """The active Hopper build lacks one admitted public API operation."""


class InvalidRequestError(Exception):
    """Caller input failed bridge request or operation validation."""


EXHAUSTIVE_ANALYSIS_METHODS = frozenset(
    (
        "analyze_function",
        "list_names",
        "list_procedures",
        "list_strings",
        "procedure_address",
        "procedure_assembly",
        "procedure_callees",
        "procedure_callers",
        "rea_caller_scan_page",
        "rea_caller_scan_target",
        "rea_caller_base",
        "procedure_info",
        "procedure_pseudo_code",
        "procedure_references",
        "read_function_instructions",
        "resolve_containing_procedure",
        "search_procedures",
        "search_strings",
    )
)


def _hex(value):
    if not isinstance(value, int) or isinstance(value, bool):
        try:
            value = int(str(value), 16)
        except ValueError as error:
            raise ValueError("Hopper returned a non-hexadecimal address") from error
    return "0x%x" % value


def _json_safe(value):
    """Project Hopper-specific Python values into the JSON protocol boundary."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return str(value)


def _document(name=None):
    """Keep observations and mutations bound to the active REA target."""
    documents = _api().documents()
    session_document = _session_document()
    if session_document is None:
        raise CapabilityUnavailableError("The active REA target's Hopper document is no longer open; reopen the target with open_binary")
    if name is not None:
        # A document name is display metadata; scope it to the bound native
        # handle even when another open target happens to have the same name.
        if session_document.getDocumentName() == name:
            return session_document
        if any(candidate.getDocumentName() == name for candidate in documents):
            raise InvalidRequestError("Hopper document belongs to another target; use open_binary to select that target")
        raise InvalidRequestError("Unknown Hopper document")
    return session_document


def _api_text(value, field):
    """Validate text before passing it to Hopper's native UTF-8 string API."""
    if not isinstance(value, str):
        raise InvalidRequestError("%s must be a string" % field)
    if "\0" in value:
        raise InvalidRequestError("%s contains a NUL character, which Hopper's Python API cannot represent" % field)
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise InvalidRequestError("%s contains an unpaired Unicode surrogate, which Hopper's Python API cannot represent" % field) from error
    return value


def _validate_name_targets(document, names):
    """Keep Hopper's unique-label moves within the explicitly selected addresses."""
    targets = {address for _, address, _ in names}
    if len(targets) != len(names):
        raise InvalidRequestError("Batch rename selects the same address more than once; use one canonical address per target")
    labels = set()
    for _, address, name in names:
        _segment(document, address)
        if not name:
            continue
        if name in labels:
            raise InvalidRequestError("Batch rename assigns the same name more than once: %s" % name)
        labels.add(name)
        owner = document.getAddressForName(name)
        if owner not in BAD_ADDRESSES and owner != address and owner not in targets:
            raise InvalidRequestError("Name %s is already assigned to %s; include that address in the batch with a replacement name" % (name, _hex(owner)))


def _symbol_name(value, field):
    """Reject native label truncation without altering the caller's name."""
    value = _api_text(value, field)
    if len(value.encode("utf-16-le")) // 2 > HOPPER_SYMBOL_NAME_UTF16_UNITS:
        raise InvalidRequestError("%s exceeds Hopper's %s UTF-16 code-unit symbol-name limit" % (field, HOPPER_SYMBOL_NAME_UTF16_UNITS))
    return value


def _name_matches(document, address, name):
    observed = _segment(document, address).getNameAtAddress(address)
    return observed == name or (not name and observed is None)


def _bookmark_api(document, name):
    method = getattr(document, name, None)
    if not callable(method):
        raise CapabilityUnavailableError(
            "Hopper's public Python API does not expose %s" % name
        )
    return method


def _bookmark_name(document, address):
    return _bookmark_api(document, "getBookmarkName")(address)


def _address_selection(document, value=None):
    """Own the coordinate and whether it was selected by symbol or address."""
    if value is None:
        return document.getCurrentAddress(), "cursor"
    _api_text(value, "Address")
    if value.startswith("file-offset:"):
        raise InvalidRequestError("Hopper does not support file-offset: selectors; select Ghidra for source-file coordinates or use a Hopper analysis address")
    source = "address"
    if value.lower().startswith("0x"):
        try:
            address = int(value, 16)
        except ValueError as error:
            raise InvalidRequestError("Invalid hexadecimal Hopper address: %s" % value) from error
    else:
        # Names such as `add` and `face` are valid hexadecimal strings too.
        # Prefer an observed symbol, retaining bare-hex compatibility only
        # when Hopper has no symbol with the supplied name.
        address = document.getAddressForName(value)
        if address not in BAD_ADDRESSES:
            source = "symbol"
        if address in BAD_ADDRESSES:
            try:
                address = int(value, 16)
            except ValueError as error:
                raise InvalidRequestError("Unknown Hopper address or name: %s" % value) from error
    if not 0 <= address < 0xFFFFFFFFFFFFFFFF:
        raise InvalidRequestError("Address is outside Hopper's usable unsigned 64-bit range: %s" % value)
    return address, source


def _address(document, value=None):
    return _address_selection(document, value)[0]


def _segment(document, address):
    result = document.getSegmentAtAddress(address)
    if result is None:
        raise InvalidRequestError("Address is outside every segment")
    return result


def _procedure(document, value=None):
    address, source = _address_selection(document, value)
    result = _segment(document, address).getProcedureAtAddress(address)
    if result is None:
        raise InvalidRequestError("No procedure exists at the requested address")
    if source == "symbol" and address != result.getEntryPoint():
        raise InvalidRequestError(
            "Symbol %s at %s is inside procedure %s at %s; select its entry name/address or use resolve_containing_procedure for explicit containment"
            % (value, _hex(address), _procedure_name(result), _hex(result.getEntryPoint()))
        )
    return result


def _procedure_name(procedure):
    entry = procedure.getEntryPoint()
    return procedure.getSegment().getNameAtAddress(entry) or _hex(entry)


def _procedure_identity(procedure):
    return {
        "address": _hex(procedure.getEntryPoint()),
        "name": _procedure_name(procedure),
        "symbol": None,
        "classification": None,
        "body": {
            "available": False,
            "reason": "Hopper's public Python API does not expose complete function body ranges",
        },
    }


def _procedure_locals(procedure):
    """Preserve public local-variable names and observed stack displacements."""
    result = []
    for local in procedure.getLocalVariableList():
        name = local.name()
        displacement = local.displacement()
        result.append({
            "description": "%s (stack displacement %s)" % (name if name is not None else "Unnamed local", displacement),
            "name": name,
            "stack_displacement": str(displacement) if displacement is not None else None,
            "provenance": "hopper-public-python-api",
        })
    return result


def _containing_procedure(document, address):
    segment = document.getSegmentAtAddress(address)
    if segment is None:
        return None, "outside_segments"
    procedure = segment.getProcedureAtAddress(address)
    return (procedure, None) if procedure is not None else (None, "not_in_procedure")


def _basic_block_end(procedure, block):
    """Normalize native block endpoints to an exclusive byte address."""
    owner_at = getattr(procedure, "getBasicBlockAtAddress", None)
    if not callable(owner_at):
        raise CapabilityUnavailableError(
            "Instruction enumeration requires Hopper basic-block ownership"
        )
    end = block.getEndingAddress()
    # Hopper 6.1 returns the final instruction address, despite the Python
    # documentation describing an exclusive end. Membership distinguishes
    # that representation from an actual exclusive endpoint in other builds.
    if owner_at(end) == block:
        instruction = procedure.getSegment().getInstructionAtAddress(end)
        if instruction is not None and instruction.getInstructionLength() > 0:
            return end + instruction.getInstructionLength()
    return end


def _block_instruction_addresses(procedure, block):
    """Walk either endpoint convention using Hopper's block ownership API.

    Some Hopper builds return the final instruction start, despite the public
    API documenting an exclusive end. Equality compares fresh native wrappers;
    probing ownership also keeps an exclusive endpoint in the next block out.
    """
    segment = procedure.getSegment()
    address = block.getStartingAddress()
    end = _basic_block_end(procedure, block)
    while address < end:
        if procedure.getBasicBlockAtAddress(address) != block:
            break
        instruction = segment.getInstructionAtAddress(address)
        if instruction is None:
            break
        length = instruction.getInstructionLength()
        if length <= 0 or address + length > end:
            break
        yield address
        address += length


def _instruction_addresses(procedure):
    result = []
    seen = set()
    for block in procedure.basicBlockIterator():
        for address in _block_instruction_addresses(procedure, block):
            if address in seen:
                continue
            seen.add(address)
            result.append(address)
    return result


def _iter_native_calls(procedure, direction):
    references = procedure.getAllCallees() if direction == "outgoing" else procedure.getAllCallers()
    kinds = {0: "none", 1: "unknown", 2: "direct", 3: "objective_c"}
    for reference in references:
        source, target, kind = reference.fromAddress(), reference.toAddress(), reference.type()
        if source in BAD_ADDRESSES:
            yield None, None, None
            continue
        if target in BAD_ADDRESSES:
            yield source, None, {"address": _hex(source), "reason": "Native CallReference has no resolved target (type %s)" % kind}
            continue
        yield source, target, {"classification": kinds.get(kind, "unknown"), "provider_type": kind, "provenance": "hopper-public-python-api:CallReference"}


def _native_calls(procedure, direction):
    calls = {}
    unresolved = []
    for source, target, detail in _iter_native_calls(procedure, direction):
        if detail is None:
            continue
        if target is None:
            unresolved.append(detail)
        else:
            calls[(source, target)] = detail
    return calls, sorted(unresolved, key=lambda item: int(item["address"], 16))


def _procedure_references(document, params):
    procedure = _procedure(document, params.get("procedure"))
    direction = params.get("direction", "outgoing")
    if direction not in ("incoming", "outgoing"):
        raise InvalidRequestError("direction must be incoming or outgoing")
    addresses = _instruction_addresses(procedure)
    edges = set()
    for address in addresses:
        segment = _segment(document, address)
        references = segment.getReferencesFromAddress(address) if direction == "outgoing" else segment.getReferencesOfAddress(address)
        for reference in references:
            edges.add((address, reference) if direction == "outgoing" else (reference, address))
    calls, unresolved = _native_calls(procedure, direction)
    edges.update(calls)
    ordered = sorted(edges)
    items = []
    for source, target in ordered:
        source_procedure, _ = _containing_procedure(document, source)
        target_procedure, _ = _containing_procedure(document, target)
        items.append({
            "source_address": _hex(source),
            "target_address": _hex(target),
            "source_procedure": _procedure_identity(source_procedure) if source_procedure is not None else None,
            "target_procedure": _procedure_identity(target_procedure) if target_procedure is not None else None,
            "kind": _unavailable("Hopper exposes partial CallReference classification, but not detailed reference flags"),
            **({"call": calls[(source, target)]} if (source, target) in calls else {}),
        })
    return {
        "procedure": _procedure_identity(procedure), "direction": direction,
        "reference_kinds_available": False,
        # These are native CallReference objects, not proof that every unresolved
        # dispatch site has been enumerated by Hopper.
        "unresolved_calls": unresolved,
        "references": items,
    }


def _procedure_map(document):
    result = {}
    for segment in document.getSegmentsList():
        for index in range(segment.getProcedureCount()):
            procedure = segment.getProcedureAtIndex(index)
            result[_hex(procedure.getEntryPoint())] = _procedure_name(procedure)
    return result


def _caller_target_data(procedure):
    addresses = []
    seen = set()
    size = 0
    for block in procedure.basicBlockIterator():
        for address in _block_instruction_addresses(procedure, block):
            if address in seen:
                continue
            encoded = _hex(address)
            size += len(encoded) + 4
            if size > CALLER_SCAN_ALLOWANCE_BYTES:
                return {"target": _procedure_identity(procedure), "instructions": addresses, "instructions_complete": False}
            addresses.append(encoded)
            seen.add(address)
    return {"target": _procedure_identity(procedure), "instructions": addresses, "instructions_complete": True}


def _caller_scan_target(document, params):
    return _caller_target_data(_procedure(document, params.get("procedure")))


def _caller_base(document, params):
    procedure = _procedure(document, params.get("procedure"))
    callers = []
    size = 0
    complete = True
    for item in procedure.getAllCallerProcedures():
        address = _hex(item.getEntryPoint())
        size += len(address) + 4
        if size > CALLER_SCAN_ALLOWANCE_BYTES:
            complete = False
            break
        callers.append(address)
    return {
        **_caller_target_data(procedure),
        "callers": sorted(callers, key=lambda value: int(value, 16)),
        "callers_complete": complete,
    }


def _caller_scan_page(document, params):
    """Observe forward relationships in one bounded, stateless bridge request."""
    start = params.get("start")
    if isinstance(start, bool) or not isinstance(start, int) or start < 0:
        raise InvalidRequestError("Caller scan start must be a non-negative integer")
    segments = document.getSegmentsList()
    counts = [segment.getProcedureCount() for segment in segments]
    total = sum(counts)
    end = min(start + 64, total)
    if start > total:
        raise InvalidRequestError("Caller scan start exceeds the procedure inventory")
    items = []
    item_bytes = 0
    page_limit = CALLER_SCAN_ALLOWANCE_BYTES
    oversized = False
    identities = {}
    containing = {}

    def identity(procedure):
        entry = procedure.getEntryPoint()
        if entry not in identities:
            identities[entry] = _procedure_identity(procedure)
        return identities[entry]

    def owner(address):
        if address not in containing:
            procedure, _ = _containing_procedure(document, address)
            containing[address] = identity(procedure) if procedure is not None else None
        return containing[address]

    segment_start = 0
    for segment, count in zip(segments, counts):
        begin, stop = max(start - segment_start, 0), min(end - segment_start, count)
        segment_start += count
        for index in range(begin, max(begin, stop)):
            candidate = segment.getProcedureAtIndex(index)
            item = {"caller": identity(candidate), "callees": [], "references": []}
            size = len(json.dumps(item, ensure_ascii=True).encode("utf-8")) + 1
            remaining = page_limit - item_bytes
            too_large = size > remaining
            if not too_large:
                for callee in candidate.getAllCalleeProcedures():
                    address = _hex(callee.getEntryPoint())
                    size += len(address) + 4
                    if size > remaining:
                        too_large = True
                        break
                    item["callees"].append(address)
            if not too_large:
                callee_entries = set(item["callees"])
                for source, destination, call in _iter_native_calls(candidate, "outgoing"):
                    # Account for every native record, even when its target cannot
                    # be associated with an observed procedure.
                    size += 32
                    if size > remaining:
                        too_large = True
                        break
                    if destination is None:
                        continue
                    source_procedure = item["caller"] if _hex(source) == item["caller"]["address"] else owner(source)
                    target_address = _hex(destination)
                    if target_address in callee_entries:
                        target_entry = target_address
                    else:
                        target_procedure = owner(destination)
                        if target_procedure is None:
                            continue
                        target_entry = target_procedure["address"]
                    edge = {
                        "source_address": _hex(source), "target_address": _hex(destination),
                        "source_procedure": "caller" if source_procedure is not None and source_procedure["address"] == item["caller"]["address"] else source_procedure,
                        "target_procedure": target_entry,
                        "call": call,
                    }
                    size += len(json.dumps(edge, ensure_ascii=True).encode("utf-8")) + 1
                    if size > remaining:
                        too_large = True
                        break
                    item["references"].append(edge)
            if too_large:
                oversized = not items
                break
            items.append(item)
            item_bytes += size
        else:
            continue
        break
    return {"start": start, "next": start + len(items), "total": total, "items": items, "oversized": oversized}


def _string_record(segment, address, display):
    """Read one native typed object, retaining its shortened display separately."""
    length = segment.getObjectLength(address)
    end = segment.getStartingAddress() + segment.getLength()
    if isinstance(length, bool) or not isinstance(length, int) or length <= 0 or length > end - address:
        raise CapabilityUnavailableError("Hopper reported an invalid string object extent at %s" % _hex(address))
    raw = segment.readBytes(address, length)
    if not isinstance(raw, (bytes, bytearray)) or len(raw) != length:
        raise CapabilityUnavailableError("Hopper could not read the complete string object at %s" % _hex(address))
    kind = segment.getTypeAtAddress(address)
    encodings = ("utf-8", "latin-1") if kind == segment.TYPE_ASCII else ("utf-16-le", "utf-16-be") if kind == segment.TYPE_UNICODE else ()
    # Native display escaping is not invertible (a literal backslash-n and a
    # newline can render alike). Decode byte strings directly; for UTF-16,
    # compare rendered candidates to establish an unambiguous byte order.
    candidates = []
    for encoding in encodings:
        terminator = b"\x00\x00" if encoding.startswith("utf-16") else b"\x00"
        terminated = raw.endswith(terminator)
        payload = raw[:-len(terminator)] if terminated else raw
        try:
            value = payload.decode(encoding)
        except UnicodeDecodeError:
            continue
        record = {"value": value, "provider_value": display, "string": {"encoding": encoding, "encoding_status": "inferred", "termination": "present_or_not_required" if terminated else "missing", "byte_length": length}}
        if kind == segment.TYPE_ASCII:
            return record
        rendered = value.replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
        if rendered == display or (display.endswith("\u2026") and display[:-1] and rendered.startswith(display[:-1])):
            candidates.append(record)
    if candidates and len({candidate["value"] for candidate in candidates}) == 1:
        return candidates[0]
    raise CapabilityUnavailableError("Hopper's string display cannot be reconciled with its typed bytes at %s; inspect the bytes and encoding explicitly" % _hex(address))


def _string_inventory(document, addresses=None):
    key = (id(document), "string_objects")
    objects = _search_inventory_cache.get(key)
    if objects is None:
        objects = {address: (segment, display) for segment in document.getSegmentsList() for display, address in segment.getStringsList()}
        _search_inventory_cache[key] = objects
    key = (id(document), "string_records")
    records = _search_inventory_cache.setdefault(key, {})
    selected = sorted(objects if addresses is None else objects.keys() & addresses)
    for address in selected:
        name = _hex(address)
        if name not in records:
            segment, display = objects[address]
            try:
                records[name] = _string_record(segment, address, display)
            except CapabilityUnavailableError as error:
                records[name] = {"value": display, "provider_value": display, "decoding": _unavailable(str(error))}
    return {_hex(address): records[_hex(address)] for address in selected}


def _invalidate_search_inventory(document):
    """Discard derived names after analysis metadata changes."""
    document_id = id(document)
    for key in list(_search_inventory_cache):
        if key[0] == document_id:
            del _search_inventory_cache[key]


def _invalidate_pseudocode(document):
    """Discard cached decompilation after an analysis annotation changes."""
    document_id = id(document)
    for key in list(_pseudocode_cache):
        if key[0] == document_id:
            del _pseudocode_cache[key]


def _pseudocode(document, procedure):
    """Reuse one provider decompilation for repeated bounded projections."""
    key = (id(document), procedure.getEntryPoint())
    if key not in _pseudocode_cache:
        _pseudocode_cache[key] = procedure.decompile()
    return _pseudocode_cache[key]


def _search_inventory(document, kind):
    """Cache an immutable, address-sorted inventory for an unchanged document."""
    key = (id(document), kind)
    inventory = _search_inventory_cache.get(key)
    if inventory is None:
        if kind == "procedure":
            values = _procedure_map(document)
        elif kind == "string":
            values = _string_inventory(document)
        elif kind == "name":
            values = {_hex(address): value for address, value in _name_map(document).items()}
        else:
            raise ValueError("Unknown inventory kind")
        inventory = tuple(sorted(values.items(), key=lambda item: int(item[0], 16)))
        _search_inventory_cache[key] = inventory
    return inventory


def _search_results(document, kind, params):
    pattern = params.get("pattern")
    if not isinstance(pattern, str) or not pattern:
        raise InvalidRequestError("pattern must be a non-empty string")
    mode = params.get("mode", "literal")
    if mode not in ("literal", "regex"):
        raise InvalidRequestError("mode must be literal or regex")
    case_sensitive = params.get("case_sensitive", False)
    if not isinstance(case_sensitive, bool):
        raise InvalidRequestError("case_sensitive must be a boolean")

    if mode == "literal":
        needle = pattern if case_sensitive else pattern.casefold()
        matches = lambda value: needle in (value if case_sensitive else value.casefold())
    else:
        raise CapabilityUnavailableError("Regex matching requires REA's supervised worker; the native bridge only executes literal searches")

    if kind == "string":
        return [
            {"address": address, **record}
            for address, record in _search_inventory(document, kind)
            if matches(record["value"])
        ]
    return [
        {"address": address, "value": value}
        for address, value in _search_inventory(document, kind)
        if matches(value)
    ]


def _unavailable(reason):
    """Describe evidence the public Hopper API cannot truthfully provide."""
    return {"available": False, "reason": reason}


def _name_map(document):
    result = {}
    for segment in document.getSegmentsList():
        for address in segment.getNamedAddresses():
            name = segment.getNameAtAddress(address)
            if name is not None:
                result[address] = name
    return result


def _render_instruction(segment, address):
    instruction = segment.getInstructionAtAddress(address)
    if instruction is None:
        return None
    arguments = [
        instruction.getFormattedArgument(index)
        for index in range(instruction.getArgumentCount())
    ]
    suffix = ", ".join(value for value in arguments if value is not None)
    return "%s: %s%s" % (
        _hex(address),
        instruction.getInstructionString(),
        (" " + suffix) if suffix else "",
    )


def _assembly(procedure):
    """Render assembly while guarding against malformed instruction cycles."""
    segment = procedure.getSegment()
    return "\n".join(
        line for address in _instruction_addresses(procedure)
        if (line := _render_instruction(segment, address)) is not None
    )


def _read_function_instructions(document, params):
    """Read all raw instructions without invoking decompilation."""
    procedure = _procedure(document, params.get("procedure"))
    addresses = _instruction_addresses(procedure)
    segment = procedure.getSegment()
    items = []
    for address in addresses:
        line = _render_instruction(segment, address)
        if line is not None:
            items.append(line)
    return {
        "procedure": _procedure_identity(procedure),
        "instructions": items,
        "limitations": [
            "Instruction text and ordering are Hopper-specific representations.",
            "The fast path does not decompile the procedure or scan whole-program names and strings.",
        ],
    }


def _analyze_function(document, params):
    """Collect the complete function dossier for agent callers."""
    procedure = _procedure(document, params.get("procedure"))
    addresses = _instruction_addresses(procedure)
    blocks = []
    all_blocks = list(procedure.basicBlockIterator())
    for block in all_blocks:
        successors = []
        for index in range(block.getSuccessorCount()):
            successor = block.getSuccessorAddressAtIndex(index)
            if successor not in BAD_ADDRESSES:
                successors.append(_hex(successor))
        blocks.append({
            "start": _hex(block.getStartingAddress()),
            "end": _hex(_basic_block_end(procedure, block)),
            "successors": sorted(set(successors), key=lambda value: int(value, 16)),
        })
    pseudo = _pseudocode(document, procedure)
    assembly_lines = _assembly(procedure).splitlines()
    callers = sorted((_procedure_identity(item) for item in procedure.getAllCallerProcedures()), key=lambda item: int(item["address"], 16))
    callees = sorted((_procedure_identity(item) for item in procedure.getAllCalleeProcedures()), key=lambda item: int(item["address"], 16))
    comments = []
    edges = set()
    for address in addresses:
        segment = _segment(document, address)
        comment = segment.getCommentAtAddress(address)
        inline_comment = segment.getInlineCommentAtAddress(address)
        if comment:
            comments.append({"address": _hex(address), "kind": "comment", "text": comment})
        if inline_comment:
            comments.append({"address": _hex(address), "kind": "inline", "text": inline_comment})
        for target in segment.getReferencesFromAddress(address):
            edges.add((address, target))
        for source in segment.getReferencesOfAddress(address):
            edges.add((source, address))
    incoming = []
    outgoing = []
    procedure_addresses = set(addresses)
    outgoing_calls, unresolved_calls = _native_calls(procedure, "outgoing")
    incoming_calls, _ = _native_calls(procedure, "incoming")
    calls = {**incoming_calls, **outgoing_calls}
    edges.update(calls)
    for source, target in sorted(edges):
        source_procedure, _ = _containing_procedure(document, source)
        target_procedure, _ = _containing_procedure(document, target)
        item = {
            "source_address": _hex(source),
            "target_address": _hex(target),
            "source_procedure": _procedure_identity(source_procedure) if source_procedure is not None else None,
            "target_procedure": _procedure_identity(target_procedure) if target_procedure is not None else None,
            "kind": _unavailable("Hopper exposes partial CallReference classification, but not detailed reference flags"),
            **({"call": calls[(source, target)]} if (source, target) in calls else {}),
        }
        if target in procedure_addresses and source not in procedure_addresses:
            incoming.append(item)
        if source in procedure_addresses:
            outgoing.append(item)
    string_map = {int(address, 16): record for address, record in _string_inventory(document, {int(edge["target_address"], 16) for edge in outgoing}).items()}
    name_map = {
        int(address, 16): value
        for address, value in _search_inventory(document, "name")
    }
    referenced_strings = []
    referenced_names = []
    for edge in outgoing:
        target = int(edge["target_address"], 16)
        if target in string_map:
            referenced_strings.append({"address": edge["target_address"], **string_map[target], "source_address": edge["source_address"]})
        if target in name_map:
            referenced_names.append({"address": edge["target_address"], "value": name_map[target], "source_address": edge["source_address"]})
    comments.sort(key=lambda item: (int(item["address"], 16), item["kind"]))
    referenced_strings.sort(key=lambda item: (int(item["address"], 16), int(item["source_address"], 16)))
    referenced_names.sort(key=lambda item: (int(item["address"], 16), int(item["source_address"], 16)))
    return {
        "procedure": {
            **_procedure_identity(procedure),
            "signature": procedure.signatureString(),
            "locals": _procedure_locals(procedure),
        },
        "pseudocode": pseudo or "",
        "assembly": assembly_lines,
        "comments": comments,
        "callers": callers, "callees": callees,
        "incoming_references": incoming,
        "outgoing_references": outgoing,
        "unresolved_calls": unresolved_calls,
        "referenced_strings": referenced_strings,
        "referenced_names": referenced_names,
        "basic_blocks": blocks,
        "native_api": None,
        "native_value_flow": None,
        "facet_availability": {
            "pseudocode": {"available": True} if pseudo is not None else _unavailable("Hopper did not supply pseudocode."),
            **{facet: {"available": True} for facet in (
                "assembly", "comments", "callers", "callees", "references", "strings_names", "cfg"
            )},
        },
        "limitations": [
            "Native CallReference classifications are observed where available; detailed reference flags remain unknown.",
            "Hopper's public Python API does not expose equivalent external or thunk classification in this dossier.",
            "Native calls without resolved target addresses are not represented as edges; enumeration beyond reported CallReference objects is unknown.",
            "Pseudocode and assembly are provider-specific representations, not original source.",
        ],
    }


def _dispatch(method, params):
    """Dispatch only the closed operation set implemented by REA's public tools."""
    if method == "health":
        return {
            "name": "REA Hopper bridge",
            "version": "1.0.0",
            "run_id": REA_RUN_ID,
            "process_id": os.getpid(),
            "max_request_bytes": MAX_REQUEST_BYTES,
        }
    if method in ("shutdown", "shutdown_document"):
        document = _session_document()
        if document is None:
            return {"shutdown": True, "analysis_stopped": True, "document_closed": True}
        if method == "shutdown" and not REA_OWNS_PROCESS_LIFETIME:
            return {
                "shutdown": True,
                "analysis_stopped": not document.backgroundProcessActive(),
                "document_closed": False,
                "document_retained": True,
            }
        if document.backgroundProcessActive():
            document.requestBackgroundProcessStop()
        if method == "shutdown" and REA_OWNS_PROCESS_LIFETIME:
            return {
                "shutdown": True,
                "analysis_stopped": not document.backgroundProcessActive(),
                "document_closed": False,
                "cleanup_required": True,
            }
        if document.backgroundProcessActive():
            document.waitForBackgroundProcessToEnd()
        document.closeDocument()
        analysis_stopped = not document.backgroundProcessActive()
        document_closed = _session_document() is None
        return {
            "shutdown": True,
            "analysis_stopped": analysis_stopped,
            "document_closed": document_closed,
        }
    if method == "list_documents":
        return [document.getDocumentName() for document in _api().documents()]
    if method == "current_document":
        return _document().getDocumentName()
    document = _document(params.get("document"))
    if method in EXHAUSTIVE_ANALYSIS_METHODS:
        _api().require_analysis_complete(document, method)

    if method == "rea_caller_scan_target":
        return _caller_scan_target(document, params)

    if method == "rea_caller_base":
        return _caller_base(document, params)

    if method == "rea_caller_scan_page":
        return _caller_scan_page(document, params)

    if method == "analyze_function":
        return _analyze_function(document, params)
    if method == "read_function_instructions":
        return _read_function_instructions(document, params)
    if method == "read_bytes":
        length = params.get("length", 256)
        if isinstance(length, bool) or not isinstance(length, int):
            raise InvalidRequestError("Byte-read length must be an integer")
        if length < 1:
            raise InvalidRequestError("Byte-read length must be at least 1")
        reader = getattr(document, "readBytes", None)
        if not callable(reader):
            raise CapabilityUnavailableError(
                "Hopper's public Python API does not expose readBytes"
            )
        address = _address(document, params.get("address"))
        segment = _segment(document, address)
        # Document.readBytes delegates to one Segment and returns False when
        # the requested range crosses its end. Preserve the readable prefix.
        available = segment.getStartingAddress() + segment.getLength() - address
        value = reader(address, min(length, available))
        if value is False or value is None:
            raise InvalidRequestError("Hopper could not read the requested byte range at %s" % _hex(address))
        if not isinstance(value, (bytes, bytearray)):
            raise CapabilityUnavailableError(
                "Hopper readBytes returned %s for the requested %s-byte range at %s"
                % (type(value).__name__, length, _hex(address))
            )
        data = bytes(value)
        return {
            "address": _hex(address),
            "requested_bytes": length,
            "returned_bytes": len(data),
            "bytes_hex": data.hex(),
            "complete": len(data) == length,
        }
    if method == "address_to_file_offset":
        mapper = getattr(document, "getFileOffsetFromAddress", None)
        if not callable(mapper):
            raise CapabilityUnavailableError(
                "Hopper's public Python API does not expose getFileOffsetFromAddress"
            )
        address = _address(document, params.get("address"))
        offset = mapper(address)
        if (
            isinstance(offset, bool)
            or not isinstance(offset, int)
            or offset in BAD_ADDRESSES
            or offset < 0
        ):
            raise InvalidRequestError("Address has no authoritative file-offset mapping")
        inverse = getattr(document, "getAddressFromFileOffset", None)
        if not callable(inverse):
            raise CapabilityUnavailableError(
                "Hopper's public Python API cannot verify the file-offset mapping by reverse lookup"
            )
        # Synthetic memory can report offset zero, which belongs to the actual
        # file header. An integer alone does not prove source-file provenance.
        if inverse(offset) != address:
            raise InvalidRequestError("Address has no authoritative file-offset mapping: reverse lookup disagrees at %s" % _hex(address))
        if offset > 9007199254740991:
            raise CapabilityUnavailableError("Provider file offset exceeds the exact JSON integer range")
        header_address = inverse(0)
        reader = getattr(document, "readBytes", None)
        header = reader(header_address, 12) if header_address not in BAD_ADDRESSES and document.getSegmentAtAddress(header_address) is not None and callable(reader) else None
        return {
            "address": _hex(address),
            "provider_file_offset": offset,
            "provider_source_path": document.getExecutableFilePath(),
            "provider_image_header_hex": bytes(header).hex() if isinstance(header, (bytes, bytearray)) and len(header) == 12 else None,
        }
    if method == "resolve_containing_procedure":
        address = _address(document, params.get("address"))
        procedure, reason = _containing_procedure(document, address)
        if procedure is None:
            return {"query_address": _hex(address), "found": False, "procedure": None, "reason": reason}
        return {"query_address": _hex(address), "found": True, "procedure": _procedure_identity(procedure)}
    if method == "procedure_references":
        return _procedure_references(document, params)

    if method == "current_address":
        return _hex(document.getCurrentAddress())
    if method == "current_procedure":
        return _procedure_name(_procedure(document))
    if method == "goto_address":
        address = _address(document, params.get("address"))
        segment = _segment(document, address)
        expected = segment.getInstructionStart(address)
        document.moveCursorAtAddress(address)
        observed = document.getCurrentAddress()
        if observed != (address if expected in BAD_ADDRESSES else expected):
            raise InvalidRequestError("Hopper cursor did not reach the requested object at %s; observed %s" % (_hex(address), _hex(observed)))
        return _hex(observed)
    if method in ("address_name", "comment", "inline_comment", "xrefs"):
        target = _address(document, params.get("address"))
        segment = _segment(document, target)
        if method == "address_name":
            return segment.getNameAtAddress(target)
        if method == "comment":
            return segment.getCommentAtAddress(target)
        if method == "inline_comment":
            return segment.getInlineCommentAtAddress(target)
        return [_hex(value) for value in segment.getReferencesOfAddress(target)]
    if method in ("next_address", "prev_address"):
        target = _address(document, params.get("address"))
        segment = _segment(document, target)
        if method == "next_address":
            start = segment.getInstructionStart(target)
            if start in BAD_ADDRESSES:
                raise InvalidRequestError("No analyzed object exists at the requested address")
            length = segment.getObjectLength(start)
            if length in BAD_ADDRESSES or length <= 0:
                raise InvalidRequestError("No next analyzed object exists at the requested address")
            result = start + length
        else:
            previous_segment = document.getSegmentAtAddress(target - 1) if target > 0 else None
            if previous_segment is None:
                raise InvalidRequestError("No previous address exists in mapped memory")
            result = previous_segment.getInstructionStart(target - 1)
        if result in BAD_ADDRESSES or document.getSegmentAtAddress(result) is None:
            raise InvalidRequestError("No adjacent analyzed object exists in mapped memory")
        return _hex(result)
    if method == "list_segments":
        result = []
        permission_limitation = _unavailable(
            "Hopper's public Python API does not expose segment or section permissions"
        )
        for segment in document.getSegmentsList():
            start = segment.getStartingAddress()
            sections = [{
                "name": section.getName(),
                "start": _hex(section.getStartingAddress()),
                "end": _hex(section.getStartingAddress() + section.getLength()),
                "readable": None,
                "writable": None,
                "executable": None,
                "permissions": permission_limitation,
                "provenance": "hopper-public-python-api",
            } for section in segment.getSectionsList()]
            result.append({
                "name": segment.getName(),
                "start": _hex(start),
                "end": _hex(start + segment.getLength()),
                "readable": None,
                "writable": None,
                "executable": None,
                "permissions": permission_limitation,
                "provenance": "hopper-public-python-api",
                "sections": sections,
            })
        return result
    if method == "list_procedures":
        return [{"address": address, "value": value} for address, value in _search_inventory(document, "procedure")]
    if method == "list_strings":
        requested = params.get("address")
        values = _string_inventory(document, None if requested is None else {_address(document, requested)})
        return [{"address": address, **record} for address, record in values.items()]
    if method == "list_names":
        result = dict(_search_inventory(document, "name"))
        requested = params.get("address")
        if requested is not None:
            key = _hex(_address(document, requested))
            result = {key: result[key]} if key in result else {}
        return [{"address": address, "value": value} for address, value in result.items()]
    if method in ("search_procedures", "search_strings"):
        kind = "procedure" if method == "search_procedures" else "string"
        return _search_results(document, kind, params)
    if method.startswith("procedure_"):
        procedure = _procedure(document, params.get("procedure"))
        if method == "procedure_address":
            return _hex(procedure.getEntryPoint())
        if method == "procedure_assembly":
            return _assembly(procedure)
        if method == "procedure_pseudo_code":
            return _pseudocode(document, procedure)
        if method == "procedure_callers":
            return sorted((_hex(item.getEntryPoint()) for item in procedure.getAllCallerProcedures()), key=lambda value: int(value, 16))
        if method == "procedure_callees":
            return sorted((_hex(item.getEntryPoint()) for item in procedure.getAllCalleeProcedures()), key=lambda value: int(value, 16))
        if method == "procedure_info":
            blocks = list(procedure.basicBlockIterator())
            length = sum(max(0, _basic_block_end(procedure, block) - block.getStartingAddress()) for block in blocks)
            return {
                "name": _procedure_name(procedure),
                "symbol": None,
                "entrypoint": _hex(procedure.getEntryPoint()),
                "basicblock_count": procedure.getBasicBlockCount(),
                "length": length,
                "signature": procedure.signatureString(),
                "locals": _procedure_locals(procedure),
                "classification": None,
                "body": _procedure_identity(procedure)["body"],
            }
    if method == "set_address_name":
        address = _address(document, params.get("address"))
        name = _symbol_name(params["name"], "Name")
        _validate_name_targets(document, [(params.get("address"), address, name)])
        try:
            result = document.setNameAtAddress(address, name)
        finally:
            _invalidate_search_inventory(document)
            _invalidate_pseudocode(document)
        return bool(result) and _name_matches(document, address, name)
    if method == "set_addresses_names":
        # Validate all destinations before applying any annotation. A malformed
        # later address must not discard the result of an earlier mutation.
        names = [(key, _address(document, key), _symbol_name(value, "Name for %s" % key)) for key, value in params["names"].items()]
        _validate_name_targets(document, names)
        try:
            result = {key: document.setNameAtAddress(address, value) for key, address, value in names}
        finally:
            _invalidate_search_inventory(document)
            _invalidate_pseudocode(document)
        return {key: bool(result[key]) and _name_matches(document, address, value) for key, address, value in names}
    if method in ("set_comment", "set_inline_comment"):
        address = _address(document, params.get("address"))
        comment = _api_text(params["comment"], "Comment")
        segment = _segment(document, address)
        setter = segment.setCommentAtAddress if method == "set_comment" else segment.setInlineCommentAtAddress
        getter = segment.getCommentAtAddress if method == "set_comment" else segment.getInlineCommentAtAddress
        setter(address, comment)
        _invalidate_pseudocode(document)
        observed = getter(address)
        return observed == comment or (comment == "" and observed is None)
    if method == "list_bookmarks":
        return [{"address": _hex(item), "name": _bookmark_name(document, item)} for item in _bookmark_api(document, "getBookmarks")()]
    if method == "set_bookmark":
        address = _address(document, params.get("address"))
        _segment(document, address)
        name = params.get("name")
        if name is not None:
            _api_text(name, "Bookmark name")
        has_bookmark = _bookmark_api(document, "hasBookmarkAtAddress")
        exists = has_bookmark(address)
        if name is None and exists:
            # Omission means preserve the existing bookmark and its name.
            return True
        _bookmark_api(document, "getBookmarkName")
        if name == "" and exists:
            rename = _bookmark_api(document, "renameBookmarkAtAddress")
            rename(address, name)
        else:
            setter = _bookmark_api(document, "setBookmarkAtAddress")
            setter(address, name)
        if not has_bookmark(address):
            return False
        observed = _bookmark_name(document, address)
        if name is None:
            return observed is None or observed == ""
        return observed == name or (name == "" and observed is None)
    if method == "unset_bookmark":
        address = _address(document, params.get("address"))
        # Permit removing a legacy orphan bookmark, but do not report success
        # for an unmapped address with no bookmark to remove.
        has_bookmark = _bookmark_api(document, "hasBookmarkAtAddress")
        remove_bookmark = _bookmark_api(document, "removeBookmarkAtAddress")
        if not has_bookmark(address):
            _segment(document, address)
        remove_bookmark(address)
        return not has_bookmark(address)
    raise InvalidRequestError("Unknown bridge method")


def _serve_connection(connection):
    """Serve one capability-authenticated NDJSON connection."""
    file = connection.makefile("rwb")
    should_stop = False
    try:
        while True:
            # Bound the read itself. The payload budget excludes LF, so permit
            # one additional byte for the delimiter while still refusing an
            # oversized unterminated peer without waiting for EOF.
            line = file.readline(MAX_REQUEST_BYTES + 1)
            if not line:
                break
            if not line.endswith(b"\n"):
                message = (
                    "Bridge request exceeds the %d-byte payload limit. %s"
                    % (MAX_REQUEST_BYTES, _bridge_max_request_bytes_recovery())
                    if len(line) > MAX_REQUEST_BYTES
                    else "Incomplete bridge request frame"
                )
                _write_message(file, {"id": 0, "error": _safe_diagnostic(
                    InvalidRequestError(message)
                )})
                break
            request_id = None
            authenticated = False
            should_stop = False
            try:
                try:
                    request = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise InvalidRequestError("Invalid bridge request JSON") from error
                if not isinstance(request, dict) or set(request) != {"id", "token", "method", "params"}:
                    raise InvalidRequestError("Invalid bridge request shape")
                request_id = request["id"]
                if isinstance(request_id, bool) or not isinstance(request_id, int) or request_id < 0:
                    raise InvalidRequestError("Invalid bridge request id")
                if (
                    not isinstance(request["method"], str) or not request["method"]
                    or not isinstance(request["params"], dict)
                ):
                    raise InvalidRequestError("Invalid bridge method or parameters")
                if (
                    not isinstance(request["token"], str) or not request["token"].isascii()
                    or not hmac.compare_digest(request["token"], REA_TOKEN)
                ):
                    raise PermissionError("Invalid bridge capability")
                authenticated = True
                # The connection grace period only bounds unauthenticated idle
                # clients. Native analysis and a connected owner's idle time
                # remain unbounded after capability validation.
                connection.settimeout(None)
                _write_message(file, {"id": request_id, "event": {
                    "type": "progress",
                    "phase": "hopper_bridge",
                    "completed": 0,
                    "total": 1,
                    "message": "Hopper bridge started request",
                }})
                result = _dispatch(request["method"], request["params"])
                should_stop = request["method"] in ("shutdown", "shutdown_document") and (
                    result.get("shutdown") is True and (
                        (result.get("document_closed") is True and result.get("analysis_stopped") is True)
                        or (result.get("document_closed") is False and result.get("document_retained") is True)
                    )
                )
                safe_result = _json_safe(result)
                _write_message(file, {"id": request_id, "event": {
                    "type": "progress",
                    "phase": "hopper_bridge",
                    "completed": 1,
                    "total": 1,
                    "message": "Hopper bridge completed request",
                    "terminal": True,
                }})
                response = {"id": request_id, "result": safe_result}
            except Exception as error:
                diagnostic = _safe_diagnostic(error)
                if authenticated:
                    _write_message(file, {"id": request_id, "event": {
                        "type": "diagnostic",
                        "error": diagnostic,
                    }})
                response_id = request_id if (
                    isinstance(request_id, int)
                    and not isinstance(request_id, bool)
                    and request_id >= 0
                ) else 0
                response = {"id": response_id, "error": diagnostic}
            _write_message(file, response)
            if should_stop:
                break
    except (ConnectionError, OSError):
        # A lost client cannot confirm document closure or revoke this run.
        pass
    finally:
        try:
            file.close()
        except OSError:
            # Closing a failed writer can repeat the same disconnected-pipe error.
            pass
        connection.close()
    return should_stop


def _write_message(file, message):
    """Write and flush one compact bridge message."""
    file.write((json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8"))
    file.flush()


def _diagnostic_type(error):
    if isinstance(error, CapabilityUnavailableError):
        return "capability_unavailable"
    if isinstance(error, PermissionError):
        return "authorization"
    if isinstance(error, InvalidRequestError):
        return "invalid_request"
    return "bridge_exception"


def _safe_diagnostic(error):
    """Preserve bridge validation reasons while excluding transport credentials."""
    diagnostic_type = _diagnostic_type(error)
    if diagnostic_type == "capability_unavailable":
        message = str(error)
    elif diagnostic_type == "authorization":
        message = "Invalid bridge capability"
    elif diagnostic_type == "invalid_request":
        message = str(error)
    else:
        message = "%s: Hopper bridge operation failed" % type(error).__name__
    return {"code": -32000, "message": message, "type": diagnostic_type}


def _run():
    """Own a permission-restricted, single-client Unix socket for this bridge."""
    if os.path.exists(REA_SOCKET):
        os.unlink(REA_SOCKET)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(REA_SOCKET)
    os.chmod(REA_SOCKET, 0o600)
    server.listen(1)
    # A bridge can start after its caller's startup/cleanup deadline. Bound
    # the first accept as well as reconnects so an orphan cannot pin Hopper's
    # dedicated Python thread and prevent later documents from starting REA.
    server.settimeout(REA_RECONNECT_TIMEOUT_SECONDS)
    try:
        while True:
            try:
                connection, _ = server.accept()
            except socket.timeout:
                break
            connection.settimeout(REA_RECONNECT_TIMEOUT_SECONDS)
            if _serve_connection(connection):
                break
            # Match REA's cleanup handshake budget without pinning Hopper's
            # Python thread indefinitely after a client disappears.
            server.settimeout(REA_RECONNECT_TIMEOUT_SECONDS)
    finally:
        server.close()
        if os.path.exists(REA_SOCKET):
            os.unlink(REA_SOCKET)


# Hopper's public objects are bound to its dedicated Python execution thread.
# Keep dispatch on that thread; moving calls to a worker can deadlock.
if __name__ == "__main__":
    _bind_session_document()
    _run()
