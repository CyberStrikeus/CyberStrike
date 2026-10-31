"""Exercise the real paging owner using Hopper-shaped native objects."""
import json
from pathlib import Path
import sys

class Procedure:
    def __init__(self, address):
        self.address = address
        self.callees = []
        self.calls = {}
    def getEntryPoint(self):
        return self.address
    def getAllCalleeProcedures(self):
        return self.callees

class Segment:
    def __init__(self, procedures):
        self.procedures = procedures
    def getProcedureCount(self):
        return len(self.procedures)
    def getProcedureAtIndex(self, index):
        return self.procedures[index]

class Document:
    def __init__(self, segments):
        self.segments = segments
    def getSegmentsList(self):
        return self.segments

path = sys.argv[1]
bridge = {"__file__": path, "__name__": "rea_hopper_bridge"}
exec(compile(Path(path).read_text(encoding="utf-8"), path, "exec"), bridge)
target = Procedure(0x2000)
procedures = [Procedure(0x3000 + 0x10 * i) for i in range(130)]
procedures[65].callees = [target]
procedures[65].calls = {(procedures[65].address + 4, target.address): {"classification": "direct", "provider_type": 2, "provenance": "fixture"}}
document = Document([Segment(procedures[:32]), Segment(procedures[32:])])
bridge["_procedure"] = lambda document, value: target
bridge["_instruction_addresses"] = lambda procedure: [procedure.address]
bridge["_procedure_identity"] = lambda procedure: {"address": hex(procedure.address)}
bridge["_iter_native_calls"] = lambda procedure, direction: ((source, destination, call) for (source, destination), call in procedure.calls.items())
bridge["_containing_procedure"] = lambda document, address: (target if address == target.address else procedures[65], None)
read = lambda start: bridge["_caller_scan_page"](document, {"start": start})
first, second, third = read(0), read(64), read(128)
procedures[65].callees = []
procedures[65].calls = {}
changed = read(64)
try:
    read(131)
except bridge["InvalidRequestError"]:
    invalid = True
else:
    invalid = False
original_identity = bridge["_procedure_identity"]
bridge["_procedure_identity"] = lambda procedure: {"address": hex(procedure.address), "name": "x" * 600000}
oversized = read(0)
bridge["_procedure_identity"] = original_identity
target.basicBlockIterator = lambda: [None]
bridge["_block_instruction_addresses"] = lambda procedure, block: range(0x100000000, 0x100010000)
limited_target = bridge["_caller_target_data"](target)
print(json.dumps({
    "first": {"start": first["start"], "next": first["next"], "total": first["total"], "items": len(first["items"])},
    "second": {"start": second["start"], "next": second["next"], "total": second["total"], "items": len(second["items"]), "caller": second["items"][1]},
    "third": {"start": third["start"], "next": third["next"], "total": third["total"], "items": len(third["items"])},
    "changed": changed["items"][1], "invalid": invalid, "oversized": oversized,
    "target_limited": not limited_target["instructions_complete"],
    "target_count": len(limited_target["instructions"]),
}))
