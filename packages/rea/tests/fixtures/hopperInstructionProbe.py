"""Exercise the real bridge instruction walker with Hopper-shaped objects."""

import json
from pathlib import Path
import sys


class Block:
    def __init__(self, key, start, end, members):
        self.key, self.start, self.end, self.members = key, start, end, members

    def __eq__(self, other):
        return isinstance(other, Block) and self.key == other.key

    def __hash__(self):
        return hash(self.key)

    def getStartingAddress(self):
        return self.start

    def getEndingAddress(self):
        return self.end

    def getSuccessorCount(self):
        return 0


class Instruction:
    def __init__(self, mnemonic, length=4):
        self.mnemonic, self.length = mnemonic, length

    def getInstructionLength(self):
        return self.length

    def getInstructionString(self):
        return self.mnemonic

    def getArgumentCount(self):
        return 0


class Segment:
    def __init__(self, instructions):
        self.instructions = instructions

    def getInstructionAtAddress(self, address):
        return self.instructions.get(address)

    def getNameAtAddress(self, address):
        return "fixture"

    def getReferencesFromAddress(self, address):
        return [0x9000] if self.instructions[address].mnemonic.startswith("b") else []

    def getReferencesOfAddress(self, address):
        return []

    def getCommentAtAddress(self, address):
        return None

    def getInlineCommentAtAddress(self, address):
        return None


class Procedure:
    def __init__(self, blocks, segment):
        self.blocks, self.segment = blocks, segment

    def basicBlockIterator(self):
        return iter(self.blocks)

    def getBasicBlockAtAddress(self, address):
        for block in self.blocks:
            if address in block.members:
                # Hopper returns fresh wrappers whose native handles compare equal.
                return Block(block.key, block.start, block.end, block.members)
        return None

    def getBasicBlockCount(self):
        return len(self.blocks)

    def getAllCallees(self):
        return []

    def getAllCallers(self):
        return []

    def getSegment(self):
        return self.segment

    def getEntryPoint(self):
        return self.blocks[0].start

    def signatureString(self):
        return "int fixture()"

    def getLocalVariableList(self):
        return []

    def getAllCallerProcedures(self):
        return []

    def getAllCalleeProcedures(self):
        return []

    def decompile(self):
        return "fixture pseudocode"


def main():
    path = sys.argv[1]
    bridge = {"__file__": path, "__name__": "rea_hopper_bridge"}
    exec(compile(Path(path).read_text(encoding="utf-8"), path, "exec"), bridge)
    scenario = sys.argv[2]
    instructions = {0x1000: Instruction("mov"), 0x1004: Instruction("b.ne"),
                    0x1008: Instruction("ret"), 0x100C: Instruction("nop")}
    if scenario == "inclusive":
        blocks = [Block(0, 0x1000, 0x1004, {0x1000, 0x1004}),
                  Block(1, 0x1008, 0x1008, {0x1008})]
    elif scenario == "exclusive":
        blocks = [Block(0, 0x1000, 0x1008, {0x1000, 0x1004}),
                  Block(1, 0x1008, 0x100C, {0x1008})]
    elif scenario == "duplicate":
        block = Block(0, 0x1000, 0x1008, {0x1000, 0x1004, 0x1008})
        blocks = [block, block]
    elif scenario == "gap":
        instructions.pop(0x1004)
        blocks = [Block(0, 0x1000, 0x1008, {0x1000, 0x1004, 0x1008})]
    elif scenario == "zero_length":
        instructions[0x1004] = Instruction("invalid", 0)
        blocks = [Block(0, 0x1000, 0x1008, {0x1000, 0x1004, 0x1008})]
    elif scenario == "negative_length":
        instructions[0x1004] = Instruction("invalid", -4)
        blocks = [Block(0, 0x1000, 0x1008, {0x1000, 0x1004, 0x1008})]
    elif scenario == "cross_boundary":
        instructions[0x1000] = Instruction("invalid", 8)
        blocks = [Block(0, 0x1000, 0x1004, {0x1000})]
    elif scenario == "foreign_owner":
        blocks = [Block(0, 0x1000, 0x100C, {0x1000, 0x1004})]
    elif scenario == "reversed":
        blocks = [Block(0, 0x1008, 0x1000, {0x1008})]
    elif scenario == "variable_length":
        instructions = {0x1000: Instruction("mov", 3),
                        0x1003: Instruction("b.ne", 2),
                        0x1005: Instruction("ret", 1),
                        0x1006: Instruction("nop", 1)}
        blocks = [Block(0, 0x1000, 0x1003, {0x1000, 0x1003}),
                  Block(1, 0x1005, 0x1005, {0x1005})]
    elif scenario == "no_ownership":
        blocks = [Block(0, 0x1000, 0x1004, {0x1000})]
    else:
        raise ValueError("Unknown scenario")
    segment = Segment(instructions)
    procedure = Procedure(blocks, segment)
    if scenario == "no_ownership":
        procedure.getBasicBlockAtAddress = None
        try:
            bridge["_instruction_addresses"](procedure)
        except bridge["CapabilityUnavailableError"] as error:
            print(json.dumps({"error": str(error)}))
            return
        raise AssertionError("Missing ownership API was silently accepted")
    class API:
        def require_analysis_complete(self, document, method):
            pass

    class Document:
        def getSegmentsList(self):
            return []

    document = Document()
    bridge["_api"] = lambda: API()
    bridge["_document"] = lambda name=None: document
    bridge["_procedure"] = lambda document, value=None: procedure
    bridge["_segment"] = lambda document, address: segment
    bridge["_containing_procedure"] = lambda document, address: (None, None)
    bridge["_search_inventory"] = lambda document, kind: []
    dossier = bridge["_analyze_function"](document, {})
    print(json.dumps({
        "blocks": dossier["basic_blocks"],
        "length": bridge["_dispatch"]("procedure_info", {})["length"],
        "addresses": bridge["_instruction_addresses"](procedure),
        "assembly": bridge["_assembly"](procedure).splitlines(),
        "fast": bridge["_read_function_instructions"](document, {})["instructions"],
        "dossier": dossier["assembly"],
        "references": bridge["_procedure_references"](document, {})["references"],
    }))


if __name__ == "__main__":
    main()
