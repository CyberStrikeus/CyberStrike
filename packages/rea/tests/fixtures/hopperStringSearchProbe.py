"""Exercise bridge string search against a Hopper-shaped multi-segment document."""

import json
from pathlib import Path
import sys


class Segment:
    TYPE_ASCII = 1
    TYPE_UNICODE = 2

    def __init__(self, start, length, strings):
        self.start, self.length = start, length
        self.strings = strings  # address -> (display, raw bytes, type, reported length)

    def getStringsList(self):
        return [(display, address) for address, (display, _, _, _) in self.strings.items()]

    def getStartingAddress(self):
        return self.start

    def getLength(self):
        return self.length

    def getObjectLength(self, address):
        return self.strings[address][3]

    def readBytes(self, address, length):
        return self.strings[address][1][:length]

    def getTypeAtAddress(self, address):
        return self.strings[address][2]


class Document:
    def __init__(self, segments):
        self.segments = segments

    def getSegmentsList(self):
        return self.segments


def ascii_entry(text):
    raw = text.encode() + b"\x00"
    return (text, raw, Segment.TYPE_ASCII, len(raw))


def unicode_entry(text):
    raw = text.encode("utf-16-le") + b"\x00\x00"
    return (text, raw, Segment.TYPE_UNICODE, len(raw))


def main():
    path = sys.argv[1]
    bridge = {"__file__": path, "__name__": "rea_hopper_bridge"}
    exec(compile(Path(path).read_text(encoding="utf-8"), path, "exec"), bridge)

    class API:
        def require_analysis_complete(self, document, method):
            pass

    # Later segment listed first so ascending order must come from the bridge.
    high = Segment(0x3000, 0x100, {
        0x3040: ascii_entry("needle high"),
        0x3000: ascii_entry("Other"),
        0x3020: unicode_entry("Needle wide"),
    })
    low = Segment(0x1000, 0x100, {
        0x1050: ascii_entry("NEEDLE upper"),
        0x1010: ascii_entry("a needle"),
        0x1030: ("Broken Needle", b"", Segment.TYPE_ASCII, 0),
        0x1080: ascii_entry("nothing here"),
    })
    mid = Segment(0x2000, 0x100, {0x2000: ascii_entry("needle mid"), 0x2010: ascii_entry("x")})
    document = Document([high, low, mid])
    bridge["_api"] = lambda: API()
    bridge["_document"] = lambda name=None: document

    table = {}
    for segment in document.getSegmentsList():
        for address, (display, raw, kind, _) in segment.strings.items():
            if display == "Broken Needle":
                table[address] = {
                    "value": display,
                    "provider_value": display,
                    "decoding": {"available": False, "reason": "Hopper reported an invalid string object extent at 0x%x" % address},
                }
                continue
            encoding = "utf-8" if kind == Segment.TYPE_ASCII else "utf-16-le"
            table[address] = {
                "value": display,
                "provider_value": display,
                "string": {"encoding": encoding, "encoding_status": "inferred", "termination": "present_or_not_required", "byte_length": len(raw)},
            }

    def expected(pattern, case_sensitive):
        needle = pattern if case_sensitive else pattern.casefold()
        hits = [a for a in sorted(table) if needle in (table[a]["value"] if case_sensitive else table[a]["value"].casefold())]
        return [{"address": "0x%x" % a, **table[a]} for a in hits]

    cases = [("needle", False), ("needle", True), ("Needle", True), ("NEEDLE", False), ("zzz-absent", False), ("Broken", True), ("e", False)]
    results = []
    # Run the sequence twice: the second pass reuses the document caches.
    for _ in range(2):
        for pattern, case_sensitive in cases:
            actual = bridge["_dispatch"]("search_strings", {"pattern": pattern, "case_sensitive": case_sensitive})
            results.append({"pattern": pattern, "case_sensitive": case_sensitive, "actual": actual, "expected": expected(pattern, case_sensitive)})
    print(json.dumps(results))


if __name__ == "__main__":
    main()
