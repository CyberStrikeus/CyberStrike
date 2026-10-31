# Calculator and dinosaur beginner examples

Evidence collected on 9 October 2026 with the published REA 4.1.0 package.
The homepage offers compact setup first, then a reverse-engineering definition,
purpose and manual/agent comparison. Dinosaur is the first worked example;
Calculator is the second. Each states its goal, why the program is inspected,
what REA returned and how the agent uses it.
Prompts and replies are examples based on the
findings below. Selected code and generic inputs are public; raw captures stay
outside the website.

## Windows Calculator

### Inspected artifacts

The installed Windows Calculator package is version `11.2508.4.0`, x64.

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Windows `calc.exe` launcher | `9c2c8a8588fe6db09c09337e78437cb056cd557db1bcf5240112cbfb7b600efb` |
| Package `CalcViewModel.dll` | `07a1953bbf828a3495662c4b4bde1c80c9075061e0e389eabac5f8c544710df5` |

REA's function dossier for launcher `0x1400019f4` includes the call to
`ShellExecuteW` with `ms-calculator:`. Evidence:
`ev_e97a6a1a61bfe63476a13e6285d71dd838101066f7863c9af822861050203ea5`.

The calculation is in the installed app's model DLL. REA inspected function
`0x1801245d0`, whose body occupies two ranges, totaling 10,656 bytes:
`0x1801245d0–0x180126f4c` and `0x180126f55–0x180126f77`.
Evidence:
`ev_830a710c7fb55a08ac896fb5783c14339480a57a96d6d45c57c024b6a43239d0`.

REA supplied pseudocode, original instructions, calls and references. Its
`case 0x76` checks the operator field against `0x5c` and `0x5b` and constructs
the constant 100 in both paths. One path divides the current value by 100;
the other combines the current value with the previous value divided by 100.
The published assembly is selected exactly from the returned instruction list.

The opening manual/agent comparison selects instructions at
`0x180124945–0x180124992` and `0x180124a14–0x180124a34`, with explicit omissions.
Its three highlights identify the operator comparisons, construction of 100
and arithmetic helper calls, and the final multiplication path. The analyst
thought bubbles illustrate the work of decoding those facts; they are not a
recorded analyst transcript or a measured comparison of investigation times.
The same percentage question appears in the agent prompt. Helper meanings and
operator names are interpretations checked against the public source below.

The binary is stripped. A local instruction scan located candidates using
operator IDs and the constant 100; REA then produced the complete function
dossier. Function selection was analyst-assisted. The illustrative agent
prompt is not a recording of an autonomous end-to-end discovery.

### Source interpretation and check

Microsoft's MIT-licensed source at commit
`d125246a4e19842ce1332e6c7839cf0e110027d8` supplies the operator meanings and
an independently readable implementation:

