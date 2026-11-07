"""Offline adapter to unchanged pwntools 4.15.0; never use libs/maps/libc.

Owned request/snapshot/reply paths are supplied by REA. No host target-process launch,
user configuration initialization, debugger startup, or dependency installation.
"""
import base64
import importlib.metadata
import io
import json
import os
from pathlib import Path
import resource
import sys

PROFILE = "pwntools@4.15.0;pyelftools@0.33;unicorn@2.1.2"
PACKAGES = {"pwntools": "4.15.0", "pyelftools": "0.33", "unicorn": "2.1.2"}
OUTPUT_BYTES = 64 * 1024 * 1024
# (e_machine, ELF class bits, byte order) -> architecture pwntools must also report.
PROFILES = {(62, 64, "little"): "amd64", (3, 32, "little"): "i386", (40, 32, "little"): "arm",
            (8, 32, "little"): "mips", (8, 32, "big"): "mips"}
PROFILE_SCOPE = ("Layout profile requires ELF64 x86-64, ELF32 i386, ELF32 ARM little-endian "
                 "or ELF32 MIPS little- or big-endian objects.")


class LayoutFailure(Exception):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def address(value):
    return hex(int(value))


def file_range(offset, size, length):
    return 0 <= offset <= length and 0 <= size <= length - offset


def location(offset, size, length):
    if not file_range(offset, size, length):
        raise LayoutFailure("format", "ELF contains a file-backed range outside the selected snapshot.")
    return {"offset": address(offset), "bytes": address(size)}


def name_reference(display, section, offset, content):
    header = getattr(section, "header", None)
    if header is None or header.sh_type != "SHT_STRTAB":
        return {"display": display, "bytes_base64": None, "location": None,
                "unknown_reason": "Referenced string table could not be resolved."}
    return name_in_table(display, header.sh_offset, header.sh_size, offset, content)


def name_in_table(display, table_start, table_size, offset, content):
    location(table_start, table_size, len(content))
    if not 0 <= offset < table_size:
        raise LayoutFailure("format", f"ELF name offset {offset} lies outside its declared string table of {table_size} bytes at file offset {table_start}.")
    start = table_start + offset
    limit = table_start + table_size
    end = content.find(b"\0", start, limit)
    if end < 0:
        raise LayoutFailure("format", "ELF name lacks a terminator within its reported string table.")
    raw = content[start:end]
    return {"display": raw.decode("utf-8", "replace") if display is None else display, "bytes_base64": base64.b64encode(raw).decode("ascii"),
            "location": location(start, len(raw) + 1, len(content)), "unknown_reason": None}


def dynamic_name_reference(tags, offset, image, content):
    starts = [tag.d_val for tag in tags if tag.d_tag == "DT_STRTAB"]
    sizes = [tag.d_val for tag in tags if tag.d_tag == "DT_STRSZ"]
    if not starts or not sizes:
        raise LayoutFailure("format", "ELF dependency requires DT_STRTAB and DT_STRSZ.")
    if len(starts) != 1 or len(sizes) != 1:
        raise LayoutFailure("unsupported-target", "ELF dependency string-table tags are ambiguous: " + repr({"DT_STRTAB": starts, "DT_STRSZ": sizes}))
    if not 0 <= offset < sizes[0]:
        raise LayoutFailure("format", f"ELF dependency name offset {offset} lies outside declared DT_STRSZ {sizes[0]}.")
    offsets = set()
    if len(starts) == 1 and len(sizes) == 1:
        for segment in image.iter_segments_by_type("PT_LOAD"):
            h = segment.header
            if starts[0] >= h.p_vaddr and starts[0] + sizes[0] <= h.p_vaddr + h.p_filesz:
                offsets.add(h.p_offset + starts[0] - h.p_vaddr)
    if len(offsets) != 1:
        raise LayoutFailure("unsupported-target", "Dynamic string table lacks a unique file-backed mapping: " + repr({"DT_STRTAB": starts, "DT_STRSZ": sizes, "candidate_file_offsets": sorted(offsets)}))
    return name_in_table(None, offsets.pop(), sizes[0], offset, content)


