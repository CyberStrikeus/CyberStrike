"""Source-owned mutations built with the same unchanged upstream ELF/ABI structures."""
import ctypes
import io
import json
from pathlib import Path
import sys
from elftools.elf.elffile import ELFFile
from elftools.elf.structs import ELFStructs
from elftools.construct import Container
from pwnlib.elf.datatypes import elf_prstatus_amd64

source, directory, sentinel, unlisted = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
original = source.read_bytes()
image = ELFFile(io.BytesIO(original))
segments = list(image.iter_segments())
notes = [note for segment in segments if segment.header.p_type == "PT_NOTE" for note in segment.iter_notes()]
status = next(note for note in notes if note.n_name == "CORE" and note.n_type == "NT_PRSTATUS")
descriptor_start = lambda note: note.n_offset + image.structs.Elf_Nhdr.sizeof() + ((note.n_namesz + 3) // 4) * 4
files = {}


def save(name, content):
    path = directory / (name + ".core")
    path.write_bytes(content)
    files[name] = str(path)


def note_header(content, note, **changes):
    header = dict(note)
    header.update(changes)
    encoded = image.structs.Elf_Nhdr.build(Container(**header))
    content[note.n_offset:note.n_offset + len(encoded)] = encoded


# Authored metadata carriers exercise actual parser projection through public
# inspection, independently of the host that produced the captured amd64 core.
for name, machine, kind in [
    ("aarch64-archext", "EM_AARCH64", "PT_AARCH64_ARCHEXT"),
    ("aarch64-unwind", "EM_AARCH64", "PT_AARCH64_UNWIND"),
    ("aarch64-mte-opaque", "EM_AARCH64", 0x70000002),
    ("amd64-processor-opaque", "EM_X86_64", 0x70000001),
]:
    structs = ELFStructs(little_endian=True, elfclass=64)
    structs.create_basic_structs()
    structs.create_advanced_structs("ET_CORE", machine, image.header.e_ident.EI_OSABI)
    header_bytes, entry_bytes = structs.Elf_Ehdr.sizeof(), structs.Elf_Phdr.sizeof()
    header = Container(**dict(image.header, e_machine=machine, e_entry=0, e_ehsize=header_bytes,
                              e_phoff=header_bytes, e_phentsize=entry_bytes, e_phnum=1,
                              e_shoff=0, e_shentsize=64, e_shnum=0, e_shstrndx=0, e_flags=0))
    segment = Container(p_type=kind, p_flags=4, p_offset=header_bytes + entry_bytes,
                        p_vaddr=0, p_paddr=0, p_filesz=4, p_memsz=4, p_align=4)
    save(name, structs.Elf_Ehdr.build(header) + structs.Elf_Phdr.build(segment) + bytes(4))


save("truncated-header", original[:32])
for name, osabi, version in [("linux-osabi", 3, 0), ("solaris-osabi", 6, 0), ("freebsd-osabi", 9, 0), ("unsupported-abi-version", 0, 1)]:
    content = bytearray(original)
    content[7:9] = bytes([osabi, version])
    save(name, content)
content = bytearray(original)
section = Container(sh_name=0, sh_type="SHT_NULL", sh_flags=0, sh_addr=0, sh_offset=0, sh_size=0, sh_link=0, sh_info=len(segments), sh_addralign=0, sh_entsize=0)
content.extend(image.structs.Elf_Shdr.build(section))
header = Container(**dict(image.header, e_phnum=0xffff, e_shoff=len(original), e_shentsize=image.structs.Elf_Shdr.sizeof(), e_shnum=1, e_shstrndx=0))
content[:image.structs.Elf_Ehdr.sizeof()] = image.structs.Elf_Ehdr.build(header)
save("extended-program-count", content)
for index, segment in enumerate(segments):
    if segment.header.p_type != "PT_NOTE":
        continue
    content = bytearray(original)
    raw_notes = original[segment.header.p_offset:segment.header.p_offset + segment.header.p_filesz]
    content.extend(raw_notes + b"\0\0\0")
    header = Container(**dict(segment.header, p_offset=len(original), p_filesz=len(raw_notes) + 3))
    start = image.header.e_phoff + index * image.header.e_phentsize
    content[start:start + image.structs.Elf_Phdr.sizeof()] = image.structs.Elf_Phdr.build(header)
    save("zero-note-tail", content)
    content[-1] = 1
    save("nonzero-note-tail", content)
    break
content = bytearray(original)
note_header(content, status, n_descsz=1)
save("truncated-status", content)
content = bytearray(original)
note_header(content, status, n_namesz=len(original))
save("truncated-owner", content)
content = bytearray(original)
content[status.n_offset + image.structs.Elf_Nhdr.sizeof()] = 255
save("opaque-owner", content)
for name, kind in [("gnu-type3", 3), ("gnu-file-collision", 0x46494c45)]:
    content = bytearray(original)
    note_header(content, status, n_type=kind)
    owner_start = status.n_offset + image.structs.Elf_Nhdr.sizeof()
    # Preserve the original five-byte name extent and all note alignment.
    content[owner_start:owner_start + 5] = b"GNU\0\0"
    save(name, content)
for name, kind in [("aarch64-archext", 0x70000000), ("aarch64-unwind", 0x70000001)]:
    header = Container(**dict(image.header, e_machine="EM_AARCH64", e_phoff=64, e_phentsize=56,
                              e_phnum=1, e_shoff=0, e_shnum=0, e_shstrndx=0))
    segment = Container(p_type=kind, p_flags=4, p_offset=120, p_vaddr=0, p_paddr=0,
                        p_filesz=4, p_memsz=4, p_align=4)
    save(name, image.structs.Elf_Ehdr.build(header) + image.structs.Elf_Phdr.build(segment) + bytes(4))
content = bytearray(original)
for note in notes:
    if note.n_type == "NT_SIGINFO":
        note_header(content, note, n_type=0x7ffeff)
save("unknown-signals", content)
content = bytearray(original)
for index, segment in enumerate(segments):
    if segment.header.p_type == "PT_NOTE":
        header = dict(segment.header, p_type="PT_NULL")
        encoded = image.structs.Elf_Phdr.build(Container(**header))
        start = image.header.e_phoff + index * image.header.e_phentsize
        content[start:start + len(encoded)] = encoded
save("missing-notes", content)
content = bytearray(original)
start = descriptor_start(status) + elf_prstatus_amd64.pr_pid.offset
content[start:start + ctypes.sizeof(ctypes.c_uint32)] = (0xfffffffe).to_bytes(4, "little")
save("negative-pid", content)
for name, pid in [("historical-pid-collision", sentinel), ("historical-pid-unlisted", unlisted)]:
    content = bytearray(original)
    content[start:start + ctypes.sizeof(ctypes.c_uint32)] = pid.to_bytes(4, "little")
    for note in notes:
        if note.n_name == "CORE" and note.n_type == "NT_PRPSINFO":
            # Build with unchanged pyelftools; no hard-coded PID offset or host file resolution.
            raw = dict(note.n_desc, pr_pid=pid)
            encoded = image.structs.Elf_Prpsinfo.build(Container(**raw))
            offset = descriptor_start(note)
            content[offset:offset + len(encoded)] = encoded
    save(name, content)
print(json.dumps(files))
