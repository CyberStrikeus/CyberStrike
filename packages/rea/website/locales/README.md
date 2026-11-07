# Website translations

> A good website is like a good paper: easy to follow, clear and concise, with a clean, refined presentation.
>
> — N0zoM1z0

The same standard applies in every language. A translation should help someone
understand the example and try it. Clear, accurate wording matters more than a
literal imitation of English sentences.

## Edit a translation

Use the Python environment in [the website README](../README.md). Pick a language
from `languages.json`, then edit its `messages.po` in a text editor, Poedit or
another gettext editor. Each entry includes its source page and line:

```po
#: website/public/faq/index.html:200
msgctxt "page:faq/index.html"
msgid "How do I install REA?"
msgstr "如何安装 REA？"
```

Change `msgstr`. Keep `msgid` and `msgctxt`. Add reviewer notes with `#` comments
when useful. Shared navigation uses the `shared` context; page-specific wording
has its own context. The same English sentence may need different wording in a
different case study.

```sh
python3 scripts/website.py translations status --language zh-CN
python3 scripts/website.py translations check --language zh-CN
python3 scripts/website.py serve
```

Open <http://127.0.0.1:4173/zh-CN/>. The language selector opens the equivalent
page in another edition. Check the page you edited, its figures and its copy
buttons. Rebuild a running preview with `python3 scripts/prepare-website.py`.
Before submitting a change, run `python3 scripts/website.py check`.
Use `translations check --strict` to require every message to be translated.

## Keep complete sentences and protected evidence

Paragraphs remain complete translation units. Inline emphasis, links, code and
literal commands use named placeholders:

```po
#. {ph0}: <a href="guides/">
#. {ph1}: </a>
msgctxt "page:index.html"
msgid "Already know RE? {ph0}Skip to analysis guides →{ph1}"
msgstr "已经了解逆向工程？{ph0}直接看分析指南 →{ph1}"
```

Move a linked or emphasized phrase when your language needs a different sentence
order. Keep its opening and closing placeholders around that phrase. Preserve
each placeholder exactly once per occurrence. Checks reject missing placeholders
and broken tag nesting. Interaction messages use names such as `{speed}` and
`{seconds}`; keep those names too.

Code blocks, inline code and `translate="no"` spans are copied from the source.
Commands, filenames, paths, URLs, hashes and observed values must retain their
meaning. Never translate `npx rea-agents@latest setup` into prose. Preserve product
names such as REA, Codex, Claude Code, Ghidra and Homebrew. Explain technical terms
in the surrounding text when needed.

In these articles, an **agent** is the reader's AI coding assistant. A **call** is
a function call; a **library** is a software library. A **port** means adapting a
program to another platform. An **oracle** is a concrete reference or checker
used to verify a reconstruction. Translate those meanings rather than unrelated
dictionary senses. Distinguish native machine-code analysis from local analysis,
and .NET assemblies from assembly instructions.
Android names the operating system; C names the programming language. Read the
whole sentence when a dictionary sense would change what the software does.

Review the question, REA's findings, the agent's reasoning and the verification
result together. Keep recorded versions, milestone counts, unknowns and source
attribution accurate. Blog essays can use a personal voice. Translated quotes
should be identifiable as translations and retain a link to the original.

## Update the English source

```sh
python3 scripts/website.py sync
python3 scripts/website.py translations extract
python3 scripts/website.py translations status
python3 scripts/website.py check
```

Extraction generates `messages.pot` and merges it into each PO catalog. Unchanged
sentences keep their translations and reviewer comments. Changed sentences start
empty; removed entries are retained as obsolete translation memory. Nothing
silently accepts a guessed match. An editor's `fuzzy` entry remains pending until
someone reviews it and removes the flag.

If a page needs a missing or fuzzy message, its language route temporarily shows
the complete English page with a visible notice. It has `noindex` and stays out
of the sitemap and translated `hreflang` alternatives. Links from ready pages
lead to ready editions or the English source. Completing the required entries
restores the translated page and its search metadata at the next build. Runtime
messages affect only pages that use their script; an untranslated dinosaur status
does not turn the FAQ into an English fallback.

`public/` remains the authored English site. `_site/` is disposable generated
output. The sitemap discovers every ready edition automatically. Pages and
Cloudflare publish this same artifact. No translation API runs during a build
or in a reader's browser.

Figure labels and accessibility descriptions are included in the catalogs under
`figure:<filename>`. Keep labels short enough for the diagram. Interaction text
is extracted directly from `t("message")` calls in `public/assets/*.js`, with
source locations in the catalog. Keep named values instead of concatenating
translated fragments.

## Language coverage and initial translations

`languages.json` lists the same editions as the English root README and the translations in `docs/readme/`, with native names,
standard language tags and text direction. English keeps its existing routes;
other editions use a language prefix such as `/ja/` or `/pt-BR/`. Arabic and
Persian use right-to-left page layouts; code and numeric demos remain left to
right. The two Notes target applications and the downloadable source archive
remain the original investigation inputs.

Greek (`el`) has a translated README and a complete website catalog, including
setup guides, case studies, articles and Contributors. Like the other editions,
it uses the labeled English fallback when a future source change leaves a
required translation missing or pending review.

Malayalam (`ml`) has a translated README and a pending website catalog. Its
website messages remain untranslated and use the labeled, nonindexable English
fallback described above; the README translation does not establish website
translation coverage.

Roman Urdu (`ur-Latn`) has a translated README written in Latin script, with
English technical terms retained. Its text direction is left to right. The
website catalog is pending and uses the same labeled, nonindexable English
fallback; the README does not establish a translated website.

Romanian (`ro`) has a complete translated README. Its website catalog is pending
and uses the same labeled, nonindexable English fallback; the Romanian README
does not establish website translation coverage.

The first catalogs started with machine-assisted drafts. They include editorial
corrections to navigation, prompts and technical terminology. Traditional Chinese
started from the Simplified Chinese draft and is maintained independently.
Further language review and more natural phrasing are welcome. Submit the PO changes with
the page and language you checked; a screenshot can help explain a layout issue.

## Why gettext

PO catalogs have source references, reviewer comments and explicit pending
translations. They can be edited locally and can later be connected to Weblate
without replacing the site's translation format. This keeps one authored layout
and a small offline build instead of maintaining separate HTML trees.

See [GNU gettext's PO format](https://www.gnu.org/software/gettext/manual/html_node/PO-File-Entries.html),
[Weblate's translation workflows](https://docs.weblate.org/en/latest/workflows.html)
and [Google's localized-page guidance](https://developers.google.com/search/docs/specialty/international/localized-versions).
