#!/usr/bin/env python3
"""Small fixture oracle: known source symbols/slots, never a REA table scanner."""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def limited(path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Oracle admits only these small, explicit fixture artifacts")
    return path.read_bytes()


def mutf8(value):
    units = value.encode("utf-16-be", "surrogatepass")
    result = bytearray()
    for index in range(0, len(units), 2):
        unit = int.from_bytes(units[index:index + 2], "big")
        if 0 < unit < 128:
            result.append(unit)
        elif unit < 2048:
            result.extend((0xC0 | (unit >> 6), 0x80 | (unit & 63)))
        else:
            result.extend((0xE0 | (unit >> 12), 0x80 | ((unit >> 6) & 63), 0x80 | (unit & 63)))
    return bytes(result)


class Elf:
    def __init__(self, data):
        self.data = data
        assert data[:4] == b"\x7fELF" and data[5] == 1
        self.width = {1: 4, 2: 8}[data[4]]
        self.machine = self.unpack("H", 18)[0]
        self.word = "Q" if self.width == 8 else "I"
        if self.width == 8:
            phoff, shoff = self.unpack("QQ", 32)
            phsize, phnum, shsize, shnum, names = self.unpack("HHHHH", 54)
        else:
            phoff, shoff = self.unpack("II", 28)
            phsize, phnum, shsize, shnum, names = self.unpack("HHHHH", 42)
        self.sections = []
        for index in range(shnum):
            row = self.unpack("IIQQQQIIQQ" if self.width == 8 else "IIIIIIIIII", shoff + index * shsize)
            self.sections.append(dict(zip(("name_index", "type", "flags", "address", "offset", "size", "link", "info", "align", "entry_size"), row)))
        names = self.section_data(self.sections[names])
        for section in self.sections:
            section["name"] = self.zero(names, section["name_index"]).decode("ascii")
        self.loads = []
        for index in range(phnum):
            row = self.unpack("IIQQQQQQ" if self.width == 8 else "IIIIIIII", phoff + index * phsize)
            if self.width == 8:
                kind, flags, offset, address, _, filesz, memsz, _ = row
            else:
                kind, offset, address, _, filesz, memsz, flags, _ = row
            if kind in (1, 0x6474E552):
                self.loads.append({"type": kind, "flags": flags, "offset": offset, "address": address, "file_bytes": filesz, "memory_bytes": memsz})
        self.symbols = {}
        self.exports = {}
        for section in self.sections:
            if section["type"] not in (2, 11):
                continue
            strings = self.section_data(self.sections[section["link"]])
            for offset in range(section["offset"], section["offset"] + section["size"], section["entry_size"]):
                row = self.unpack("IBBHQQ" if self.width == 8 else "IIIBBH", offset)
                if self.width == 8:
                    name, info, other, shndx, address, size = row
                else:
                    name, address, size, info, other, shndx = row
                name = self.zero(strings, name).decode("utf8")
                symbol = {"address": address, "size": size, "section_index": shndx}
                if section["type"] == 2:
                    self.symbols[name] = symbol
                if section["type"] == 11 and shndx != 0 and info & 15 == 2 and info >> 4 in (1, 2) and other & 3 == 0:
                    self.exports[name] = symbol
        self.overlay = {}
        self.encodings = set()
        relative = {183: 1027, 62: 8, 3: 8, 40: 23}[self.machine]
        for section in self.sections:
            if section["type"] in (4, 9):
                rela = section["type"] == 4
                encoding = "RELA" if rela else "REL"
                self.encodings.add(encoding)
                fmt = ("QQq" if rela else "QQ") if self.width == 8 else ("IIi" if rela else "II")
                for offset in range(section["offset"], section["offset"] + section["size"], section["entry_size"]):
                    row = self.unpack(fmt, offset)
                    kind = row[1] & (0xFFFFFFFF if self.width == 8 else 255)
                    if kind == relative:
                        self.overlay[row[0]] = (row[2] if rela else self.pointer(row[0]), encoding)
            elif section["type"] == 19:
                self.encodings.add("RELR")
                cursor = 0
                for offset in range(section["offset"], section["offset"] + section["size"], self.width):
                    encoded = self.unpack(self.word, offset)[0]
                    if encoded & 1 == 0:
                        self.overlay[encoded] = (self.pointer(encoded), "RELR")
                        cursor = encoded + self.width
                    else:
                        for bit in range(self.width * 8 - 1):
                            if encoded & (1 << (bit + 1)):
                                slot = cursor + bit * self.width
                                self.overlay[slot] = (self.pointer(slot), "RELR")
                        cursor += (self.width * 8 - 1) * self.width
            elif section["type"] in (0x60000001, 0x60000002):
                assert self.section_data(section).startswith(b"APS2")
                self.encodings.add("APS2")

    def unpack(self, fmt, offset):
        return struct.unpack_from("<" + fmt, self.data, offset)

    @staticmethod
    def zero(data, offset):
        end = data.index(0, offset, min(len(data), offset + 4096))
        return data[offset:end]

    def section_data(self, section):
        return self.data[section["offset"]:section["offset"] + section["size"]]

    def file_offset(self, address):
        for load in self.loads:
            delta = address - load["address"]
            if load["type"] == 1 and 0 <= delta < load["file_bytes"]:
                return load["offset"] + delta
        raise ValueError(f"No file-backed PT_LOAD at {address:#x}")

    def pointer(self, address):
        return self.unpack(self.word, self.file_offset(address))[0]

    def entry(self, address, index, name, descriptor, function=None):
        slots = []
        for slot in range(3):
            location = address + (index * 3 + slot) * self.width
            resolved, encoding = self.overlay[location]
            slots.append({"address": hex(location), "file_offset": hex(self.file_offset(location)), "raw_word": hex(self.pointer(location)), "resolved_word": hex(resolved), "encoding": encoding})
        for slot, expected in zip(slots, (name, descriptor)):
            actual = self.zero(self.data, self.file_offset(int(slot["resolved_word"], 16)))
            assert actual == mutf8(expected), (actual, expected)
            slot["string_bytes_hex"] = actual.hex()
        target = int(slots[2]["resolved_word"], 16)
        assert any(p["type"] == 1 and p["flags"] & 1 and p["address"] <= target < p["address"] + p["memory_bytes"] for p in self.loads)
        if function is not None:
            assert target == self.symbols[function]["address"]
        return {"table_address": hex(address), "entry_index": index, "name": name, "descriptor": descriptor, "function_symbol": function, "function_address": hex(target), "slots": slots}


def elf_oracle(path, expected, conscrypt):
    data = limited(path)
    elf = Elf(data)
    tables = []
    if "APS2" not in elf.encodings:
        if conscrypt:
            assert hashlib.sha256(data).hexdigest() == "a3b78516ca2398d4ab233c71cf5c41ebb14c36ce157ebbaf1e5fd903e8220181"
            row = elf.entry(0x2ADA68, 0, "EVP_PKEY_new_RSA", "([B[B[B[B[B[B[B[B)J")
            assert row["function_address"] == "0xfa11c"
            tables.append(row)
        else:
            for table in expected["tables"]:
                symbol = elf.symbols[table["symbol"]]
                section = elf.sections[symbol["section_index"]]
                assert section["name"] == table["section"] and section["flags"] & 1
                assert symbol["size"] == table["entries"] * 3 * elf.width
                rows = [r for r in expected["native_declarations"] if r.get("table_symbol") == table["symbol"]]
                by_index = {r["entry_index"]: r for r in rows}
                for index, row in sorted(by_index.items()):
                    tables.append(elf.entry(symbol["address"], index, row["name"], row["descriptor"], row["function_symbol"]))
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "machine": elf.machine, "pointer_bytes": elf.width, "relocation_encodings": sorted(elf.encodings), "table_scope": "known source symbols/entries only; APS2 deliberately not independently decoded here", "tables": tables, "exports": {name: {**value, "address": hex(value["address"])} for name, value in sorted(elf.exports.items())}, "loads": elf.loads}