- [Operator IDs](https://github.com/microsoft/calculator/blob/d125246a4e19842ce1332e6c7839cf0e110027d8/src/CalcManager/Header%20Files/CCommand.h): `IDC_DIV = 91`, `IDC_MUL = 92`, `IDC_PERCENT = 118`.
- [Percentage branch](https://github.com/microsoft/calculator/blob/d125246a4e19842ce1332e6c7839cf0e110027d8/src/CalcManager/CEngine/scifunc.cpp#L98-L111): multiply/divide uses `rat / 100`; other operators use `rat * (m_lastVal / 100)`.
- [Standard-mode tests](https://github.com/microsoft/calculator/blob/d125246a4e19842ce1332e6c7839cf0e110027d8/src/CalculatorUnitTests/CalculatorManagerTest.cpp#L350-L370): `6 × 6 % = 0.36` and `50 + 20 % = 60`.

These source branches agree with the operator checks and two paths observed
in the installed DLL. The public source commit is a crosscheck; it is not an
identified build commit for that installed package. No PDB symbols were loaded.

The homepage's named C-like rule is an explanatory summary. Its `200 + 10%`
and `200 × 10%` controls compute those cases from that rule using the fixed
inputs 200 and 10. Browser checks exercise
both percentage illustrations, their results, operator selection and reset.
The Microsoft tests were inspected, not executed. A probe-owned Calculator
window could be inspected, but it was no longer present at the input-check
step; no completed Windows GUI input result is claimed.

## Dinosaur speed

### Running target and source

REA inspected the HTTP page
<https://wayou.github.io/t-rex-runner/> in an owned Chrome 150.0.7871.124
session through a loopback debugging connection. This is wayou's
Chromium-derived browser edition. REA's HTTP(S) page inspection does not
select `chrome://dino/`; the website identifies the HTTP edition as its target.

The returned `index.js` source contains 90,241 UTF-8 bytes, SHA-256
`e7a50d337bdbe4299068de034e4564cfe5fd45ca9257ded37b6ada9330cedf0f`.
Evidence:
`ev_7a09de570cf6b64907504046485cab69ad444828964106eabc05958799749905`.

This digest also matches `index.js` in repository commit
`5455bfa408ec6b707c7300ff194b7390733a766d`. Source locations:

- [Settings](https://github.com/wayou/t-rex-runner/blob/5455bfa408ec6b707c7300ff194b7390733a766d/index.js#L106-L135): `ACCELERATION: 0.001`, `MAX_SPEED: 13`, `SPEED: 6`.
- [Update branch](https://github.com/wayou/t-rex-runner/blob/5455bfa408ec6b707c7300ff194b7390733a766d/index.js#L565-L571): increment speed on a collision-free update while speed is below the threshold.

The source begins with the Chromium Authors' 2014 copyright notice. Selected
excerpts are credited on the page. The repository's BSD license and the source
copyright are reproduced in `public/assets/licenses/dinosaur.txt`.

### Controlled original-game check

After the passive REA inspection, a separate Playwright controller called the
original page's `Runner.update()` repeatedly. It disabled future update
scheduling and obstacle generation, set the starting speed to 6, and kept the
game in its playing state. The control is credited separately from REA's
read-only inspection.

| Update count | Observed speed     | Display rounded to 3 decimals |
| ------------ | ------------------ | ----------------------------- |
| 0            | 6                  | 6.000                         |
| 1,000        | 7.000000000000334  | 7.000                         |
| 4,000        | 9.99999999999956   | 10.000                        |
| 7,000        | 12.999999999997897 | 13.000                        |
| 10,000       | 13.000999999997896 | 13.001                        |

The branch compares before adding. Floating-point increments can cross the
threshold by one increment; the reconstruction preserves this behavior rather
than introducing a clamp.

### New game and reader experiment

`public/assets/dino-speed.js` contains the reconstructed rule and an update-count
replay. Its rounded results match the original-game check above. The website's
mini-game imports this rule. It advances its own simulation at 60 updates per
second, avoiding a different frame rate changing its demonstration pace.

The canvas drawing, dinosaur shape, jump physics, rectangle collision detection,
spacing and controls are newly authored teaching code. The reconstruction claim
is scoped to the speed rule. Changing the slider selects a fixed speed between
2 and 18; selecting automatic acceleration restores the starting speed of 6.

The new game starts only after user input. It supports Play/Pause, Jump, Restart,
canvas Space/Up keys and touch. It pauses when hidden or scrolled out of view.
Without JavaScript, a static SVG, source excerpts and recorded results remain
available. The downloadable speed module and complete game source are linked
from the lab.

## Review checks

Website checks cover root and `/rea/` hosting, 320/390/850/1440px layouts,
expanded evidence, copying, no-JavaScript content, reduced motion, the two
percentage rules and the game controls. Game checks include speed selection,
automatic acceleration, a collision, restart, jump height on the rendered
canvas, pause and the original-rule replay. Existing Notes and DX-Ball pages
remain part of layout checks.
