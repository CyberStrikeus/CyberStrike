# REA website writing and design guide

> A good website is like a good paper: easy to follow, clear and concise, with a clean, refined presentation.
>
> — N0zoM1z0

For REA, that means a concrete question, a figure that explains the process,
evidence the reader can inspect, and a useful next step. A clean, refined
appearance comes from precise wording, readable figures, consistent typography
and deliberate spacing.

Use this guide for new pages and revisions. Create the common page structure
with `python3 scripts/website.py new-page`, then reuse the relevant components
from an existing page, `public/assets/styles.css` and `public/assets/main.js`.
Keep shared regions in sync with `templates/`. Contribution, preview and
publication commands are in [README.md](README.md).

## What a reader should understand

A reader scanning for five seconds should see the subject and the result. After
ten seconds, the main figure should explain the sequence. After fifteen seconds,
the prompt or first example should show how to start.

These are reading goals, not a requirement to fit every investigation above the
fold. Keep the main path short and let readers open the supporting details.

## Write the task directly

Write the English source first. Keep translated wording just as concrete: a
reader should understand the question, the evidence and the next action without
decoding a literal translation. Preserve commands, code and recorded values.
Read a whole example together when reviewing its translation. Check headings,
figures and interactive labels at phone widths, including right-to-left editions.
The [translation guide](locales/README.md) explains the catalogs and update process.

Name the software, behavior or action in headings. Give the opening paragraph
one job: explain what the page covers. Use concrete verbs such as install, trace,
read, compare and calculate.

| General wording                                  | More useful wording                                                |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Start with a question.                           | Set up REA.                                                        |
| Follow a feature across the app.                 | Trace an Electron CSV export.                                      |
| Following a copy through Notion.                 | How Notion copies text and HTML.                                   |
| A position becomes a sound.                      | Calculate left/right sound panning.                                |
| Follow the investigation.                        | REA case studies.                                                  |
| Reviewed boundary / source owner / target extent | The helper / its surrounding code / the code section being checked |

Questions also work when they name a behavior: “Where is the CSV created?” and
“How does a copied block keep its structure?” give the reader something specific
to look for.

Explain necessary terms where they first matter. An IPC channel can be described
as a named message between Electron processes. Keep exact API names, addresses
and JSON paths in the code or result they identify.

Give each paragraph new information. A diagram can summarize a sequence, while
the code below explains individual steps. Repeating that REA supplies
instructions, callers and constants in several surrounding paragraphs adds no
new step. Explain that role once, then show the results.

Use captions for useful context: which values are illustrative, where an excerpt
comes from, or what a check covers. Scope a claim positively and precisely:
“The compiled function matches 63 bytes” is more useful than a broad claim
followed by several qualifications.

