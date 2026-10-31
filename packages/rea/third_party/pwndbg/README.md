# pwndbg core context adapter

REA uses caller-supplied unchanged [pwndbg](https://github.com/pwndbg/pwndbg)
2026.09.15, commit `55596aa676a2756efb8d67034f31675170eabe48`, and GDB.
The original MIT license is retained in `LICENSE.md`. Engine source and its
dependencies are not vendored or acquired by REA.

The adapter executes the selected upstream `gdbinit.py` with its original
`__file__`, an explicitly selected existing virtual environment, and
`PWNDBG_NO_AUTOUPDATE=1`. The upstream entrypoint and dependencies are trusted
caller-supplied executable code. Reported versions establish observed behavior,
not source authenticity. The real verification lane checks out the exact commit
and uses its frozen `uv.lock` in isolated runner storage.

Only `pwndbg.aglib.vmmap.get()` is queried, after establishing a core-only GDB
connection without an executable. All original core notes and recorded register
values come from the independent pwntools/pyelftools decoder. Mapping candidates
are derived; original pathnames do not identify current host files, and reported
flags zero leave permissions unknown. REA does not expose upstream command
execution, live attach, target launch, implicit executable pairing or updates.

Local actual verification uses Linux x64, GDB 13.1 and the exact upstream tag/build.
Other GDB versions require their corresponding real workflow before being claimed.
