# Website maintenance

> A good website is like a good paper: easy to follow, clear and concise, with a clean, refined presentation.
>
> — N0zoM1z0

Read [README.md](README.md) and [style-guide.md](style-guide.md) before changing
website content, layout or figures. Use [figures.md](figures.md) and `evidence/`
for asset notes and the source of case-study claims.

- Author source pages in English. Use direct headings and concrete instructions
  in every language. Each paragraph should explain a new fact or action.
- Follow [locales/README.md](locales/README.md) for translations. Edit standard PO
  catalogs, run `translations extract` after changing source text, and review
  translated setup prompts, terminology and case-study reasoning for readability.
  Keep code, commands, URLs, paths and Evidence unchanged. Use inline `code` or
  `translate="no"` for executable literals inside a translated sentence. Preserve
  named placeholders, source references and reviewer comments. Generated language
  HTML belongs in ignored `_site/`; do not author duplicate translated pages.
- Keep the language inventory aligned with README editions. Review long headings,
  figures and right-to-left layouts. A missing or fuzzy translation produces a
  labeled, nonindexable English fallback; do not present stale text as current.
- Reuse the shared styles, prompts, figures and code-step components. Keep a
  case study focused on one question, with further examples in native details.
- Edit shared header, footer and sharing markup in `templates/`; run
  `python3 scripts/website.py sync` and commit the rendered regions with their
  templates. Keep page bodies outside the marked regions. Author each title and
  description once; derive sharing fields and canonicals from them. Use
  `new-page` for a reading-page scaffold, then add its index link. Keep a draft's
  visible label and `noindex` until the content is ready.
- Show what REA returns and how the agent uses it. Preserve source attribution,
  target identity and verification scope.
- Blog articles teach methods, decisions and workflows through concrete cases.
  Lead with the takeaway. Essays can develop a personal argument through
  experience; figures are optional and should add an explanation the prose
  needs. Use engine details only when they explain a decision. Label working
  outlines and mark them `noindex`.
- Keep personal paths, account data, credentials and raw captures outside the
  public assets. Use generic inputs and label shortened display paths.
- Follow the same clear writing standard in search titles and descriptions.
  Give each content page its own absolute `https://rea.tools/` canonical and
  matching sharing metadata; keep navigation relative. The sitemap is generated
  from HTML automatically. Mark example applications `noindex` in the head and
  keep them crawlable. Maintain the SVG sharing source, not the generated PNG.
- Check both local root and `/rea/` paths, mobile layouts, expanded details,
  copying and downloads. Check light and dark themes, including a manual choice
  opposite to the system preference. Run `python3 scripts/website.py check`,
  using the Python environment described in the README. It rejects drift rather than silently
  rewriting shared HTML. Use `website.py links` for an optional network audit;
  distinguish missing targets from access denials and unverified fragments.
- Check setup and support statements against the current installation/provider
  guides and released package. Preserve historical case-study checkpoints and
  versions unless a new investigation supplies replacement evidence.
- Keep `website-pages.yml` as the sole, manual production publisher for
  Cloudflare and Pages. Default to `both`: both hosts receive the same verified
  artifact and pass the published-commit check. Use `pages` only when explicitly
  requested while Cloudflare credentials are being configured. Follow the
  website README.
