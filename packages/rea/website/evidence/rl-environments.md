# RL environment guide evidence

The homepage section, showcase-index entry, and
`public/guides/rl-environments/index.html` explain the existing capture, build,
export, and verification workflow. The short showcase entry links the guide
and announcement video; the standalone README section retains the setup steps.
They introduce no new provider or application-support claim.

The behavior and commands come from the REA
[quickstart](https://github.com/morluto/rea/blob/447907f2808877d3a7de62c382e256f55d08e5ac/docs/agent-environments-quickstart.md),
[environment reference](https://github.com/morluto/rea/blob/447907f2808877d3a7de62c382e256f55d08e5ac/docs/agent-environments.md),
and [implementation index](https://github.com/morluto/rea/blob/447907f2808877d3a7de62c382e256f55d08e5ac/docs/specs/agent-environments/README.md).
The compatibility version is the repository's pinned AgentEnv `0.9.1334` lane,
not a claim about other framework versions. AgentEnv's
[installation instructions](https://github.com/scaleapi/agentenv-framework#install)
were checked when preparing the page.

The folder examples and agent prompts are illustrative. Supported mutations
require confirmation in the recording. The exported smoke task verifies tool
count and, when available, a suitable read call's response status. The suggested
folder task and reward check are instructions for authoring a separate task;
the page does not claim that task has been executed or graded.

The [announcement post](https://x.com/reatools/status/2112574822584918075?s=20)
was verified through X's official oEmbed endpoint on 26 October 2026. The
response identifies `reatools` and dates the post to 20 October 2026. The site
links to the post rather than copying its video or loading an embedded player.
Its historical environment counts are not presented as current coverage.

Website checks and browser layout checks validate the presentation. They do
not establish new real-application behavior or RL training results. The linked
implementation records retain the scope and limits of their original checks.

## Website validation on 26 October 2026

- Documentation consistency checks and all nine README consistency tests passed.
- The site check verified 462 HTML pages, local links, sharing metadata, the
  sitemap, and generated assets. All 25 website regressions passed with
  `TMPDIR=/private/tmp` on macOS.
- The default macOS temporary path caused the language-metadata fixture to fail
  on this change and an archive of unchanged commit `447907f28`. That fixture
  uses unresolved temporary paths as dictionary keys and resolves lookup paths;
  selecting a canonical temporary directory avoids the alias mismatch. No
  production code or regression assertion was changed.
- Real Chrome checked the new section's order, guide links, copied commands
  and prompts, light and dark themes, a manual theme choice opposite to the
  system, 320-pixel layouts, Arabic and Chinese homepages, `/rea/` navigation,
  and guide content without JavaScript.
- The new guide's translations are pending. The standard language renderer
  provides labeled, nonindexable English fallback pages; the existing homepage
  and guide-index editions retain their translated content.
