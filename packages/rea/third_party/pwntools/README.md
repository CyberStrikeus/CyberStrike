# Offline ELF upstream profile

REA uses caller-supplied, unchanged Python packages. It vendors no pwntools,
pyelftools or Unicorn implementation and never installs these dependencies.

| Upstream | Exact verified profile | License | Role |
| --- | --- | --- | --- |
| [pwntools](https://github.com/Gallopsled/pwntools) | 4.15.0; tag commit `3ad86ec5adab1abf9781ca7552a6f5d7cff7a33c` | MIT | ELF analysis and static mitigation/GOT/PLT heuristics |
| [pyelftools](https://github.com/eliben/pyelftools) | 0.33 | Public domain | Original ELF sections, segments, symbols and relocations |
| [Unicorn](https://github.com/unicorn-engine/unicorn) | 2.1.2 | GPL-2.0 | Upstream PLT emulation; distinct from executing the target as a host process |

The adapter checks all three runtime versions before importing the ELF engine.
Original upstream code/licenses remain in the caller-selected environment.
No target or core binaries are committed. Fixtures are compiled in owned
temporary storage from repository source and are never executed.

`bridge/pwntools/layout.py` is an owned allocation-failure bootstrap;
`layout_impl.py` is the adapter. It reads original tables through
unchanged upstream APIs, preserves raw name bytes/ranges, and serializes uint64
values as strings. It never accesses `ELF.libs`, `ELF.maps`, `ELF.libc` or
`process.corefile`, which have materially different execution authority.

The real verification lane traces host exec syscalls, checks original artifact
hashes and observes released owned processes. No negative claim relies only on
an unmodified target's sentinel: upstream can execute a patched copy when its
runtime-library accessors are used.

The instance-local adapter subclass forwards the documented pyelftools 0.33
`iter_segments(type=...)` / `iter_sections(type=...)` filters missing from
pwntools 4.15.0 cached overrides. No upstream file or global method is changed.
Sectionless dynamic string tables use unique DT_STRTAB/DT_STRSZ mappings to
file-backed PT_LOAD bytes; ambiguous or non-file-backed mappings are explicitly
unsupported. Section-name table escapes follow the [ELF ABI](https://gabi.xinuos.com/elf/02-eheader.html):
SHN_XINDEX represents actual indices at least 0xff00; ordinary absence uses index
zero. Raw name offsets remain reported when the name table is absent.

PLT convenience inference uses the unchanged upstream Unicorn instruction
emulator. REA labels those maps as derived static evidence. The no-execution
verification claim concerns launching the selected object as a host process,
not the absence of static instruction emulation inside an analysis engine.
