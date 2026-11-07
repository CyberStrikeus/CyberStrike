"""Exercise the Hopper bridge facade without importing Hopper globals."""

import json
from pathlib import Path
import socket
import sys
import threading


class FakeDocument:
    def __init__(self):
        self.analysis_active = True
        self.address_error = None

    def getDocumentName(self):
        return "fixture"

    def getExecutableFilePath(self):
        return "/tmp/rea-hopper-facade-fixture"

    def getDatabaseFilePath(self):
        return None

    def backgroundProcessActive(self):
        return self.analysis_active

    def getCurrentAddress(self):
        if self.address_error is not None:
            raise self.address_error
        return 0x401000

    def getSegmentsList(self):
        return []


class FakeDocumentProvider:
    document = FakeDocument()
    current = FakeDocument()
    documents = [document, current]

    @classmethod
    def getAllDocuments(cls):
        return cls.documents

    @classmethod
    def getCurrentDocument(cls):
        return cls.current


class FakeReferenceSegment:
    def getNameAtAddress(self, address):
        return "fixture-procedure"

    def getReferencesFromAddress(self, address):
        return []

    def getReferencesOfAddress(self, address):
        return []

    def getCommentAtAddress(self, address):
        return None

    def getInlineCommentAtAddress(self, address):
        return None


class FakeProcedure:
    def __init__(self, segment):
        self.segment = segment

    def getEntryPoint(self):
        return 0x401000

    def getSegment(self):
        return self.segment

    def basicBlockIterator(self):
        return [FakeBlock()]

    def getBasicBlockAtAddress(self, address):
        return None

    def getBasicBlockCount(self):
        return 1

    def signatureString(self):
        return "int fixture-procedure()"

    def getLocalVariableList(self):
        return []

    def getAllCallees(self):
        return []

    def getAllCallerProcedures(self):
        return []

    def getAllCalleeProcedures(self):
        return []


class FakeBlock:
    def getStartingAddress(self):
        return 0x401000

    def getEndingAddress(self):
        return 0x401004

    def getSuccessorCount(self):
        return 0
def load_bridge(path, namespace_updates=None):
    namespace = {
        "__file__": path,
        "__name__": "rea_hopper_bridge",
    }
    if namespace_updates:
        namespace.update(namespace_updates)
    source = Path(path).read_text(encoding="utf-8")
    exec(compile(source, path, "exec"), namespace)
    return namespace


def bridge_replies(bridge, requests):
    server_socket, client_socket = socket.socketpair()
    worker = threading.Thread(
        target=bridge["_serve_connection"], args=(server_socket,)
    )
    worker.start()
    replies = []
    client_file = client_socket.makefile("rwb")
    try:
        for request in requests:
            line = request if isinstance(request, bytes) else json.dumps(request).encode("utf-8")
            client_file.write(line + b"\n")
            client_file.flush()
            while True:
                response = json.loads(client_file.readline().decode("utf-8"))
                if "event" not in response:
                    replies.append(response)
                    break
    finally:
        client_file.close()
        client_socket.close()
        worker.join(timeout=1)
    return replies


def request(method, params, request_id=1):
    return {"id": request_id, "token": "probe-token", "method": method, "params": params}


