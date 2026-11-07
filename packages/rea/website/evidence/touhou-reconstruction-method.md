# Touhou reconstruction method: evidence notes

Checked on 10 October 2026. This document supports the full English essay
at `public/blog/touhou-reconstruction/index.html`.

## Method sources

The Factory checkpoint is
[`038b6bed`](https://github.com/N0zoM1z0/touhou-reconstruction-factory/tree/038b6bed51d273c8b3680553b6f43e1b97d19bd1).
Read its [agent autonomy](https://github.com/N0zoM1z0/touhou-reconstruction-factory/blob/038b6bed51d273c8b3680553b6f43e1b97d19bd1/docs/agent-autonomy.md),
[semantic workflow](https://github.com/N0zoM1z0/touhou-reconstruction-factory/blob/038b6bed51d273c8b3680553b6f43e1b97d19bd1/docs/semantic-reconstruction.md),
and [cross-game knowledge](https://github.com/N0zoM1z0/touhou-reconstruction-factory/blob/038b6bed51d273c8b3680553b6f43e1b97d19bd1/docs/knowledge-base.md)
documents for the underlying method: autonomous investigation, bounded changes,
empirical feedback, durable checkpoints and reusable lessons.

The industrial-age analogy explains that method. The Factory's
software architecture also uses the Abstract Factory pattern; the article's
analogy should focus on the working process rather than that implementation.

REA supplies analysis evidence to an agent. The historical projects also used
project-specific analysis bridges and tooling. The article should attribute
historical work to those projects and explain where REA fits in the general
workflow, without relabeling every historical tool result as REA output.

## Collection and counting

Public history was retrieved with `gh api`, including all pages of each
repository's default-branch commits, repository metadata and release records.
Pinned progress documents were read from the corresponding Git objects in the
local project checkouts. Every milestone SHA below appears in the public
GitHub history. No local-only revision or uncommitted change supplies a claim.

Elapsed days are the difference between public commit **committer timestamps**,
in UTC, divided by 86,400 and rounded to two decimal places. The article uses
rounded calendar intervals. They measure recorded milestone spacing, not
compute time, person-hours or a controlled speedup benchmark.

TH08's start is the independent continuation at `001bf3e`, not its inherited
2025 initial commit or its hosting creation date. Its imported GensokyoClub
history ends at `7ad3792`; preserve that attribution and license. TH095 starts
with zero confirmed authored functions, while using methods and infrastructure
from earlier projects. TH04 uses ReC98 as a credited source of existing work.

The denominators change as candidates are classified and boundaries reviewed.
Read each pinned progress document's definitions. Avoid a cross-game function
rate or an executable-wide completion percentage.

## Public history snapshot

This is the initial 10 October research snapshot. The later TH04 phase update
below uses its own pinned checkpoint; it does not change these earlier counts.

| Project | Default-branch commits | Commits whose subject begins `gpt-web:` | Public head                                |
| ------- | ---------------------: | --------------------------------------: | ------------------------------------------ |
| TH08    |                  1,117 |                                     400 | `d2a00f4acb4a13916e07a00bd13f714961714628` |
| TH095   |                    713 |                                     450 | `6084b36cfa90ac1720f0cba36caec3ee56fc5e1f` |
| TH04    |                    957 |                                     623 | `33b80522f03565022dbfe4d5c8a88bdc57f566ae` |

TH08 has 696 reachable continuation commits after the imported boundary;
its total includes the upstream history. Subject prefixes identify a recorded
workflow convention, not the number of sessions, experiments or verified
functions. Commit counts remain supporting research rather than article
headlines.

## Milestone records

### TH08

Start: [001bf3e9](https://github.com/N0zoM1z0/th08/commit/001bf3e9c91cc35b79c7a0e36b3565b86f494362) at 2026-08-13T02:23:48Z.

| Checkpoint                                                                                   | UTC timestamp        | Elapsed days | Recorded milestone                                               |
| -------------------------------------------------------------------------------------------- | -------------------- | -----------: | ---------------------------------------------------------------- |
| [15caba73](https://github.com/N0zoM1z0/th08/commit/15caba73df6735fc44eac4783bc61b8d098ea830) | 2026-08-19T12:19:33Z |         6.41 | Restore clean authored build baseline                            |
| [da07b21c](https://github.com/N0zoM1z0/th08/commit/da07b21c8cb63230142b0a66228d6aac66555f3f) | 2026-08-24T10:43:33Z |        11.35 | Add playable Linux reconstruction port                           |
| [529eb1a3](https://github.com/N0zoM1z0/th08/commit/529eb1a3afa05ae36467731eaccb12e3e50e132f) | 2026-08-26T05:12:23Z |        13.12 | Link the playable TH08 Web edition                               |
| [5d314e21](https://github.com/N0zoM1z0/th08/commit/5d314e21ec725a0de7a38b7c735f683ad358e79f) | 2026-08-30T10:30:16Z |        17.34 | docs: publish native Linux 64-bit release                        |
| [bd1bae44](https://github.com/N0zoM1z0/th08/commit/bd1bae444803adfa1fc865bfe64415e9951945e6) | 2026-08-26T15:59:04Z |        13.57 | semantic: recover GameManager state and exact title registration |

### TH095

Start: [8c31e6f8](https://github.com/N0zoM1z0/th095/commit/8c31e6f892d945423b7f7b439747a2bd915f82d8) at 2026-08-29T07:49:20Z.

| Checkpoint                                                                                    | UTC timestamp        | Elapsed days | Recorded milestone                       |
| --------------------------------------------------------------------------------------------- | -------------------- | -----------: | ---------------------------------------- |
| [0fa857fb](https://github.com/N0zoM1z0/th095/commit/0fa857fb2b2ec6237732e4d6be8d0a28069c9330) | 2026-09-07T05:23:52Z |         8.90 | gpt-web: match enemy movement exactly    |
| [74baddfc](https://github.com/N0zoM1z0/th095/commit/74baddfccb712d1311a4d6e7487a63cd1100452e) | 2026-09-08T09:19:45Z |        10.06 | Match final ANM x87 draw functions       |
| [33d46a0e](https://github.com/N0zoM1z0/th095/commit/33d46a0ee48f37060d973125a1a7632a40f8d998) | 2026-09-09T11:15:00Z |        11.14 | build: complete whole-program linkage    |
| [3442dcf2](https://github.com/N0zoM1z0/th095/commit/3442dcf29d9e0b5bef384a49bd0c9ad32a711826) | 2026-09-10T07:07:28Z |        11.97 | Mark the Windows reconstruction playable |

### TH04

Start: [f402cb30](https://github.com/N0zoM1z0/th04/commit/f402cb30b7e795ea4328b6de794e9eefc52c97b3) at 2026-09-06T09:54:05Z.

| Checkpoint                                                                                   | UTC timestamp        | Elapsed days | Recorded milestone                                              |
| -------------------------------------------------------------------------------------------- | -------------------- | -----------: | --------------------------------------------------------------- |
| [1cd1a257](https://github.com/N0zoM1z0/th04/commit/1cd1a2577a3dbf4c17ac7a939faed5eeb81a6ebf) | 2026-09-26T21:16:40Z |        20.47 | gpt-web: accept MAIN SND_LOAD                                   |
| [4b6a57f8](https://github.com/N0zoM1z0/th04/commit/4b6a57f8c0625da07c38258b78f5f205aae92805) | 2026-10-02T07:44:53Z |        25.91 | gpt-6.1-sol: build four native products and restore DOS handoff |

## What the milestones establish

- **TH08:** the 19 August progress ledger records 1,107 / 1,107 authored
  functions with source. The 24 August change introduces a playable Linux
  reconstruction port; the 30 August GitHub release publishes the 64-bit Linux
  product. The 26 August exact ledger records 1,106 / 1,107 accepted functions.
- **TH095:** the initial ledger records zero confirmed/source-present authored
  functions. The 7 September ledger records 697 source-present mappings;
  8 September records 696 exact functions out of 697 confirmed authored
  functions. The 10 September checkpoint marks the Windows i386 reconstruction
  playable and documents the exercised startup, gameplay and transition paths.
  The remaining `Controller::GetInput` comparison is separate from playability.
- **TH04:** the 26 September ledger records 661 exact functions out of 663
  reviewed authored candidates across OP, MAIN, MAINE and ZUN. MAIN's byte
  denominator covers its reviewed authored extents; other artifacts use decoded
  comparisons. The 2 October checkpoint builds four standalone DOS products.
  Runtime work and a modern x64 product have their own milestones; a four-product
  build is not a whole-game runtime result.

TH08's playable ports preceded later historical-platform runtime audits. The
Factory's current recommended order reflects lessons learned across those
projects; do not present that later recommendation as a process applied
perfectly from the beginning.

## Editorial scope

The article follows the author's change in perspective: previous manual RE,
starting agent-driven work in August 2026, TH08's continuation, TH095's reuse of
experience, and TH04's application of the method to another architecture. The
manual-RE background and August starting point are author-provided experience.
The industrial-era conclusion and the interpretation of the two contribution
models are the author's argument, supported by the described project record.
They are not a measured agent-versus-human performance ratio.

Engine APIs, compiler flags, addresses and ledger schemas remain in references.
The full essay replaces the outline and removes its `noindex` directive; the
generated sitemap includes the article. The author approved publication on
10 October 2026, and the review labels were removed from the article and Blog hub.

## GensokyoClub quotation and policy

The public README was read with `gh api` on 10 October 2026. Its latest
README-changing commit is
[`e874b98e`](https://github.com/GensokyoClub/th08/blob/e874b98e210b3be1ed21c5e03d54b883eac5069c/README.md#important-notice),
dated 6 September. The notice announces a decision effective 5 September and
describes concerns about AI decompilations, ports, attribution and their effect
on the maintainers. Its stated plan is private development until completion.

The article quotes 23 words from the passage's opening clause, followed by an
ellipsis; it paraphrases the remaining point about the psychological toll.
The excerpt was checked against the retrieved original, with whitespace
normalized for display. The linked notice supplies its context.

The current public head is
[`f345c7de`](https://github.com/GensokyoClub/th08/tree/f345c7dee07b849f2ff93a0029ab5ede126bf12c).
Its [contribution policy](https://github.com/GensokyoClub/th08/blob/f345c7dee07b849f2ff93a0029ab5ede126bf12c/CODE_OF_CONDUCT.md)
excludes PRs created primarily using AI. The article paraphrases this policy
and discusses the different contribution models. It preserves GensokyoClub's
credit, describes the author's own manual and agent workflows, and does not
assign motives beyond what the public notice states.

## TH04's current DOS and 64-bit phases

The latest public main checkpoint checked for this revision is
[`bb9faca5`](https://github.com/N0zoM1z0/th04/blob/bb9faca54e2eb3c0d6c757c75d59ac29d2cd5e93/docs/RE_HANDOFF.md),
dated 10 October 2026. Its handoff records the standalone DOS products,
repaired normal and invincible variants, and the user's manual Windows
observations of complete Normal routes, endings and saves. It identifies
resumed x64 work as the current phase on the separate `port/modern-64` branch.
That branch was publicly present at `1ffc53a61e1e82409adb40c7658d4ee2f3a21916`
when inspected with `gh`.

The essay's first-person DOS testing statement describes those maintainer
observations, also confirmed by the author in this revision request. It is
not attributed to a new automated website test or a fresh runtime replay.
The 64-bit port is described as in development. The earlier four-product build
and function-count milestones retain their historical scopes.

## Autonomy, oracles and the compounding flywheel

The author's requested revision emphasizes two principles: agents have broad
autonomy to investigate, and their hypotheses are tested by oracles with concrete
references and explicit acceptance conditions. These ideas are developed in the
Factory's agent-autonomy and semantic-reconstruction documents listed above.
An oracle result supports the property and inputs actually checked; the essay
retains human responsibility for project milestones and release decisions.

The flywheel is an explanatory model of this relationship. Its passing branch
retains a checked result and its evidence; a mismatch returns to investigation.
Code, checks and recorded lessons improve the next starting point, with TH08,
TH095 and TH04 illustrating knowledge carried between projects. It does not
depict a measured performance ratio or give REA sole credit for reconstruction.

The first inline reference to GensokyoClub's public README links to the author's
selected [Internet Archive capture](https://web.archive.org/web/20260909051514/https://github.com/GensokyoClub/th08#important-notice).
The pinned source caption and 23-word excerpt retain their original provenance.
The author approved this revision for publication on 10 October 2026.

## TH08's floating-literal oracle failure

The author recalled a floating-point comparison bug. The source history and
public GitHub record identify it as a reference-data verification gap, rather
than a rounding-tolerance problem. The original Japanese TH08 1.00d executable
uses double `128.0` in the power arm of `ItemManager::OnUpdate`'s item-attraction
condition. The reconstructed source used `0.0`.

- [Issue #10](https://github.com/N0zoM1z0/th08/issues/10), opened on 2 September
  2026, records the downstream Switch-port report, the target instructions and
  the constant bytes. Normal power is non-negative, so the erroneous power arm
  was effectively unconditional after crossing the collection line. Focus and
  shot-type exceptions were separate, correct arms of the condition.
- [PR #11](https://github.com/N0zoM1z0/th08/pull/11), merged on 2 September,
  contains commit
  [`7148a76b`](https://github.com/N0zoM1z0/th08/commit/7148a76ba224742677895c7160807a68897957d5).
  It changes the threshold from `0.0` to `128.0`, fixes the manifest literal
  identity, and adds source-symbol/declared-data/target-data checks for
  explicitly recorded floating literals.
- [PR #13](https://github.com/N0zoM1z0/th08/pull/13), merged the same day,
  contains commit
  [`a393f400`](https://github.com/N0zoM1z0/th08/commit/a393f400786e4cc6cbb1000af0dad3276da12c78).
  It audits 1,548 configured floating-literal references, corrects twelve more
  stale references across five accepted functions, and makes verification
  automatic for every 32-bit or 64-bit `__real@...` relocation. Its tests include
  deliberately invalid literal declarations and representations.

The older comparison replayed the target address into the instruction's
relocation field, then compared instruction bytes without checking the
floating-literal data at that address. Source `0.0` could therefore appear
exact against target `128.0`. The essay explains this mechanism in ordinary
language and keeps implementation details in the linked record. The count is
of references, not distinct values or new functions.

The website work reexamined the historical diffs and retrieved the issue and
PR metadata with `gh`; it did not rerun the game's historical compiler or
runtime. The author supplies the first-person lesson about working as one
human with agents and about responsibility for oracle quality.

## Readability and the learned phase order

The semantic discussion is based on the author's requested explanation,
[TH08's semantic playbook](https://github.com/N0zoM1z0/th08/blob/d2a00f4acb4a13916e07a00bd13f714961714628/docs/SEMANTIC_PLAYBOOK.md),
and the Factory's
[semantic-reconstruction workflow](https://github.com/N0zoM1z0/touhou-reconstruction-factory/blob/717e1b8560783ed17a39fdf159d30aa16bb307a7/docs/semantic-reconstruction.md).
The workflow's latest public change was checked using `gh` on 10 October.

The recommended order is an exact baseline, a working historical-platform
product, semantic reconstruction with both validation paths, then portable
products. The original target/compiler comparisons and the historical
build/runtime checks answer different questions. Both are preserved during
semantic work. Names, ownership and protocol interpretations also need
producer/consumer evidence; a passing check does not establish their English
meaning. Modern ports compare behavior with the established historical build
without requiring the new architecture's machine code to match the old one.

This is a method learned from the projects. TH08's earlier portable releases
preceded some later historical-platform audits. The essay states that history
explicitly rather than presenting the current order as the original chronology.
The game-RE background and the assembly/raw-offset aside are author-provided
perspective. Transfer to other fields is a proposal to carry the principles
while choosing references appropriate to the new domain.

## Industrial analogy: instruments develop with machines

The [Science Museum Group's steam-engine indicator record](https://collection.sciencemuseumgroup.org.uk/objects/co51439/watts-steam-engine-indicator),
read on 10 October 2026, describes Boulton and Watt's introduction of the
instrument in 1796 to assist with valve adjustment. It also explains how adding
a pencil and moving paper made cylinder pressure through the stroke recordable.
The essay paraphrases this description and links it directly. It does not use
the record's images, quote its text, or date the displayed object or pressure
diagram to 1796.

The connection to reconstruction tools is the author's analogy: rapid
execution needs measurement, and the instruments themselves require improvement.
The claim that this is an early industrial stage is the essay's interpretation
of the project experience. The historical example supports the measurement
comparison rather than a measured prediction about AI productivity.

## Prose revision

The later prose pass reduces repeated enumerations and develops each lesson
through its project example. It preserves the milestone figures, quotation,
source links and four-stage method. The two author-selected emphasized sentences
retain their wording.

The opening takeaway now uses five bullets: agent autonomy, repository/Git
memory, evidence and explicit unknowns, testing the oracle, and the early stage
of the industrial shift. Each has a direct lead and a short explanation. The
historical-build/semantic/port sequence remains in the body rather than becoming
another takeaway item.
