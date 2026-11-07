# REA website

> A good website is like a good paper: easy to follow, clear and concise, with a clean, refined presentation.
>
> — N0zoM1z0

An English website with translated editions in every README language, explanatory
figures, worked guides and Aegis, DX-Ball, Notion, TH04 and CTF investigations.
English sources are in `website/public/`; translations are standard gettext PO
catalogs in `website/locales/`. The site uses HTML, CSS and small
scripts for copying code, following code comparisons and playing the dinosaur
speed reconstruction. Small Python commands maintain shared HTML, prepare
downloads and check the site. There is no frontend framework, bundler or npm
dependency. A build generates all editions in `website/_site/`. The resulting
files work as ordinary static files; language switching needs no JavaScript.

Korean editions load the variable Noto Sans KR webfont through Google Fonts
(`fonts.googleapis.com` and `fonts.gstatic.com`) so the preferred Korean font
does not depend on fonts installed on the reader's PC. Other editions keep
system fonts. Text remains visible while the font loads (`display=swap`), and
local Korean fonts are used if Google Fonts is unavailable. The stylesheet is
added during translation rendering; generated `_site/` pages are not authored.

[style-guide.md](style-guide.md) explains the writing, page structure, figures,
visual system and review process. Read it before adding or revising a page.

## Local preview

From the repository root:

```sh
python3 -m venv website/.venv
source website/.venv/bin/activate
python3 -m pip install -r website/requirements.txt
python3 scripts/website.py serve
```

Open <http://127.0.0.1:4173/>. Refresh the browser after editing a file.
After editing source HTML or a catalog, run `python3 scripts/prepare-website.py`
to rebuild the preview. `serve` prepares the site once when it starts.
Keep the virtual environment active when preparing assets. CairoSVG needs the
native Cairo library; the sharing card uses DejaVu Sans. On Debian or Ubuntu,
install them with `sudo apt-get install libcairo2 fonts-dejavu-core`. On an
Apple Silicon Mac, enter an ARM shell first with `/usr/bin/arch -arm64 /bin/zsh`. Install
the ARM build with `/opt/homebrew/bin/brew install cairo pkg-config`. Install
the sharing-card font with `/opt/homebrew/bin/brew install --cask font-dejavu`.
The card in `public/assets/social-card.svg` requests DejaVu Sans, so Cairo output
uses a fallback font without it. Verify with `fc-match "DejaVu Sans"`. The result
should name DejaVu. A plain
`brew` call can select the Intel brew when `/usr/local/bin` comes first or the
terminal runs under Rosetta. Check that
`/opt/homebrew/lib/libcairo.dylib` reports `arm64`. An old Intel build in
`/usr/local/lib` shadows the ARM build. The preview then fails with
`incompatible architecture (have 'x86_64', need 'arm64')`. Keep
`/usr/local/lib` intact. Do not move its files and do not link ARM files into
it. That breaks Intel programs that use the same names. Use an unprotected ARM
Python, not Apple `/usr/bin/python3`. A venv from the Apple interpreter stays
protected and purges `DYLD` at launch. Deactivate any active venv, confirm the
shell reports `arm64`, then recreate the venv with the ARM interpreter by its
full path:

```sh
deactivate || true
/usr/bin/arch
/opt/homebrew/bin/brew install python3
/opt/homebrew/bin/python3 -m venv website/.venv --clear
source website/.venv/bin/activate
python3 -m pip install -r website/requirements.txt
```