def main():
    bridge = load_bridge(sys.argv[1])
    unavailable = None
    try:
        bridge["_api"]()
    except Exception as error:
        unavailable = {
            "type": type(error).__name__,
            "diagnostic_type": bridge["_diagnostic_type"](error),
        }

    bridge["REA_TARGET_PATH"] = "/tmp/rea-hopper-facade-fixture"
    bridge["REA_OWNS_PROCESS_LIFETIME"] = False
    bridge["_configure_hopper_api"](FakeDocumentProvider)
    bridge["_bind_session_document"]()
    current = bridge["_dispatch"]("current_document", {})
    current_address = bridge["_dispatch"]("current_address", {})
    selected = bridge["_session_document"]() is FakeDocumentProvider.current
    retained = bridge["_dispatch"]("shutdown", {})

    analysis_guard = None
    try:
        bridge["_dispatch"]("list_procedures", {})
    except Exception as error:
        analysis_guard = {
            "type": type(error).__name__,
            "diagnostic_type": bridge["_diagnostic_type"](error),
            "message": str(error),
        }

    bridge["REA_TOKEN"] = "probe-token"
    FakeDocumentProvider.document.analysis_active = False
    FakeDocumentProvider.current.analysis_active = False
    reference_segment = FakeReferenceSegment()
    reference_procedure = FakeProcedure(reference_segment)
    bridge["_procedure"] = lambda document, value=None: reference_procedure
    bridge["_instruction_addresses"] = lambda procedure: [0x401000]
    bridge["_segment"] = lambda document, address: reference_segment
    bridge["_containing_procedure"] = lambda document, address: (
        reference_procedure,
        None,
    )
    containing_procedure = bridge["_dispatch"](
        "resolve_containing_procedure", {"address": "0x401000"}
    )
    procedure_references = bridge["_dispatch"](
        "procedure_references",
        {"procedure": "0x401000", "direction": "outgoing"},
    )
    procedure_info = bridge["_dispatch"](
        "procedure_info", {"procedure": "0x401000"}
    )
    bridge["_assembly"] = lambda procedure: "ret"
    bridge["_pseudocode"] = lambda document, procedure: None
    bridge["_native_calls"] = lambda procedure, direction: ({}, [])
    bridge["_string_inventory"] = lambda document, targets=None: {}
    bridge["_search_inventory"] = lambda document, kind: []
    analyze_function = bridge["_dispatch"](
        "analyze_function", {"procedure": "0x401000"}
    )
    provider_faults = []
    for error_type in (TypeError, ValueError, KeyError):
        FakeDocumentProvider.current.address_error = error_type("credential=supersecret")
        provider_faults.extend(bridge_replies(bridge, [request("current_address", {})]))
    FakeDocumentProvider.current.address_error = None
    malformed_requests = bridge_replies(bridge, [
        b"not-json", b"\xff", None, 42, [],
        request([], {}, 2), request("current_address", [], 3),
        request("current_address", {}, True),
        request("list_strings", {"address": True}, 4),
        request("read_bytes", {"length": True}, 5),
        request("search_strings", {"pattern": "a", "case_sensitive": 1}, 6),
        request("unknown_method", {}, 7),
        {**request("current_address", {}, 8), "token": "\u2603"},
        request("current_address", {}, 9),
    ])
    bridge["_dispatch"] = lambda method, params: (
        (_ for _ in ()).throw(RuntimeError("credential=supersecret"))
        if method == "fail"
        else params
    )
    server_socket, client_socket = socket.socketpair()
    worker = threading.Thread(
        target=bridge["_serve_connection"], args=(server_socket,)
    )
    worker.start()
    client_file = client_socket.makefile("rwb")
    client_file.write(
        b'{"id":7,"token":"probe-token","method":"fail","params":{}}\n'
    )
    client_file.flush()
    bridge_messages = [
        json.loads(client_file.readline().decode("utf-8")) for _ in range(3)
    ]
    client_file.write(
        b'{"id":-1,"token":"probe-token","method":"echo","params":{}}\n'
    )
    client_file.flush()
    invalid_id_response = json.loads(client_file.readline().decode("utf-8"))
    client_file.close()
    client_socket.close()
    worker.join(timeout=1)

    print(
        json.dumps(
            {
                "imported_without_hopper": unavailable,
                "current_document": current,
                "current_address": current_address,
                "containing_procedure": containing_procedure,
                "procedure_references": procedure_references,
                "procedure_info": procedure_info,
                "analyze_function": analyze_function,
                "provider_faults": provider_faults,
                "malformed_requests": malformed_requests,
                "session_document_reused": selected,
                "shared_document_shutdown": retained,
                "analysis_guard": analysis_guard,
                "bridge_messages": bridge_messages,
                "invalid_id_response": invalid_id_response,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
