"""Exercise named-entry and explicit-coordinate selection at the Hopper boundary."""
import json
from pathlib import Path
import sys

bridge_path = sys.argv[1]
bridge = {"__file__": bridge_path, "__name__": "rea_hopper_bridge"}
exec(compile(Path(bridge_path).read_text(encoding="utf-8"), bridge_path, "exec"), bridge)

class Procedure:
    def getEntryPoint(self):
        return 0x401000
    def getSegment(self):
        return segment
class Segment:
    def getNameAtAddress(self, address):
        return "entry" if address == 0x401000 else "inner"
    def getProcedureAtAddress(self, address):
        return procedure
class Document:
    def __init__(self):
        self.names = []
    def getCurrentAddress(self):
        return 0x401004
    def getAddressForName(self, name):
        self.names.append(name)
        return {"entry": 0x401000, "alias_entry": 0x401000, "inner": 0x401004}.get(name)
    def getSegmentAtAddress(self, address):
        return segment
segment = Segment()
procedure = Procedure()
document = Document()
results = {}
for selector in ["entry", "alias_entry", "inner", "0x401004", "401004", "file-offset:0x4"]:
    try:
        selected = bridge["_procedure"](document, selector)
        results[selector] = {"entry": bridge["_hex"](selected.getEntryPoint())}
    except Exception as error:
        results[selector] = {"diagnostic_type": bridge["_diagnostic_type"](error), "message": str(error)}
print(json.dumps({"results": results, "name_lookups": document.names}))