A rebuilt venv is empty
without this step. Export `DYLD_LIBRARY_PATH=/opt/homebrew/lib` and
`DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib` inside the ARM shell. Verify
with `python3 -c "import ctypes.util;
print(ctypes.util.find_library('cairo'))"`. The result should point at
`/opt/homebrew`. Run the preview from that same shell with
`python3 scripts/website.py serve` and no `arch` prefix. A `DYLD` export
before `arch` gets purged and the preview fails again. For other systems, see
[CairoSVG's installation instructions](https://cairosvg.org/documentation/#installation).
CI installs both packages explicitly before rendering the card.

To test the GitHub Pages prefix, use
`python3 scripts/website.py serve --port 4174 --base-path /rea/` and open
<http://127.0.0.1:4174/rea/>.

## Contribute a page or correction

Edit the page's HTML in `public/`. Keep the question, evidence and result easy to
follow. The writing and design guidance in [style-guide.md](style-guide.md)
applies to every page.

| Change                          | Edit                                                             | Then run                                        |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Page text, examples or figures  | The page's HTML outside the marked shared regions                | `python3 scripts/website.py check`              |
| Search title or description     | The page's `<title>` and first description meta tag              | `python3 scripts/website.py sync`, then `check` |
| Main navigation                 | `NAVIGATION` in `scripts/website.py`                             | `sync`, then `check`                            |
| Header, social links or footer  | `templates/header.html.tmpl` or `templates/footer.html.tmpl`     | `sync`, then `check`                            |
| Theme loading and browser color | `templates/theme.html.tmpl` and `public/assets/theme.js`         | `sync`, then `check`                            |
| Shared link previews            | `templates/sharing.html.tmpl` or `public/assets/social-card.svg` | `sync`, then `check`                            |
| Translation                     | `locales/<language>/messages.po`                                 | `translations check`, then `check`              |

After changing English text, run `python3 scripts/website.py translations extract`
before `check`. Existing translations and reviewer comments survive extraction;
new or changed sentences need updated translations. See
[the translation guide](locales/README.md) for the editing workflow, terminology
and the handling of pages whose translations are being updated. Never edit
generated HTML in `_site/`.

Create a reading page with:

```sh
python3 scripts/website.py new-page blog/my-article \
  --title "My article title" \
  --description "One sentence explaining the article."
```

The command creates `public/blog/my-article/index.html` with the correct relative
paths, navigation and sharing metadata. It starts as a visible draft with
`noindex`. Write the article, add its link to the Blog index, then remove the
Draft label and robots meta tag when it is ready. The same command accepts
routes under `guides/` and `showcase/`. New pages still need their own content;
the scaffold supplies the common structure.

The regions marked `website:sharing`, `website:header` and `website:footer` are
generated from the templates. Edit the template rather than a generated copy.
The `.html.tmpl` partials own their generated whitespace; HTML formatter-ignore
comments keep the repository formatter from changing those regions. Their
content is checked by `sync --check`, while ordinary page content stays subject
to the repository formatter.
`sync` updates only those regions; page bodies, figures and scripts remain
authored HTML. Commit the updated pages alongside the template. Titles and
descriptions are written once per page; their sharing fields are derived from
them. Routes come from file paths, including the sitemap, so there is no second
page list to register.

Before opening a PR:

```sh
python3 scripts/website.py check
```

This checks shared HTML and translation sources without rewriting them, prepares
all language editions and generated assets, and
checks page links, copied-text targets, repository documentation links, SEO
metadata and the publishing configuration. It also runs the maintenance
regressions. A stale shared region fails with the command needed to fix it.
PR checks and the manual publisher run this same command. The checks work
offline after the Python dependencies are installed.

For an optional external-link audit, with GitHub CLI available:

```sh
python3 scripts/website.py links --report /tmp/rea-website-links.json
```

GitHub source links are checked through `gh`, including pinned commits and
branch names containing slashes. Other external links use HTTP. Missing targets
fail the command; access denials, timeouts and GitHub UI routes are reported as
unknown and need manual verification. External fragment IDs are not checked.
This network audit runs separately so third-party uptime does not block every PR.
Keep its report outside public assets.

Links are only part of a content review. When updating setup or support claims,
compare them with [installation.md](../docs/installation.md), the relevant
provider guide and the released package. A case study's pinned version and date
describe its recorded investigation; update them only when repeating that work.

## Pages

- `public/index.html`: introduction and compact setup, a three-step overview, dinosaur and Calculator examples, case studies and analysis-guide links. Code-level comparisons and checks are optional disclosures.
- `public/examples/dino-lab/index.html`: adjustable-speed mini-game, recovered rule, original-game check and browser analysis steps.
- `public/first-investigation/index.html`: a guided Notes export investigation, from setup to a checked CSV prediction.
- `public/showcase/index.html`: the case-study index.
- `public/blog/index.html`: articles about reconstruction methods, ports, mods and reverse engineering.
- `public/blog/touhou-reconstruction/index.html`: a personal essay about agent autonomy, oracle quality, knowledge carried between TH08 and TH095, PC-98 TH04, and the path from exact reconstruction to readable source and modern ports.
- `public/blog/reverse-engineering-models/index.html`: an essay on general models, compiler specialization and learning useful reconstruction experiments, with historical evidence from TH08, TH095, TH04 and TH09. Model attribution and verification scope are in [evidence/reverse-engineering-models.md](evidence/reverse-engineering-models.md).
- `public/showcase/aegis/index.html`: Aegis's Android login-code calculation, with an adjustable clock and reference checks.
- `public/showcase/dx-ball/index.html`: sound-pan investigation and project status.
- `public/showcase/notion/index.html`: Notion's Electron clipboard bridge and rich clipboard format.
- `public/showcase/th04/index.html`: TH04's 16-bit DOS bullet-angle calculation and compiler checks.
- `public/showcase/ctf/index.html`: DownUnderCTF's masked-squares flag checker, extracted equations and real process captures.
- `public/get-started/index.html`: agent setup, first CLI result and provider guides.
- `public/faq/index.html`: concise answers about setup, updates, analysis and troubleshooting.
- `public/contributors/index.html`: one searchable, alphabetical grid of GitHub contributors, with profile links and contribution guidance.
- `public/guides/`: a guide hub and native, JavaScript/Electron and browser examples.
- `public/guides/rl-environments/index.html`: recording a web app, exporting a runnable environment, and adding tasks and reward checks.
- `public/examples/`: downloadable Electron source and an interactive Notes browser app.
- `public/assets/`: shared styles, interactions, favicon and explanatory figures.

Navigation and assets use relative paths, so the same files work at the local
root and a GitHub Pages project path such as `/rea/`.

### Update contributors

`public/contributors/people.json` is a dated snapshot of the repository's public
GitHub contributor list, including accounts GitHub identifies as bots. Every
profile has the same presentation; there are no team tiers or contribution
rankings. The page links the source list and shows the snapshot date. Avatars
load from GitHub; usernames and profile links remain usable without images or
JavaScript. Search is a small progressive enhancement.

Refresh the snapshot with GitHub CLI available, then regenerate the marked
`website:contributors` region from `templates/contributors.html.tmpl`:

```sh
python3 scripts/website.py contributors
python3 scripts/website.py sync
python3 scripts/website.py translations extract
python3 scripts/website.py check
```

Refresh fetches every API page and validates the complete result before replacing
the snapshot. Review and commit the JSON, rendered page and catalog updates
together. Builds and offline checks use that snapshot, not the live API.

## Search and sharing metadata

`https://rea.tools/` is the preferred public origin. Each content page has one
absolute canonical URL for its own route, including its trailing slash. The
same HTML on GitHub Pages points to the corresponding rea.tools page. Ordinary
navigation and asset references remain relative so both hosts and local previews
keep working.

Maintain a descriptive `<title>` and a short meta description in each page's
`<head>`, then run `sync`. The title names the page's subject; visible headings
keep the wording that best explains it to a reader. The script derives Open
Graph and Twitter fields and the canonical from those inputs and the file's
route. Search results and link previews should follow the same clear, concise
writing standard as the page.

`scripts/prepare-website.py` renders `public/` and the PO catalogs into `_site/`,
then scans `_site/**/*.html` and generates `_site/sitemap.xml` with absolute
rea.tools URLs. An `index.html` maps to its
directory route; other HTML filenames retain their extension. Pages with
`noindex` or `none` in a head `robots` or `googlebot` meta directive are excluded.
The two Notes example applications use `noindex`; their guides and the dinosaur
lab remain indexable. Downloads, scripts and other non-HTML files are not listed.
The sitemap has no guessed modification dates, priority or change frequency.
It is ignored by Git and regenerated before checks and publication.

`public/robots.txt` allows crawling and names the canonical sitemap. Keep example
applications crawlable so search engines can read their `noindex` directives.
Cloudflare may prepend managed rules or comments to the served file; inspect the
live response after publication. The mirrored `/rea/robots.txt` is not the
hostname-root robots file for `morluto.github.io`; canonical HTML tags establish
the mirror's preference.

`public/assets/social-card.svg` is the maintained 1200 × 630 preview source.
CairoSVG generates `social-card.png` for sharing clients. Commit the SVG, not the
PNG. Both hosts receive the generated image in the same publishing artifact.
The preview uses the site's typography, palette and direct headline.

Verification checks route-specific canonicals, unique titles, descriptions,
sharing fields, image dimensions, indexing policy and complete sitemap coverage.
`scripts/test-website.py` exercises automatic route changes and rejects incorrect
canonicals, lost fixture exclusions, stale sitemap entries and missing previews.
Run it after preparing assets:

```sh
python3 scripts/website.py check
```

### After publishing an SEO change

1. Check the served `robots.txt`, `sitemap.xml`, HTML head and preview PNG at
   rea.tools. Confirm that both hosts contain the same page-specific canonicals.
2. In the domain's Google Search Console property, submit
   `https://rea.tools/sitemap.xml`.
3. Inspect the homepage, a guide and a case study. Check crawl access, indexing
   and Google's selected canonical; inspect a GitHub Pages URL as well if that
   property is available. Track indexing and search performance there afterward.

These Search Console checks require the property owner's access. Local checks
verify the website inputs; Google's indexing reports show how they were used.
See Google's [canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
and [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
and Cloudflare's [managed robots behavior](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/).

## Content

Blog articles explain methods, decisions and ideas through project experience.
Lead with a takeaway, then develop the argument through concrete examples.
An essay can explore a change in perspective without becoming a step-by-step
guide. Add a figure when it contributes a useful explanation; an opening flow
is optional. Case studies remain focused on one inspected behavior. Keep engine
details in supporting references unless they explain a relevant decision.

The Touhou article is authored in English and translated through the same catalogs. Its provenance,
quoted README passage and milestone counting rules are in
[evidence/touhou-reconstruction-method.md](evidence/touhou-reconstruction-method.md).
The completed text has normal search metadata and is included in the generated
sitemap.

Its opening flywheel connects agent autonomy, reference-based oracles and
repository memory. The essay develops those ideas through the project examples.
Figure labels are selectable HTML; inline SVG supplies the feedback arrows.

Keep the copy direct and specific. Explain the task and the result before listing
tool names. Setup commands and runtime requirements should match the released
package. Keep the core learning path inside the site. Source, issue and evidence
reference links may point to the corresponding repositories.

[evidence/guide-examples.md](evidence/guide-examples.md) records the published
REA package, example digests and observed results behind the guides. The Notes
Electron fixture is for static analysis; Electron is not a prerequisite for
following that example. The separate Notes browser app runs in the local preview
and constructs a CSV download after fetching its JSON data.

The Electron guide offers one ZIP containing the six source files under
`notes-example/`. `scripts/prepare-website.py` generates this download from
an explicit file list, with fixed timestamps and permissions. The ZIP is ignored
by Git; website checks and each manual publication regenerate it before checking
and uploading `_site/`. The verifier checks that its entries match
the current source and contain no extra files.

The first-investigation page uses this same ZIP. Its prompt lets the agent
download and unpack the target; the download button provides a manual path.
The reader follows the static export trace, then runs the CSV formatter with
one changed input. This formatter check needs only Node.js. The separate
browser Notes example has a different implementation.

Agent terminals show example prompts, not transcripts of previous
investigations. All cursors blink continuously with the same CSS animation,
respecting reduced-motion preferences. Both the prompt and animation work
without JavaScript. The homepage and agent setup section share a copyable
installation prompt; setup still presents its plan for approval.

The header's sun/moon button switches the color theme. A first visit follows the
system preference, falling back to light when no preference is given. Manual
choices are saved in browser storage under `rea-theme` and apply across pages,
language editions and tabs on the same host. If storage is blocked, the button
still works for the current page. Without JavaScript, the site stays light and
the button stays hidden.

The shared `theme` head region loads `assets/theme.js` before the stylesheet so a
saved choice applies before the first paint. That script owns the resolved
`data-theme`, browser `theme-color` and `website-theme-change` event. The CSS
palette, embedded SVGs and dinosaur canvas follow that choice. Keep the theme
region in the page scaffold and run `sync` after editing its template.

Reading pages share a small `↑ Top` link at the bottom right. It appears after
scrolling and returns to the page header, with smooth scrolling when reduced
motion is disabled. Keyboard activation returns focus to the first navigation
link. Without JavaScript, the link stays visible and uses its `#top` anchor.

The FAQ uses native `<details>` for its answers. Keep replies short and link to
on-site guides for the next step. Individual answers have stable fragment IDs;
the shared script opens an answer when its fragment is visited. The questions
and disclosure controls remain usable without JavaScript. Check FAQ commands
and support statements against the English README and relevant guides when
updating them.

DX-Ball figures and findings refer to the linked 7 October 2026 checkpoint,
commit `a55dca27ec0a07018c1b2c95ae2be027f7d8c3c4`. Update those links and figures
together when moving to another checkpoint. Case-study source excerpts come
from the MIT-licensed DX-Ball reconstruction repository.

The assembly excerpts were transcribed from the project's saved REA/Ghidra
Evidence. [evidence/dx-ball-sound-pan.md](evidence/dx-ball-sound-pan.md) records
their provenance and the scope of the validation claims. The original executable
and complete private Evidence records are not website assets.

The homepage pairs a short introduction with the installation prompt. Get
started is the primary action; a second link goes straight to the first
interactive example. The terminal command and platform options use native
disclosures that start open, and the setup-guide link stays visible. Platform links go
directly to the Windows, macOS and Linux steps in Get started; the optional
curl installer links to its on-site instructions.
RL environments, Showcases and Blog form a separate row below the introduction
and setup, with a short description for each destination. The homepage uses a
1200px content width and equal desktop columns, stacking the introduction and
setup at 1100px and below. Reading pages retain their narrower content width.
A full-width definition and three steps explain the
workflow, followed by a short transition into the dinosaur and Calculator
cases. The full Calculator manual/agent comparison is visible by default.
Each example's supporting investigation flow and verification details are folded. Plain
paragraphs introduce the cases without repeating goal and purpose panels.
Three case-study previews lead to further investigations. The closing sections
offer a guided first task and target-specific guides. FAQ, Discord and issue
links each have their own line explaining their purpose.
Every content page's header and footer link GitHub, Discord and X. The main
navigation contains Get started, Showcases, Blog and Guides. FAQ and Contributors
are in the footer. Utility controls use quiet borders with visible hover and
keyboard focus states.
A right-side table of contents stays visible at widths of 1800px and above,
with a 48px gap from the content. CSS owns this layout choice; the homepage
script reads the displayed position when opening or closing the menu.
On narrower screens it becomes a sticky, native disclosure after the opening
section; selecting a link
closes the menu and focuses the destination. The homepage script follows
the reading position and marks the current link. Without JavaScript, the
menu stays open and its fragment links remain usable.
The RL environments section pairs its explanation and guide links with a
copyable agent prompt on a contrasting surface. It follows the case studies
and stacks into reading order on small screens.
The comparison uses the same Calculator question on both sides: three
selectable manual steps pair original instructions with an analyst illustration
and thought bubbles; the agent side pairs a copyable question with an
illustrative answer. The outer disclosure starts open, showing the complete comparison with
the original desktop column proportions and the agent explanation first on
mobile. Thoughts illustrate the reasoning behind the findings. The
shared code-step script selects the initial note on load, so all three notes remain
readable when JavaScript is disabled.
The original-instruction panel stays expanded when the comparison is opened,
including on mobile; its native disclosure can still be closed manually.
Dinosaur is the first example; Calculator follows as the native example.
Each introduces the goal, then follows three named steps: ask a question,
find the rule, and try a reconstruction. The question and plain-language finding
are on the left, with the demo on the right; mobile keeps that reading order.
Code excerpts and source details join the optional investigation flow and checks
in each disclosure. Calculator's excerpt
comes from an installed model DLL; Microsoft's public implementation supplies
names and a crosscheck. Its controls apply the percentage rule to generic inputs.
The target guides end with an optional larger-project disclosure, preserving
the original website-cloning and game-reconstruction prompts.

The dinosaur example connects an inspected running script to a new playable
mini-game. `public/assets/dino-speed.js` owns the recovered speed rule and replay;
`dino-demo.js` imports it for automatic acceleration. The slider chooses a fixed
speed instead. Drawing, jumping and collision code are newly authored for this
teaching game. It starts on input, pauses when hidden or outside the viewport,
and retains a static SVG when JavaScript is disabled. The lab links the speed
module and complete game source, and replays the rule against recorded
original-game values.

[evidence/calculator-and-dino.md](evidence/calculator-and-dino.md) records both
targets, selected findings, attribution and verification scope. Update the
speed rule, game, check table and evidence together. The original script excerpt
and its BSD license are credited on the pages. Prompt responses are example
explanations based on findings.

The general investigation and DX-Ball overview diagrams are maintained as SVG source. Initial layout references were
created with the built-in image generation tool; [figures.md](figures.md) retains
their prompts and the current asset notes. Figures provide an overview;
REA requests, assembly and C remain selectable HTML text. On narrow
screens, the diagrams scroll horizontally and can also be opened at full size.
The worked guides use semantic HTML flows that stack vertically on smaller
screens. The Electron teaching example uses CommonJS, matching its preload
code; the scoped lint override admits `require` only in that example directory.

The Notion case follows the same HTML figure style. Its short excerpts explain
the packaged clipboard bridge; separate web-cache probes illustrate the rich
clipboard format, with Markdown tables available as an additional example in
collapsed details. Only selected source details and generic
example data belong on the site. Machine paths, account identifiers, local
configuration, complete vendor bundles and raw captured results stay outside
the website.
[evidence/notion-clipboard.md](evidence/notion-clipboard.md) records the REA
package version, selected findings, source anchors and module-probe scope.

## Aegis Android case study

The Aegis case inspects the official 3.4.3 APK through REA 6.1.0. It follows
the default login-code calculation from class search and display references to
the time block, keyed hash and six-digit output. Selected decompiled Java is
paired with a readable summary; the original app and excerpts are credited to
Aegis under its GPL-3.0 license.

`public/assets/aegis-otp.js` is a new teaching reconstruction using the fixed,
public RFC 6238 test key. `aegis-demo.js` connects it to the clock slider and
reference-check button. The diagram remains readable and controls stay disabled
without JavaScript. Keep the demo, selected code and
[evidence/aegis-login-code.md](evidence/aegis-login-code.md) aligned. The APK and
analysis-provider JAR remain official external downloads.

## TH04 case study

The TH04 case inspects the original PC-98 DOS angle helper through REA 4.1.0.
Its selected instructions are paired with readable C++ and a source SVG of
fixed and aimed rings. [evidence/th04-bullet-ring.md](evidence/th04-bullet-ring.md)
records the fresh load-image/function evidence and separately credited TH04
source and historical compiler replay. The figure illustrates the calculation;
original game assets and executable bytes are not website downloads.

## CTF case study

The DownUnderCTF 2023 case follows the official `ms_flag_checker` handout from
prompt references to checking functions, compressed masks, equations and an
accepted flag. [evidence/ctf-masked-squares.md](evidence/ctf-masked-squares.md)
records the REA analysis, extracted data and positive/negative process captures.
The downloadable `public/showcase/ctf/solve.py` uses Python and `z3-solver`;
its constants come from REA's byte reads. The original executable stays in the
organizers' repository and is linked from the page.

The mask SVG is drawn from the seventh decoded mask. It selects zero-based
position 21 and compares its character code with 55 (`7`). Keep the figure,
solver constants and evidence notes aligned when changing this case.

## Cloudflare Workers

`wrangler.toml` serves `website/_site/` through Workers Static Assets. There is
no Worker script or frontend framework. Before a preview or deployment, Wrangler
runs the Python scripts to build the language editions, prepare the example ZIP and verify the
website. Node.js and Python 3 must be available; the commands below use a pinned
Wrangler version without adding it to REA's package dependencies.

Cloudflare documents static-asset requests as free and unlimited, with no
additional storage cost. See [billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

### Local and hosted previews

Run these commands from the repository root. `--cwd website` makes the build
paths consistent with the website configuration. Preview locally first:

```sh
npx wrangler@4.149.0 dev --cwd website --env ""
```

If `CLOUDFLARE_API_TOKEN` is already set in your shell, Wrangler uses it for
authentication; skip `wrangler login`. If you are not using an API token, sign
in once with `npx wrangler@4.149.0 login`. See Cloudflare's
[authentication commands](https://developers.cloudflare.com/workers/wrangler/commands/general/).

To publish a preview:

```sh
npx wrangler@4.149.0 deploy --cwd website --env ""
```

This creates `rea-website-preview` at the `workers.dev` URL printed by Wrangler.
It does not attach `rea.tools`. Check the homepage, a nested guide, case studies,
the Notes browser example and the Electron ZIP at that URL.

### Connect rea.tools

Serving the custom hostname requires an
[active Cloudflare zone](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
When DNS is managed elsewhere:

1. Add `rea.tools` to your Cloudflare account and choose the Free plan.
2. Export or save the current DNS records. Review Cloudflare's imported records
   against them, including subdomains, MX and TXT records for email and domain
   verification; the automatic scan can miss records.
3. If DNSSEC is enabled, follow Cloudflare's instructions to disable it at the
   registrar before changing nameservers.
4. At the domain registrar, replace the current nameservers with the two assigned
   by Cloudflare. The domain can remain registered with the current registrar.
5. Wait for Cloudflare to report the zone as Active. Re-enable DNSSEC through
   Cloudflare afterward if required.

See Cloudflare's [nameserver setup procedure](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
for the complete migration steps. A CNAME to the preview's `workers.dev` hostname
at the current DNS provider does not configure a Workers Custom Domain.

The production environment creates or updates `rea-website`, attaches `rea.tools`, and lets Cloudflare
manage its DNS record and HTTPS certificate. Deployment can succeed while the
zone is pending; verify public HTTPS after activation and certificate issuance.
An existing CNAME at `rea.tools`
must be resolved before adding the Custom Domain. The production Worker also
retains its `workers.dev` address for direct checks. Only `rea.tools` is attached;
`www.rea.tools` is not configured by this file.

Verify <https://rea.tools/>, <https://rea.tools/guides/javascript/>,
<https://rea.tools/examples/notes-web/> and the Electron ZIP. Unknown paths return
404, and directory pages retain trailing slashes so relative assets and links
resolve correctly. The root README and browser guide use `https://rea.tools/`
as the public website URL.

Production publication uses the synchronized GitHub Actions workflow below.
Local Wrangler commands above publish only the separate preview Worker.

## Synchronized production publishing

`.github/workflows/website-pages.yml` prepares `website/_site` once and deploys
the same artifact to Cloudflare (`rea.tools`) and GitHub Pages. It is the sole
production publisher, manually triggered and restricted to `main`;
ordinary pushes and pull requests do not publish the site.

Configure these repository **Actions secrets** before publishing:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare token using the **Edit Cloudflare Workers**
  template, scoped to the website's account and zone.
- `CLOUDFLARE_ACCOUNT_ID`: that Cloudflare account's ID.

See Cloudflare's [GitHub Actions authentication instructions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
The default `both` target checks that both secrets are present before preparing
a release. Cloudflare deploys first; GitHub Pages deploys after that step succeeds.

Preparation adds `deployment.json` with the workflow's commit SHA. Cloudflare
receives the extracted Pages artifact through Wrangler's explicit assets path;
the production environment disables Wrangler's preview custom build, so deployment
uses the prepared artifact directly. The workflow then
checks the selected public version markers and reports success only when they
match that commit. A failed publication remains failed; fix its cause and rerun the
workflow to complete both deployments. The two hosts can update at different
times while a run is in progress.

Website checks run only for pull requests that change `website/`, the website
scripts or workflow definitions. They check local links, HTML fragments, SVG XML,
search/sharing metadata and the single Pages publisher without installing npm
dependencies. The same asset preparation and verification run before each manual
deployment. With the preview environment active, run them locally:

```sh
python3 scripts/website.py check
```

`.github/workflows/pages.yml` is a separate, manual-only VitePress build. It
has no Pages artifact upload, deployment job or deployment permissions. This
prevents documentation updates from replacing the public website. The legacy
publishing job has been removed, so enabling this build workflow cannot publish
the old site.

After the site is approved and merged, select **GitHub Actions** under the
repository's **Settings → Pages → Build and deployment**. Then run **Publish REA
website** from the Actions tab on `main`. This publishes both production hosts.
The workflow uses the `github-pages` environment, the official Pages actions and
Cloudflare's Wrangler action.

The equivalent CLI command publishes both hosts:

```sh
gh workflow run website-pages.yml --repo morluto/rea --ref main
```

While Cloudflare credentials are being configured, an explicitly requested
Pages-only publication uses the same workflow with `target=pages`:

```sh
gh workflow run website-pages.yml --repo morluto/rea --ref main -f target=pages
```

This mode verifies the Pages commit marker. The default remains `both` for
synchronized production releases.

Local development does not change Pages settings or run the deployment workflow.
Any environment protection rules are configured separately when publication is
approved.