def dex_oracle(path, expected):
    data = limited(path)
    assert data[:4] == b"dex\n"
    u32 = lambda offset: struct.unpack_from("<I", data, offset)[0]
    def leb(offset):
        result = 0
        for shift in range(0, 35, 7):
            value = data[offset]
            offset += 1
            result |= (value & 127) << shift
            if value < 128:
                return result, offset
        raise ValueError("Invalid fixture ULEB128")
    strings = []
    count, offset = u32(56), u32(60)
    for index in range(count):
        _, start = leb(u32(offset + index * 4))
        raw = Elf.zero(data, start)
        text = raw.replace(b"\xc0\x80", b"\x00").decode("utf8", "surrogatepass")
        strings.append(text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass"))
    types = [strings[u32(u32(68) + index * 4)] for index in range(u32(64))]
    prototypes = []
    for index in range(u32(72)):
        offset = u32(76) + index * 12
        parameters = u32(offset + 8)
        args = "" if parameters == 0 else "".join(types[struct.unpack_from("<H", data, parameters + 4 + item * 2)[0]] for item in range(u32(parameters)))
        prototypes.append("(" + args + ")" + types[u32(offset + 4)])
    methods = [struct.unpack_from("<HHI", data, u32(92) + index * 8) for index in range(u32(88))]
    result = []
    for index in range(u32(96)):
        offset = u32(u32(100) + index * 32 + 24)
        if offset == 0:
            continue
        counts = []
        for _ in range(4):
            count, offset = leb(offset)
            counts.append(count)
        for _ in range(counts[0] + counts[1]):
            _, offset = leb(offset)
            _, offset = leb(offset)
        for count in counts[2:]:
            method_index = 0
            for _ in range(count):
                delta, offset = leb(offset)
                access, offset = leb(offset)
                _, offset = leb(offset)
                method_index += delta
                if access & 0x100:
                    cls, proto, name = methods[method_index]
                    result.append({"class": types[cls][1:-1].replace("/", "."), "name": strings[name], "descriptor": prototypes[proto], "access_flags": hex(access)})
    actual = {(r["class"], r["name"], r["descriptor"]) for r in result}
    wanted = {(r["class"], r["name"], r["descriptor"]) for r in expected["native_declarations"]}
    assert actual == wanted and len(result) == len(wanted)
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "native_methods": sorted(result, key=lambda row: (row["class"], row["name"], row["descriptor"]))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("elf", "dex", "conscrypt"))
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    expected = json.loads(Path(__file__).with_name("source-expectations.json").read_text())
    result = dex_oracle(args.path, expected) if args.kind == "dex" else elf_oracle(args.path, expected, args.kind == "conscrypt")
    print(json.dumps(result, ensure_ascii=False, indent=2))
