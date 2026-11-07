# DX-Ball sound-pan evidence

The website presents one function from the English DX-Ball 1.07 Windows i386
executable. Project progress and validation claims are pinned to reconstruction
commit `a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4` (7 October 2026).

## Artifact and provider

- Target: `DXBALL.EXE`, 158,208 bytes, PE i386.
- SHA-256: `756da1ba09edce716d5bf8770320ca0d5ed4e525672b6bb605b9bdb4b88972ba`.
- Function: `0x406400` through `0x40643e`, inclusive, 63 bytes.
- Recorded analysis: REA 4.1.0, Ghidra 12.1.4, Linux x64 host.
- Pan dossier: `ev_ddca58134d89a2eb0aba5bf5694bb06ce7b5cb28aac0eb847891506244e70490`.
- Caller dossier: `ev_d09866ff22dc07f3ac28ef1d992c5876c1e58e1796dbe0f0c5c2814544aa27eb`.
- Constants read: `ev_6a56fda997bcda2df677257601da0174ff8041d44c8c83c48356df31edf0f7ae`.
- Scale read: `ev_64752f4ecf1ec74384ce01083c21fcfffb716931f6c31a7dac351a136df7979e`.

The website update reused the matching saved REA results and verified the local
target digest. It did not start a new provider session or repeat the project's
execution/compiler checks. Complete dossiers, snapshots, the original
executable and compiler products remain in the reconstruction project.

## Observations and interpretation

| Saved observation                                                     | Interpretation used by the reconstruction         |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| Stack load from `[EBP+8]`, then `FILD`                                | An integer parameter, named `x`                   |
| Brick-hit caller multiplies its coordinate by 30, adds 20, pushes EAX | The input is a brick's horizontal screen position |
| `FMUL [0x420068]`; byte read decodes to 1.5625                        | `pan = pan * 1.5625`                              |
| `FSUB [0x420070]`; byte read decodes to 500.0                         | `pan = pan - 500.0`                               |
| `FMUL [0x4210a0]`; initial double is 1.0                              | A stored scale, named `dxball_pan_scale`          |
| Call to `__ftol` at 0x41678c                                          | Convert the calculation to an integer             |

The names `dxball_screen_pan`, `x` and `dxball_pan_scale` belong to the maintained
source. The executable's instruction view supplies addresses and operations.
The original decompiler result reports `FUN_00406400(void)` and a conversion
call, omitting the stack input and x87 expression. The website's pseudocode
excerpt preserves that body and omits only its leading provider warning/comment
and blank lines.

## Displayed REA requests

The page shows the actual tool names with compact input excerpts:

- `analyze_function` at procedure `0x406400` returns the pan dossier, including
  its instruction view and the caller entry at `0x411f40`.
- `analyze_function` at procedure `0x411f40` returns the brick-hit dossier.
  The visible caller excerpt preserves the ADD/PUSH/CALL instructions verbatim;
  the full supporting excerpt also shows the preceding ×30 calculation.
- `read_bytes` at `0x420068`, length 16, returns
  `000000000000f93f0000000000407f40`.
- `read_bytes` at `0x4210a0`, length 8, returns `000000000000f03f`.

The page splits the first byte read into two eight-byte values and shows their
little-endian double interpretations beside the observed hex. These are decoded
values, not additional fields in the raw REA result. Query groups present the
reasoning sequence rather than reproducing an entire chronological session.
Provider details are recorded here; the product narrative uses REA to describe
the CLI/MCP operations the agent called.

## Complete recorded instruction listing

Transcribed verbatim from the pan dossier's normalized assembly facet:

```asm
0x406400: PUSH EBP
0x406401: MOV EBP, ESP
0x406403: SUB ESP, 0xc
0x406406: PUSH EBX
0x406407: PUSH ESI
0x406408: PUSH EDI
0x406409: MOV EAX, dword ptr [EBP + 0x8]
0x40640c: MOV dword ptr [EBP + -0xc], EAX
0x40640f: FILD dword ptr [EBP + -0xc]
0x406412: FST double ptr [EBP + -0x8]
0x406415: FMUL double ptr [0x00420068]
0x40641b: FST double ptr [EBP + -0x8]
0x40641e: FSUB double ptr [0x00420070]
0x406424: FST double ptr [EBP + -0x8]
0x406427: FMUL double ptr [0x004210a0]
0x40642d: FST double ptr [EBP + -0x8]
0x406430: CALL 0x0041678c
0x406435: JMP 0x0040643a
0x40643a: POP EDI
0x40643b: POP ESI
0x40643c: POP EBX
0x40643d: LEAVE
0x40643e: RET
```

The interactive website excerpt selects eight instructions from this listing.
It omits setup/cleanup, intermediate `FST` stores and the epilogue jump to keep
the calculation visible. The expandable listing retains all 23 instructions.
Copying the C panel copies the complete maintained function, including its
signature, declaration and return.

## Validation scope

The reconstruction project's recorded checks establish:

- 3,205 direct original-x86 differential cases: integer positions 0–640 at
  scales 0, 0.5, 1, 20 and −1.
- 63 matching bytes for the complete VC4.0-compiled function, after applying
  every reviewed relocation and checking referenced constants.

These claims apply to this function at the linked checkpoint. The figure shows
execution comparison and compiler replay as separate branches. Game-level
integration remains a separate project task.

## Public sources

- [Gameplay observations and Evidence IDs](https://github.com/N0zoM1z0/dx-ball/blob/a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4/docs/GAMEPLAY_OWNER.md)
- [Maintained function](https://github.com/N0zoM1z0/dx-ball/blob/a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4/src/gameplay.c#L41)
- [Semantic acceptance ledger](https://github.com/N0zoM1z0/dx-ball/blob/a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4/config/semantic-acceptance.csv)
- [Complete function units and relocation mappings](https://github.com/N0zoM1z0/dx-ball/blob/a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4/config/match-units.toml)
- [Compiler replay method](https://github.com/N0zoM1z0/dx-ball/blob/a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4/docs/BUILD_MATCHING.md)