Search titles and sharing previews follow this standard too. Name the software
or task so someone can understand the page before opening it. Keep titles and
descriptions accurate and concise; use technical terms when they identify the
actual topic. Preserve a clear visible headline rather than repeating search
terms throughout the page. See [README.md](README.md#search-and-sharing-metadata)
for canonical URLs, automatic sitemap generation and sharing assets.

## Build a page around one question

### Introductions and first exercises

Explain reverse engineering with a familiar behavior. Pair a short, authentic
code excerpt with readable logic and a figure that explains the result without
requiring the reader to understand either language. Show a simple agent prompt
and the specific facts REA supplies to answer it.

Put compact setup at the beginning of the homepage: a copyable installation
prompt, with the terminal command and platform options in open native disclosures.
Keep the setup-guide link visible. Then explain what reverse engineering
means and what it lets someone do, before the worked examples.
Begin each example with its goal and the reason to inspect that program.
Name the actual evidence REA returned and what the agent did with it.
Give long pages a short table of contents with concrete section names. Preserve
the reading width: the homepage uses the side gutter when it has room,
and a collapsible sticky menu after the opening section on smaller screens. Highlight the current
section, keep fragment links usable without JavaScript, and leave room above
the destination for the sticky control. Make Get started the primary opening
action. Give RL environments, Showcases and Blog their own row of links and
short descriptions below the introduction and setup. Use equal columns for
the introduction and setup on large screens, then stack them before either
column becomes cramped.
Use a short introduction and one three-step overview before the examples.
Let introductory prose wrap naturally across the container, independently of
the narrower heading width. Add a brief transition before the worked examples.
Present each example in the same reading order: the question, the rule found
in the program, then a reconstruction to try. Use plain language in that path;
keep original code, source details and verification in the disclosure below it.
Prefer ordinary paragraphs to repeated goal, finding and role panels. Reserve
bold text and blue highlights for a meaningful code selection or action, not
every takeaway. Keep source, interpretation and new code attributed to their
respective roles. On mobile, the demo can precede its supporting code once its
purpose is clear. Show the full Calculator manual/agent comparison by default,
using an open native disclosure so readers can collapse it. Keep supporting
verification flows in closed disclosures. Retain the
authored examples, source excerpts, investigation steps and useful prompts when
reordering the page. Opening an investigation should reveal its explanation
and code without another layer of hidden analysis.
Keep FAQ, community help and issue reports on separate lines. Describe what
each destination is for so readers can choose the right one.
Show how the reader's task changes using the same question on both sides of a
manual/agent comparison. Let returned evidence make REA's contribution visible.
When showing manual analysis, use authentic instructions and specific analyst
questions: what a command ID means, which call performs arithmetic, or which
operand enters a calculation. Numbered selections can connect the code to
illustrative thought bubbles. Keep the agent side brief: one visible prompt,
a concrete answer, and the evidence used to reach it.

When a small reconstruction makes the finding tangible, let readers change an
input or setting and try the result. Connect inspection, recovered logic,
reconstruction and the new experiment. Keep the recovered rule distinct from
new teaching mechanics, and check it against the inspected program.

Offer a supplied target for the next step. A first exercise should take the reader through
setup, a question, an answer with source references, one prediction they can
check, and a follow-up. Introduce specialized prerequisites when the chosen
target requires them.

### Guides

1. Name the task and introduce a small example.
2. Show a short flow of the relevant files, calls or observations.
3. Provide a copyable agent prompt and its prerequisites.
4. Explain the important code or returned fields.
5. Let the reader try the example, with a command or one ZIP download.
6. State the expected result and where to find it.
7. Offer a specific follow-up question or another relevant guide.

A command should work after the steps immediately before it. Use `npx` for a
first CLI query when global installation is optional. Browser examples should
open the hosted fixture by default; a local URL needs a server-start step. Keep
target paths, debugging endpoints and other required inputs explicit.

### Case studies

1. Introduce the project and the particular feature being examined.
2. Show a figure that explains the investigation or behavior.
3. Give a short example prompt.
4. Pair important REA queries with selected returned evidence.
5. Connect that evidence to readable source or an explanation.
6. Explain how the result was checked.
7. Link the reconstruction repository and supporting sources.

Show REA's useful contribution through a concrete finding: a missing stack
argument, a caller, bytes behind a constant, or source ranges in a packaged
bundle. Explain what the agent does with that finding. Credit source
interpretation, reconstruction and external checks to the work that performed
them.

Keep a second investigation optional. Notion's clipboard path is the main
story; Markdown tables and SQLite are additional examples. Native `<details>`
keeps them available without interrupting the first question.

Keep the explanation on the website. Repository links provide source,
reproduction instructions and further evidence. Use specific links for those
purposes, and immutable commit links for checkpoint-dependent facts.

### Method articles in the Blog

Use longer articles to explain methods, choices and ideas through project
experience. Open with a clear takeaway. A personal essay can follow how the
author's understanding changed, using concrete episodes to develop a deeper
argument. Keep the reasoning easy to follow; a Blog article does not need to
become a tutorial. Figures are optional. Add one when it explains something
useful rather than repeating a familiar opening flow.

Choose cases that teach different decisions. For example, TH08 illustrates
continuing existing work, TH095 illustrates reusing an established method in a
new project, and TH04 illustrates adapting checks to an older platform. Close
each case with the lesson the reader can apply. Put dates and progress figures
beside the milestone they measure, with pinned evidence links in supporting
details. Calendar time, source presence, exact comparison, build success and
runtime checks each describe a different result.

Make an analogy concrete. The industrial analogy can connect agent execution,
quality checks, durable knowledge and a change in how work is organized. Explain
what changes and support the argument with experience. Keep necessary terms
plain and leave engine inventories in references. A method guide can finish with
a first task; an essay can finish with the implications of its argument.

When discussing another project's approach, preserve its credit and contribution
history. Attribute quotations, link their context and distinguish the author's
interpretation from the other project's stated position. Describe the technical
or contribution-model disagreement without assigning motives to its authors.
Working outlines should be visibly labeled and marked `noindex` until they
become finished articles.

## Make figures explain a relationship

Each figure should answer a question that a reader can name. Choose the visual
form that fits it:

| Relationship                              | Existing example                         | Useful form                                                      |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Analysis and verification steps           | DX-Ball sound pan                        | Flow with separate verification branches                         |
| Code across process boundaries            | Electron CSV export and Notion clipboard | HTML flow with APIs and channel names                            |
| A mathematical transformation             | TH04's fixed and aimed rings             | SVG drawn from the angle formula                                 |
| Original instructions and readable source | DX-Ball and TH04                         | Selectable HTML code with matching step highlights               |
| A request caused by an action             | Notes browser export                     | Flow, observed result table and script excerpt                   |
| Recovered behavior and a new experiment   | Dinosaur speed reconstruction            | Inspected code, playable demo and original-result check          |
| Time blocks and changing output           | Aegis login-code reconstruction          | Adjustable clock, block number and code beside recovered methods |

Use SVG or semantic HTML for diagrams with exact text, numbers and arrows.
Generated illustrations can help explore a layout, but the published labels,
relationships and values need to be checked. [figures.md](figures.md) records the
existing assets and original layout references.

Keep labels short, align related nodes, and give arrows an explicit direction.
Use color to identify the relevant operation or connection. Add a legend when
the visual encoding needs one. Avoid making the diagram repeat the entire page.

State illustrative inputs in the caption. TH04's diagram uses a count of 16 and
a player direction of 40; its dots are calculated from those values. Give an
image useful alternative text, and keep source code as selectable HTML.

On small screens, HTML flows stack. A wide SVG can have its own horizontal scroll
and an “Open figure” link. A diagram should remain readable at its intended
display size; scaling small labels down is not a mobile layout.

## Use the existing visual system

The shared stylesheet defines the site. Its core colors are:

| Token      | Light     | Dark      | Use                              |
| ---------- | --------- | --------- | -------------------------------- |
| `--page`   | `#ffffff` | `#1e1e2e` | Page background                  |
| `--ink`    | `#20252b` | `#cdd6f4` | Main text                        |
| `--muted`  | `#5b6570` | `#a6adc8` | Secondary text                   |
| `--line`   | `#e0e5e9` | `#45475a` | Section and component boundaries |
| `--soft`   | `#f4f6f8` | `#181825` | Code and supporting surfaces     |
| `--accent` | `#294f82` | `#89b4fa` | Links and meaningful highlights  |

The header's sun/moon button switches between light and dark. On the first visit,
the site follows the system preference; a manual choice is saved for later visits
and shared across pages and languages on that host. Without JavaScript, the site
uses the light palette and hides the switch.

`assets/theme.js` applies the choice before styles load and owns theme changes.
The stylesheet scopes the dark palette to `data-theme="dark"` on the root,
using [Catppuccin Mocha](https://github.com/catppuccin/palette) colors (MIT).
Any new fixed color needs a dark counterpart in that section. Keep selector
specificity unchanged with `:where()` when scoping component rules.
Embedded SVGs inherit the page's `color-scheme`; canvas demos listen for
`website-theme-change` to redraw. Check both themes, including a manual choice
that differs from the system preference.

Use the system sans-serif stack for prose and the shared monospace stack for
code. Korean editions use Noto Sans KR from Google Fonts, with local Korean
fonts as fallbacks; code retains the shared monospace fonts for Latin glyphs.
The homepage content container is at most 1200px wide. Other pages use 1080px,
with article text limited to 760px. The header has its own 1320px container.
Keep its primary navigation to Get started, Showcases, Blog and Guides, with
FAQ and Contributors in the footer. Utility controls have quiet borders and
clear hover and keyboard focus states. At 1100px and below, navigation moves
to a separate row and the homepage introduction and setup stack. Reuse the
existing heading sizes, line heights, section spacing and component classes.

Whitespace separates ideas. Thin rules identify sections. Headings establish
hierarchy. The blue accent identifies something useful. Keep these elements
consistent rather than adding a new treatment for each page. Decorative
gradients, large shadows and scroll effects do not help explain the examples.

Agent terminals contain short, copyable prompts. Use the existing continuous
cursor animation and reduced-motion behavior. Label an example prompt as an
example; a real recorded result belongs in an evidence block. Copy buttons
should copy only the intended text, without the prompt symbol or cursor.

Include the shared `↑ Top` link on reading pages, with `id="top"` on the body.
Keep its 44px minimum touch height, safe-area spacing and keyboard focus return.
Use the shared script for visibility and reduced-motion behavior.

Use `minmax(0, 1fr)` for grid tracks that contain long commands or nested panels.
Allow code blocks to scroll within their own area. Check expanded details as
well as the default page. Document-level horizontal scrolling usually means a
component needs a width constraint; hiding it can conceal content.

## Keep evidence accurate and public

Preserve target identity, source locations, relevant versions and the scope of
checks. Keep observations, interpretation and unknowns distinguishable in plain
language. Put lengthy provenance in an evidence document or collapsed details.

Label simplified source and selected instruction excerpts. When compiler checks
apply to the maintained project source, say so; a readable summary is a separate
presentation of the calculation. Historical checks and a fresh REA inspection
retain their own dates and attribution.

Use generic example data and display paths. Machine paths, personal account
identifiers, credentials, local configuration, full vendor bundles and raw
captures belong outside the public website. If a path is shortened in a displayed
query, identify that in its caption and keep the original capture separately.

## Review and publish

Before merging a change:

- Read the default page in order. Check that every section advances the task.
- Open details and confirm that sources and extra examples remain usable.
- Verify commands, prerequisites, expected results and downloadable files.
- Keep links and asset paths working at both `/` and `/rea/`.
- Check desktop, intermediate and mobile widths, including 320px.
- Check copying, downloads, code-step selection, keyboard access and reduced
  motion. Core content and native details should work without JavaScript.
- Confirm that figures and code excerpts agree with the supporting evidence.
- Run site preparation, verification and formatting checks.

Match verification to the change. Copy edits need page and interaction checks.
New analysis or behavior claims need the real evidence that supports them; a mock
or a page-loading check cannot establish those claims.

Follow the PR review and CI process, then publish using the existing manual
`website-pages.yml` workflow on `main`. Its default `both` target publishes the
same verified artifact to Cloudflare and GitHub Pages and checks both published
commit markers. Use `pages` only for an explicitly requested publication while
Cloudflare credentials are being configured.
Ordinary commits should not publish the site. After deployment, check both live
pages and confirm they match the reviewed version. The legacy VitePress build
remains separate from the Pages publisher.
