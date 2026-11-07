# DownUnderCTF masked-squares evidence

Fresh inspection and process captures on 8 October 2026, using the published
REA 4.1.0 package with Ghidra 12.1.4 on Linux x64. The challenge is
**masked squares flag checker**, by joseph, tagged easy in the
[official DownUnderCTF 2023 repository](https://github.com/DownUnderCTF/Challenges_2023_Public/tree/b48f83db2984bc7fa2ec7879a32d7efb1be8d333/rev/masked-squares-flag-checker).

## Target

- Original handout: `publish/ms_flag_checker`, stripped Linux x86-64 ELF.
- Size: 15,248 bytes.
- SHA-256: `dcd3bec4f608e11f3a12ce461100aaf5f621851ee63a1f870d7c90d4e3dd51ae`.
- Upstream revision: `b48f83db2984bc7fa2ec7879a32d7efb1be8d333`.
- Git blob: `af95d9e109b5b700b3285e7e9f3b341dc716d34a`.
- REA analysis-profile digest:
  `7cb87eeb3886b20e336087d762d35caac496279cf9839dcc5e741b973627c1ba`.

The original challenge was downloaded from GitHub's contents API and decoded
from its base64 representation. The decoded length matches the API's size;
REA's target digest matches the downloaded bytes. The byte digest was checked
again after analysis and execution. The page links to the original handout;
the executable is not copied into the website.

The supplied AGENTS.md and website writing/design guidelines were followed in
an isolated worktree. Raw results and local target paths stay in private scratch
storage; the public page uses a shortened target name in its example request.

## Discovery through REA

The following requests preceded reading the organizers' source, solution or
flag metadata. Searching the challenge README established its name/difficulty,
and the handout was analyzed directly.

| Operation                                             | Observed result                                                                  | Evidence ID                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `search_strings`, regex `flag\|correct\|wrong\|input` | Prompt at `0x102004`; failure at `0x10201c`; success at `0x102027`               | `ev_375cf2c47d9cd666eeb5527e13863ce8d01ca86d11a6957fde79227aab1266c8` |
| `xrefs`, address `0x102004`                           | Reference at `0x10126d`                                                          | `ev_31fb7e370e0ce8bccdf981167f49ad9196f67ac06c88eb2c1a19e3cb367e22f3` |
| `resolve_containing_procedure`, address `0x10126d`    | Function at `0x10124d`, inclusive body through `0x10134f`, 259 bytes             | `ev_0627cfd459c1d9255ae1b03355987a93a0827e658a7ff40abcbf2cb1cfd8e613` |
| `analyze_function`, procedure `0x10124d`              | Input conversion, two helper calls, mask/target pointers, success/failure branch | `ev_4ba6d97358da28a23dc69cb6fde01cc929f28fc14f3a3661f4c65bbb6d86ec29` |
| `analyze_function`, procedure `0x101189`              | Signed-byte run-length mask expansion                                            | `ev_9e4f339895223a21cbf5bcd008ba8b5890e2e804675a11cb286f7af19246f766` |
| `analyze_function`, procedure `0x101217`              | Add input integers at selected mask positions                                    | `ev_d89261458e3faddd85110185bcd97f0f3c87e0992edc64cb3b2a1ed44846c3e9` |
| `read_bytes`, address `0x104060`, length 144          | Target numbers followed by padding and the start of the mask table               | `ev_f8a3529dd5d583b06177be5ce76ca6de36f3242ac90ab30f9a3a96159ff84e53` |
| `read_bytes`, address `0x1040e0`, length 624          | All 26 mask records, 24 bytes each                                               | `ev_944d9664d6167bf46c72b9fce662e573ea4e017c5a8ebbc305b1d943a1623301` |

The first 104 bytes of the target read hold the 26 little-endian integers.
The displayed `read_bytes` requests preserve the actual lengths; the page
selects the seventh entries from those complete results.

## Interpretation

`CMP EDI,0x24` terminates the input conversion at 36 characters. Its inner
loop groups six integer cells per row. The checking loop walks from `0x1040e0`
to `0x104350` in 24-byte steps: `0x270 / 0x18 = 26` masks.

In the mask helper, `MOVSX` loads each byte with its sign. Positive runs write
ones, negative runs write zeros, and a zero terminates a record. All extracted
records decode to exactly 36 cells. In the summing helper, a zero mask cell
skips the addition; a nonzero cell adds the corresponding input integer.
The caller compares the returned sum against a stored target.

The seventh record starts at `0x104170` and begins `eb 01 f2 00`, meaning
`-21, +1, -14, stop`. It selects only zero-based input position 21.
Its target at `0x104078` is `37 00 00 00`, decimal 55, the code for `7`.
The SVG is calculated from this record, with only cell 21 highlighted.

The first mask selects 16 cells and its target is 1441. In the recovered flag,
changing position 8 from `z` (122) to `y` (121) changes that sum to 1440.

The website's C is an analyst-written summary of the sum helper and caller,
with a flattened 36-cell loop and descriptive names. Its selected assembly
is transcribed from the returned dossiers. The mask/target addresses are
analysis-image addresses; the executable's PIE runtime load address can differ.

## Solver and source cross-check

The downloadable Python script embeds the REA-extracted masks and targets,
expands their run lengths and gives the 26 sums to Z3. It asks for 36 character
codes using a conventional `DUCTF{...}` prefix/suffix and an alphabet of
letters, digits, underscores and braces. Those format restrictions are analyst
assumptions, distinguished from the observed binary checks in the script and
page caption.

The solver returned `DUCTF{ezzzpzzz_07bcda7bfe81faf43caa}` and all 26 extracted
equations match that value. A separate second-model search reached its timeout;
the completed verification concerns the returned candidate.

After obtaining and executing the candidate, the
[organizers' source](https://github.com/DownUnderCTF/Challenges_2023_Public/blob/b48f83db2984bc7fa2ec7879a32d7efb1be8d333/rev/masked-squares-flag-checker/src/ms_flag_checker.c)
confirmed the decoding/summing interpretation, all masks and all targets.
The
[challenge metadata](https://github.com/DownUnderCTF/Challenges_2023_Public/blob/b48f83db2984bc7fa2ec7879a32d7efb1be8d333/rev/masked-squares-flag-checker/ctfcli.yaml)
records the same flag.

## Original-program verification

Two `capture_process_scenario` requests launched the original handout in its
scratch directory, supplied one line of input and retained terminal output.

| Input                                  | Output       | Exit | Evidence ID                                                           |
| -------------------------------------- | ------------ | ---- | --------------------------------------------------------------------- |
| `DUCTF{ezzzpzzz_07bcda7bfe81faf43caa}` | `Correct!`   | 0    | `ev_99f724502d14c798959f510d274f3de0f554a27b5df5dd6cb322acfa3e90a452` |
| `DUCTF{ezyzpzzz_07bcda7bfe81faf43caa}` | `Incorrect!` | 255  | `ev_2d164f7f4c7eb139e5df8be21c1e52dc34f0ad238aea384e407a2bd6277024cb` |

Both captures completed without truncation. REA verified its owned process-group
cleanup and removed the capture temporary roots. Filesystem observation paths
were not requested. The native analysis session was closed afterward.

The challenge's original code and metadata are credited to DownUnderCTF/joseph.
The page, readable C summary, equation figure and Python solver are new work
based on this inspection.
