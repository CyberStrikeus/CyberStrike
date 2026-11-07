"""Bounded Linux core evidence via unchanged ELFFile/structs and pwntools ctypes.

No Corefile-selected thread, executable guessing, process lookup or target launch.
"""
import base64
import ctypes
import importlib.metadata
import io
from pathlib import Path
import sys

PROFILE = "pwntools@4.15.0;pyelftools@0.33;unicorn@2.1.2"

# Linux ET_CORE machine identifiers whose PRSTATUS layout is interpreted with
# unchanged pwntools 4.15.0 ctypes. Both share pr_cursig@12, pr_pid@32 and
# pr_reg@112; only the register window differs: amd64 is 27 x 8 bytes for a
# 336-byte descriptor, AArch64 is 34 x 8 bytes for a 392-byte descriptor.
CORE_MACHINES = (62, 183)


class CoreFailure(Exception):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def encoded(value):
    return base64.b64encode(value).decode("ascii")


def location(offset, size, limit):
    if not 0 <= offset <= limit or not 0 <= size <= limit - offset:
        raise CoreFailure("format", "Recorded source range exceeds its declared container.")
    return {"offset": hex(offset), "bytes": hex(size)}


def inspect_core(path, cache):
    for package, required in {"pwntools": "4.15.0", "pyelftools": "0.33", "unicorn": "2.1.2"}.items():
        try:
            actual = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as error:
            raise CoreFailure("unavailable", "Selected Python lacks " + package + " " + required + ".") from error
        if actual != required:
            raise CoreFailure("unsupported", "Expected " + package + " " + required + "; selected Python reports " + actual + ".")
    content = path.read_bytes()
    if len(content) < 16 or content[:4] != b"\x7fELF":
        raise CoreFailure("format", "Selected recording lacks a complete ELF identification.")
    if content[4:6] != b"\x02\x01":
        raise CoreFailure("unsupported-target", "Initial recorded-core profile requires ELF64 little-endian.")
    if len(content) < 64:
        raise CoreFailure("format", "Selected ELF64 core header is truncated.")
    if content[6] != 1:
        raise CoreFailure("format", "ELF identification version is not EV_CURRENT.")
    if int.from_bytes(content[20:24], "little") != 1:
        raise CoreFailure("format", "ELF header version is not EV_CURRENT.")
    # Linux commonly emits ELFOSABI_NONE (0), also accepted as GNU/Linux (3).
    # Other declared OSABIs must never select Linux note ctypes.
    if content[7] not in (0, 3) or content[8] != 0:
        raise CoreFailure("unsupported-target", "Initial recorded-core profile requires System V or GNU/Linux OSABI with ABI version zero; selected OSABI=" + str(content[7]) + ", ABI version=" + str(content[8]) + ".")
    machine = int.from_bytes(content[18:20], "little")
    if int.from_bytes(content[16:18], "little") != 4 or machine not in CORE_MACHINES:
        raise CoreFailure("unsupported-target", "Initial recorded-core profile requires ET_CORE for x86-64 or AArch64; selected ET_TYPE=" + str(int.from_bytes(content[16:18], "little")) + ", e_machine=" + str(machine) + ".")
    from elftools.common.exceptions import ELFError
    from elftools.common.utils import struct_parse
    from elftools.elf.elffile import ELFFile
    from pwnlib.elf.datatypes import (
        elf_prstatus_aarch64,
        elf_prstatus_amd64,
        elf_siginfo_64,
        user_regs_struct_aarch64,
        user_regs_struct_amd64,
    )
    if machine == 62:
        profile_label = "x86-64"
        architecture = "x86_64-little-endian"
        prstatus_type, registers_type = elf_prstatus_amd64, user_regs_struct_amd64
    else:
        profile_label = "AArch64"
        architecture = "aarch64-little-endian"
        prstatus_type, registers_type = elf_prstatus_aarch64, user_regs_struct_aarch64
    try:
        image = ELFFile(io.BytesIO(content))
        header = image.header
        count = image.num_segments()
        if count and header.e_phentsize < image.structs.Elf_Phdr.sizeof():
            raise CoreFailure("format", "Program-header entry is shorter than the required ELF64 structure.")
        location(header.e_phoff, count * header.e_phentsize, len(content))
        segments, notes, padding, threads, signals = [], [], [], [], []
        for segment_index, segment in enumerate(image.iter_segments()):
            h = segment.header
            header_offset = header.e_phoff + segment_index * header.e_phentsize
            type_id = int.from_bytes(content[header_offset:header_offset + 4], "little")
            backing = type_id != 0 and h.p_filesz > 0
            if backing:
                location(h.p_offset, h.p_filesz, len(content))
            if type_id == 1 and h.p_filesz > h.p_memsz:
                raise CoreFailure("format", "Recorded PT_LOAD file bytes exceed memory size.")
            segments.append({"index": segment_index, "type": h.p_type, "type_id": type_id,
                             "header_location": location(header_offset, header.e_phentsize, len(content)),
                             "offset": hex(h.p_offset), "file_size": hex(h.p_filesz), "memory_size": hex(h.p_memsz),
                             "virtual_address": hex(h.p_vaddr), "physical_address": hex(h.p_paddr), "alignment": hex(h.p_align), "flags": hex(h.p_flags), "file_backing": "file" if backing else "none"})
            if type_id != 4 or h.p_filesz == 0:
                continue
            position, end = h.p_offset, h.p_offset + h.p_filesz
            header_size = image.structs.Elf_Nhdr.sizeof()
            while position < end:
                if end - position < header_size:
                    raw = content[position:end]
                    if any(raw):
                        raise CoreFailure("format", "Nonzero trailing note bytes lack a complete note header.")
                    padding.append({"segment_index": segment_index, "location": location(position, len(raw), end), "bytes_base64": encoded(raw)})
                    break
                note = struct_parse(image.structs.Elf_Nhdr, image.stream, stream_pos=position)
                note_type_id = int.from_bytes(content[position + 8:position + 12], "little")
                owner_start = position + header_size
                descriptor_start = owner_start + ((note.n_namesz + 3) // 4) * 4
                note_end = descriptor_start + ((note.n_descsz + 3) // 4) * 4
                location(position, note_end - position, end)
                owner = content[owner_start:owner_start + note.n_namesz]
                if owner and b"\0" not in owner:
                    raise CoreFailure("format", "Declared note owner has no NUL terminator.")
                display = owner.split(b"\0", 1)[0].decode("utf-8", "replace") if owner else None
                descriptor = content[descriptor_start:descriptor_start + note.n_descsz]
                note_index = len(notes)
                # pyelftools selects ET_CORE labels without owner context. Keep
                # those labels only for exact CORE owners; other kinds are opaque.
                note_type = note.n_type if owner == b"CORE\0" else note_type_id
                notes.append({"index": note_index, "segment_index": segment_index, "type": note_type, "type_id": note_type_id,
                              "location": location(position, note_end - position, end),
                              "owner_location": location(owner_start, len(owner), end), "owner_bytes_base64": encoded(owner), "owner_display": display,
                              "descriptor_location": location(descriptor_start, len(descriptor), end), "descriptor_bytes_base64": encoded(descriptor)})
                position = note_end
                # Only the initial Linux CORE ABI is interpreted. Other owners retain exact bytes.
                if owner != b"CORE\0":
                    continue
                if note_type_id == 1:
                    if len(descriptor) < ctypes.sizeof(prstatus_type):
                        raise CoreFailure("format", "Linux " + profile_label + " NT_PRSTATUS descriptor is truncated.")
                    status = prstatus_type.from_buffer_copy(descriptor)
                    registers = []
                    for name, kind in registers_type._fields_:
                        relative = prstatus_type.pr_reg.offset + getattr(registers_type, name).offset
                        registers.append({"name": name, "value": hex(getattr(status.pr_reg, name)), "location": location(descriptor_start + relative, ctypes.sizeof(kind), end)})
                    threads.append({"note_index": note_index, "historical_pid": ctypes.c_int32(status.pr_pid).value, "recorded_current_signal": status.pr_cursig, "registers": registers})
                elif note_type_id == 0x53494749:
                    if len(descriptor) < ctypes.sizeof(elf_siginfo_64):
                        raise CoreFailure("format", "Linux " + profile_label + " NT_SIGINFO descriptor is truncated.")
                    signal = elf_siginfo_64.from_buffer_copy(descriptor)
                    number = ctypes.c_int32(signal.si_signo).value
                    code = ctypes.c_int32(signal.si_code).value
                    known = number == 11 and code in (1, 2)
                    signals.append({"note_index": note_index, "number": number, "code": code, "errno": ctypes.c_int32(signal.si_errno).value,
                                    "fault_address": hex(signal.sigfault_addr) if known else None,
                                    "fault_address_meaning": "recorded-sigsegv-address" if known else "unknown", "thread_association": "unknown"})
        return {"format": "elf-core", "architecture": architecture, "target_execution": "not-performed", "live_process_identity": "unknown",
                "segments": segments, "notes": notes, "note_padding": padding, "threads": threads, "signals": signals,
                "note_interpretation_completeness": "unknown",
                "limitations": ["The initial Linux note profile accepts System V/unspecified or GNU/Linux OSABI with ABI version zero; an unspecified OSABI alone does not prove operating-system origin.",
                                "Historical PID and signal values are recorded metadata, not current process identity or attach authority.",
                                "Only exact Linux CORE NT_PRSTATUS/NT_SIGINFO owners are interpreted; every descriptor and owner retains original bytes. Other note semantics remain unknown.",
                                "NT_SIGINFO thread association is unknown. Only SIGSEGV SEGV_MAPERR/SEGV_ACCERR initially establish a fault-address union meaning.",
                                "PT_LOAD file bytes are recorded bytes. Undumped memory and current executable/library identity remain unknown; no current host file is resolved from a recorded pathname.",
                                "Missing notes/registers/signals do not establish their absence at the original crash. Full unwinding, executable pairing and live control are not provided."]}
    except CoreFailure:
        raise
    except (ELFError, ValueError, AssertionError, IndexError) as error:
        raise CoreFailure("format", "Recorded core failed unchanged upstream structural parsing: " + str(error)) from error


if __name__ == "__main__":
    runtime_path = Path(__file__).with_name("decoder_runtime.py")
    runtime = {"__file__": str(runtime_path), "__name__": "rea_decoder_runtime"}
    exec(compile(runtime_path.read_bytes(), str(runtime_path), "exec"), runtime)
    runtime["main"](sys.argv[-1], inspect_core, CoreFailure, PROFILE)