def symbol_value_meaning(raw, image_type, sections):
    index = raw.st_shndx
    if raw.st_info.type == "STT_FILE": return "no-address"
    if index == "SHN_UNDEF": return "undefined"
    if index == "SHN_COMMON": return "alignment"
    if index == "SHN_ABS": return "absolute-value"
    if not isinstance(index, int) or not 0 < index < len(sections) or index >= 0xff00:
        return "unknown-section-index"
    if sections[index].header.sh_type == "SHT_NULL":
        return "unknown-section-index"
    if image_type == "ET_REL": return "section-offset"
    if raw.st_info.type == "STT_TLS": return "tls-offset"
    return "linked-virtual-address"


def relocation_target(image_type, section_index, offset, sections):
    if image_type != "ET_REL":
        return {"kind": "linked-virtual-address", "address": address(offset)}
    if section_index == 0 or sections[section_index].header.sh_type == "SHT_NULL":
        return {"kind": "unknown-section", "reported_section_index": section_index,
                "offset": address(offset), "unknown_reason": "undefined-section-reference" if section_index == 0 else "inactive-section-header"}
    return {"kind": "section-offset", "section_index": section_index, "offset": address(offset)}


def inspect_elf(path, cache):
    for package, expected in PACKAGES.items():
        try:
            version = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as error:
            raise LayoutFailure("unavailable", "Selected Python lacks " + package + " " + expected + ".") from error
        if version != expected:
            raise LayoutFailure("unsupported", "Expected " + package + " " + expected + "; selected Python reports " + version + ".")
    content = path.read_bytes()
    if len(content) < 4 or content[:4] != b"\x7fELF":
        raise LayoutFailure("format", "Selected object does not contain an ELF header.")
    if len(content) < 16:
        raise LayoutFailure("format", "Selected ELF identification is truncated.")
    if content[4] not in (1, 2) or content[5] not in (1, 2):
        raise LayoutFailure("unsupported-target", "Selected ELF declares an unknown class or byte order.")
    bits, header_size = (32, 52) if content[4] == 1 else (64, 64)
    order = "little" if content[5] == 1 else "big"
    if len(content) < header_size:
        raise LayoutFailure("format", f"Selected ELF{bits} header is truncated.")
    profile = (int.from_bytes(content[18:20], order), bits, order)
    if profile not in PROFILES:
        raise LayoutFailure("unsupported-target", PROFILE_SCOPE)
    if int.from_bytes(content[16:18], order) not in (1, 2, 3):
        raise LayoutFailure("unsupported-target", "Selected ELF type is outside the EXEC/DYN/REL layout profile; recorded core analysis is separate.")
    from pwnlib.context import context
    with context.local(cache_dir=str(cache), log_level="warning"):
        from elftools.common.exceptions import ELFError
        from elftools.elf.elffile import ELFFile
        from pwnlib.elf import ELF
        try:
            headers = ELFFile(io.BytesIO(content))
            section_count = headers.num_sections()
            if section_count:
                location(headers.header.e_shoff, section_count * headers.header.e_shentsize, len(content))
            segment_count = headers.num_segments()
            if segment_count:
                location(headers.header.e_phoff, segment_count * headers.header.e_phentsize, len(content))
            if headers.header.e_shstrndx == 0xffff and section_count == 0:
                raise LayoutFailure("format", "ELF extended section-name index requires a declared section-zero header.")
            raw_name_index = headers.header.e_shstrndx
            if 0xff00 <= raw_name_index < 0xffff:
                raise LayoutFailure("format", f"ELF section-name index {raw_name_index} is reserved and cannot directly reference a section.")
            section_name_index = headers.get_shstrndx()
            if raw_name_index == 0xffff and section_name_index < 0xff00:
                raise LayoutFailure("format", f"ELF SHN_XINDEX resolves to ordinary index {section_name_index}; the escape requires an index at least SHN_LORESERVE (0xff00).")
            if section_name_index != 0:
                if section_name_index >= section_count:
                    raise LayoutFailure("format", f"ELF section-name table index {section_name_index} lies outside the declared section count {section_count}.")
                names_header = headers._get_section_header(section_name_index)
                if names_header.sh_type != "SHT_STRTAB":
                    raise LayoutFailure("format", f"ELF section-name table {section_name_index} is not SHT_STRTAB.")
                location(names_header.sh_offset, names_header.sh_size, len(content))
        except (ELFError, ValueError, OverflowError, AssertionError, IndexError) as error:
            raise LayoutFailure("format", str(error)) from error
        class LayoutELF(ELF):
            def search(self, needle, writable=False, executable=False):
                # This adapter exposes structural facts, GOT/PLT and mitigation
                # indicators, not kernel config/version discovery. Upstream's
                # constructor searches virtual memory for those unrelated
                # heuristics, materializing NOBITS tails and interpreting
                # ordinary IKCFG_ST data as a compressed kernel config.
                return iter(())

            def _populate_kernel_version(self):
                # Kernel banner decoding is outside this report too.
                return None

            def _get_section_name(self, header):
                # SHN_UNDEF declares no names; upstream would otherwise read
                # strings at the inactive section-zero offset.
                return "" if section_name_index == 0 else super()._get_section_name(header)

            # pyelftools 0.33 calls these documented filters internally;
            # pwntools 4.15.0's cached overrides do not accept the argument.
            # Forward the filter on this adapter instance, without modifying
            # either upstream package or process-global methods.
            def iter_segments(self, type=None):
                return (segment for segment in super().iter_segments()
                        if type is None or segment.header.p_type == type)

            def iter_sections(self, type=None):
                return (section for section in super().iter_sections()
                        if type is None or section.header.sh_type == type)
        try:
            image = LayoutELF(str(path), checksec=False)
            if (image.arch, image.bits, image.endian) != (PROFILES[profile], bits, order):
                raise LayoutFailure("unsupported-target", PROFILE_SCOPE)
            if image.header.e_type not in ("ET_EXEC", "ET_DYN", "ET_REL"):
                raise LayoutFailure("unsupported-target", "Selected ELF type is outside the EXEC/DYN/REL layout profile; recorded core analysis is separate.")
            length = len(content)
            all_sections = list(image.iter_sections())
            shstrings = image.get_section(section_name_index) if all_sections and section_name_index != 0 else None
            sections, segments, symbols, relocations, packed_relatives = [], [], [], [], []
            needed, interpreters = [], []
            for index, section in enumerate(all_sections):
                h = section.header
                backing = h.sh_type not in ("SHT_NOBITS", "SHT_NULL")
                if backing: location(h.sh_offset, h.sh_size, length)
                sections.append({
                    "index": index, "name": name_reference(section.name, shstrings, h.sh_name, content) if shstrings is not None else {"display": "", "bytes_base64": None, "location": None, "unknown_reason": "ELF declares no section-name table (SHN_UNDEF index 0)."}, "name_offset": address(h.sh_name), "type": h.sh_type,
                    "header_location": location(image.header.e_shoff + index * image.header.e_shentsize, image.header.e_shentsize, length),
                    "address": address(h.sh_addr), "offset": address(h.sh_offset),
                    "size": address(h.sh_size), "alignment": address(h.sh_addralign),
                    "flags": address(h.sh_flags), "link": h.sh_link, "info": h.sh_info,
                    "entry_size": address(h.sh_entsize), "file_backing": "file" if backing else "none",
                })
                if h.sh_type in ("SHT_SYMTAB", "SHT_DYNSYM"):
                    if h.sh_entsize < image.structs.Elf_Sym.sizeof():
                        raise LayoutFailure("format", f"ELF symbol entry is smaller than the decoded Elf{bits}_Sym structure.")
                    if h.sh_link >= len(all_sections) or all_sections[h.sh_link].header.sh_type != "SHT_STRTAB":
                        raise LayoutFailure("format", f"ELF symbol table {index} links to invalid string table {h.sh_link}.")
                    strings = all_sections[h.sh_link]
                    for entry, symbol in enumerate(section.iter_symbols()):
                        raw = symbol.entry
                        symbols.append({
                            "table_index": index, "entry_index": entry,
                            "name": name_reference(symbol.name, strings, raw.st_name, content), "name_offset": address(raw.st_name),
                            "location": location(h.sh_offset + entry * h.sh_entsize, h.sh_entsize, length),
                            "value": address(raw.st_value), "value_meaning": symbol_value_meaning(raw, image.header.e_type, all_sections),
                            "size": address(raw.st_size), "binding": raw.st_info.bind, "type": raw.st_info.type,
                            "visibility": raw.st_other.visibility, "section_index": raw.st_shndx,
                        })
                if h.sh_type in ("SHT_REL", "SHT_RELA"):
                    if h.sh_size % h.sh_entsize != 0:
                        raise LayoutFailure(
                            "format",
                            f"ELF relocation section {index} size is not a multiple of its {h.sh_entsize}-byte entries.",
                        )
                    if image.header.e_type == "ET_REL" and h.sh_info >= len(all_sections):
                        raise LayoutFailure("format", f"ELF relocation section {index} references missing target section {h.sh_info}.")
                    symbol_table = None
                    if h.sh_link != 0:
                        if h.sh_link >= len(all_sections) or all_sections[h.sh_link].header.sh_type not in ("SHT_SYMTAB", "SHT_DYNSYM"):
                            raise LayoutFailure("format", f"ELF relocation section {index} links to invalid symbol table {h.sh_link}.")
                        symbol_table = all_sections[h.sh_link]
                    for entry, relocation in enumerate(section.iter_relocations()):
                        raw = relocation.entry
                        if raw.r_info_sym != 0 and (symbol_table is None or raw.r_info_sym >= symbol_table.num_symbols()):
                            raise LayoutFailure("format", f"ELF relocation section {index} entry {entry} references missing symbol {raw.r_info_sym} in table {h.sh_link}.")
                        relocations.append({
                            "section_index": index, "entry_index": entry, "reported_offset": address(raw.r_offset),
                            "target": relocation_target(image.header.e_type, h.sh_info, raw.r_offset, all_sections),
                            "location": location(h.sh_offset + entry * h.sh_entsize, h.sh_entsize, length),
                            "type": raw.r_info_type, "symbol_table_index": h.sh_link, "symbol_index": raw.r_info_sym,
                            "symbol_reference_meaning": "zero-symbol-value" if raw.r_info_sym == 0 else "symbol-table-entry",
                            "addend": None if "r_addend" not in raw else str(raw.r_addend),
                        })
                if h.sh_type == "SHT_RELR":
                    packed_relatives.append({
                        "section_index": index,
                        "location": location(h.sh_offset, h.sh_size, length),
                        "encoded_bytes_base64": base64.b64encode(content[h.sh_offset:h.sh_offset + h.sh_size]).decode("ascii"),
                        "entries": [{"decoded_index": decoded, "reported_offset": address(relocation.entry.r_offset)} for decoded, relocation in enumerate(section.iter_relocations())],
                        "offset_meaning": "unknown" if image.header.e_type == "ET_REL" else "linked-virtual-address",
                        "evidence_kind": "derived", "entry_source_locations": None, "addends": None,
                    })
            for index, segment in enumerate(image.iter_segments()):
                h = segment.header
                backing = h.p_type != "PT_NULL" and h.p_filesz != 0
                if backing: location(h.p_offset, h.p_filesz, length)
                if h.p_type == "PT_LOAD" and h.p_memsz < h.p_filesz:
                    raise LayoutFailure("format", "ELF load segment memory size is smaller than its file size.")
                segments.append({
                    "index": index, "type": h.p_type, "offset": address(h.p_offset),
                    "header_location": location(image.header.e_phoff + index * image.header.e_phentsize, image.header.e_phentsize, length),
                    "file_size": address(h.p_filesz), "memory_size": address(h.p_memsz),
                    "virtual_address": address(h.p_vaddr), "physical_address": address(h.p_paddr),
                    "alignment": address(h.p_align), "flags": address(h.p_flags),
                    "file_backing": "file" if backing else "none",
                    "permissions": None if h.p_type == "PT_NULL" else {"read": bool(h.p_flags & 4), "write": bool(h.p_flags & 2), "execute": bool(h.p_flags & 1)},
                })
                if h.p_type == "PT_DYNAMIC":
                    tag_size = image.structs.Elf_Dyn.sizeof()
                    tags = []
                    for tag_index in range(h.p_filesz // tag_size):
                        tag = segment._get_tag(tag_index)
                        tags.append(tag)
                        if tag.d_tag == "DT_NULL":
                            break
                    else:
                        raise LayoutFailure("format", f"ELF dynamic segment {index} has no complete DT_NULL terminator within its reported file range.")
                    for tag in tags:
                        if tag.d_tag == "DT_NEEDED":
                            needed.append(dynamic_name_reference(tags, tag.d_val, image, content))
                if h.p_type == "PT_INTERP":
                    raw = content[h.p_offset:h.p_offset + h.p_filesz]
                    end = raw.find(b"\0")
                    if end < 0:
                        raise LayoutFailure("format", "ELF interpreter lacks a reported terminator.")
                    interpreters.append({"display": raw[:end].decode("utf-8", "replace"), "bytes_base64": base64.b64encode(raw[:end]).decode("ascii"), "location": location(h.p_offset, end + 1, length), "unknown_reason": None})
            return {
                "format": "elf", "architecture": {"machine": image.header.e_machine, "bits": image.bits, "byte_order": image.endian},
                "image_type": image.header.e_type,
                "entry_point": {"reported_value": address(image.header.e_entry), "meaning": "not-applicable" if image.header.e_type == "ET_REL" else "absent" if image.header.e_entry == 0 else "linked-virtual-address", "execution_status": "unknown"},
                "runtime_load_base": None, "sections": sections, "segments": segments, "symbols": symbols, "relocations": relocations,
                "packed_relative_relocations": packed_relatives, "relocation_inventory_completeness": "unknown",
                "linkage": {"needed_libraries": needed, "interpreters": interpreters,
                    "got": [{"display_name": name, "address": address(value)} for name, value in image.got.items()],
                    "plt": [{"display_name": name, "address": address(value)} for name, value in image.plt.items()],
                    "convenience_maps_completeness": "unknown", "runtime_library_paths": None},
                "mitigations": {"evidence_kind": "inferred", "position_independent": image.pie, "nx_indicator": image.nx, "executable_stack_indicator": image.execstack, "stack_canary_indicator": image.canary, "relro": image.relro},
                "limitations": [
                    "PT_NULL payload fields are unused and retain their reported numbers without file-byte or permission claims. Zero-file-size segments provide no file bytes.",
                    "SHN_XINDEX symbol values remain unresolved in this upstream representation; an external index table does not establish a resolved index in this report.",
                    "Reported values preserve linked addresses, section offsets, TLS offsets, alignment and absolute values separately. Runtime load base and library paths are unknown.",
                    "Names are display strings plus raw bytes and file ranges where resolvable; section/table/entry indices preserve identity and duplicates. Name ranges include their terminating NUL; raw name bytes exclude it.",
                    "Ordinary relocation rows cover REL/RELA. RELR tables retain complete encoded bytes and upstream-decoded offsets as derived evidence; per-offset packed-word locations and implicit addends remain unknown. Relocation inventory completeness is unknown, including other encodings and missing section tables.",
                    "Relocation symbol index zero uses a zero symbol value without a table lookup. Positive indices reference validated original symbol-table entries; raw table and symbol indices remain reported.",
                    "Relocatable relocation targets with SHN_UNDEF or inactive SHT_NULL headers retain their reported section index/offset as unknown; they do not establish an associated target section.",
                    "GOT/PLT are derived upstream convenience maps; PLT inference can emulate selected instructions in Unicorn. They do not establish target runtime behavior; aliases may collapse and warnings may indicate incomplete coverage. Their completeness is unknown.",
                    "Mitigations are upstream static heuristics, not runtime protection. ET_DYN does not prove an executable; absent canary symbols do not prove every function unprotected.",
                    "Kernel configuration/version discovery is not performed; these memory-content scans do not supply the reported structural, linkage or mitigation facts.",
                    "This profile inspects ELF EXEC/DYN/REL layout only. It does not analyze recorded cores, resolve loaded libraries, launch the target as a host process or start a debugger.",
                    "Symbol/relocation inventories reflect original section tables. A sectionless image can still report dynamic dependency names; missing tables do not prove absence of dynamic symbols or relocations.",
                    *(["Absent section-name table: section-dependent RELRO/canary heuristics may be incomplete; protection coverage is unknown."] if all_sections and section_name_index == 0 else []),
                    *(["Sectionless images lack the .dynamic section and symbol tables used by upstream heuristics. RELRO/canary indicators may be incomplete; their values remain reported static candidates, with protection coverage unknown."] if not all_sections else []),
                ],
            }
        except LayoutFailure:
            raise
        except (ELFError, ValueError, OverflowError, AssertionError, IndexError) as error:
            raise LayoutFailure("format", "Selected ELF failed unchanged upstream structural parsing: " + str(error)) from error



if __name__ == "__main__":
    runtime_path = Path(__file__).with_name("decoder_runtime.py")
    runtime = {"__file__": str(runtime_path), "__name__": "rea_decoder_runtime"}
    exec(compile(runtime_path.read_bytes(), str(runtime_path), "exec"), runtime)
    runtime["main"](sys.argv[-1], inspect_elf, LayoutFailure, PROFILE)
